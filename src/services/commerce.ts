import mongoose, { type ClientSession } from 'mongoose';
import type Stripe from 'stripe';
import { isCardPayment, type InventoryType, type PaymentMethod } from '../config/shop';
import { env } from '../config/env';
import {
  AppError,
  bdtToPaisa,
  moneyTimesQty,
  roundQty,
  type AuthStaff,
  weightedAverage,
} from '../common/http';
import { cacheDel } from '../db/redis';
import {
  Counter,
  Customer,
  InventoryTransaction,
  LedgerEntry,
  Notification,
  Order,
  Payment,
  Product,
  Purchase,
  Sale,
  Supplier,
} from '../models';
import { getSettings, getStripe, writeAudit } from './platform';

export type ActionMeta = {
  auth?: AuthStaff;
  isDemo?: boolean;
  quiet?: boolean;
};

function sessionOpts(session?: ClientSession) {
  return session ? { session } : {};
}

function txnUnsupported(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /replica set|Transaction numbers|transactions are not supported/i.test(message);
}

export async function runInTransaction<T>(work: (session: ClientSession | undefined) => Promise<T>) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction().catch(() => undefined);
    if (txnUnsupported(error)) return work(undefined);
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function nextNumber(key: string, prefix: string, session?: ClientSession) {
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, ...sessionOpts(session) },
  );
  if (!counter) throw new AppError('Could not generate a document number', 500);
  return `${prefix}-${String(counter.seq).padStart(6, '0')}`;
}

export async function invalidateDashboard() {
  await Promise.all([
    cacheDel('dashboard:stats'),
    cacheDel('dashboard:stats:full'),
    cacheDel('dashboard:stats:ops'),
  ]);
}

async function notify(type: string, title: string, message: string, metadata: Record<string, unknown>, isDemo = false) {
  await Notification.create({ type, title, message, metadata, isDemo });
}

export async function applyStockChange(input: {
  productId: string;
  quantityChange: number;
  type: InventoryType;
  purchasePrice?: number;
  sellingPrice?: number;
  nextPurchasePrice?: number;
  reference?: string;
  note?: string;
  session?: ClientSession;
  createdBy?: string;
  isDemo?: boolean;
  quiet?: boolean;
}) {
  const qty = roundQty(input.quantityChange);
  if (qty === 0) throw new AppError('Quantity cannot be zero', 422);

  const filter =
    qty < 0
      ? { _id: input.productId, stock: { $gte: roundQty(Math.abs(qty) - 0.0005) } }
      : { _id: input.productId };

  const update: { $inc: { stock: number }; $set?: { purchasePrice: number } } = { $inc: { stock: qty } };
  if (input.nextPurchasePrice != null) update.$set = { purchasePrice: input.nextPurchasePrice };

  const product = await Product.findOneAndUpdate(filter, update, { new: true, ...sessionOpts(input.session) });
  if (!product) throw new AppError('Insufficient stock or product not found', 409);

  product.stock = roundQty(product.stock);
  await product.save(sessionOpts(input.session));

  await InventoryTransaction.create(
    [
      {
        product: product._id,
        type: input.type,
        quantity: Math.abs(qty),
        quantityChange: qty,
        purchasePrice: input.purchasePrice ?? product.purchasePrice,
        sellingPrice: input.sellingPrice ?? product.sellingPrice,
        reference: input.reference ?? '',
        note: input.note ?? '',
        createdBy: input.createdBy,
        isDemo: Boolean(input.isDemo),
      },
    ],
    sessionOpts(input.session),
  );

  if (!input.quiet && product.stock <= product.minimumStock) {
    await notify(
      product.stock <= 0 ? 'out-of-stock' : 'low-stock',
      product.stock <= 0 ? 'Out of stock' : 'Low stock',
      `${product.name} is at ${product.stock} ${product.unit}`,
      { productId: product._id.toString(), stock: product.stock },
      Boolean(input.isDemo),
    );
  }

  return product;
}

export async function postLedger(input: {
  partyType: 'customer' | 'supplier';
  partyId: string;
  direction: 'debit' | 'credit';
  amountPaisa: number;
  description: string;
  entryDate?: Date;
  referenceType?: string;
  referenceId?: string;
  countsAsPurchase?: boolean;
  countsAsPayment?: boolean;
  session?: ClientSession;
  isDemo?: boolean;
  createdBy?: string;
}) {
  if (input.amountPaisa <= 0) return null;
  const delta = input.direction === 'debit' ? input.amountPaisa : -input.amountPaisa;
  const inc: Record<string, number> = { totalDue: delta };
  if (input.direction === 'debit' && input.countsAsPurchase) inc.totalPurchases = input.amountPaisa;
  if (input.direction === 'credit' && input.countsAsPayment) inc.totalPaid = input.amountPaisa;

  const party = input.partyType === 'customer'
    ? await Customer.findByIdAndUpdate(input.partyId, { $inc: inc }, { new: true, ...sessionOpts(input.session) })
    : await Supplier.findByIdAndUpdate(input.partyId, { $inc: inc }, { new: true, ...sessionOpts(input.session) });
  if (!party) throw new AppError(input.partyType === 'customer' ? 'Customer not found' : 'Supplier not found', 404);

  const [entry] = await LedgerEntry.create(
    [
      {
        partyType: input.partyType,
        partyId: party._id,
        direction: input.direction,
        amount: input.amountPaisa,
        balanceAfter: party.totalDue,
        description: input.description,
        entryDate: input.entryDate ?? new Date(),
        referenceType: input.referenceType ?? '',
        referenceId: input.referenceId || undefined,
        createdBy: input.createdBy,
        isDemo: Boolean(input.isDemo),
      },
    ],
    sessionOpts(input.session),
  );

  return { party, entry };
}

type PurchaseItem = { productId: string; quantity: number; purchasePrice: number };

export async function createPurchase(
  input: {
    supplierId: string;
    items: PurchaseItem[];
    paidAmount: number;
    purchaseDate?: Date;
    notes?: string;
  } & ActionMeta,
) {
  return runInTransaction(async (session) => {
    const supplier = await Supplier.findById(input.supplierId).session(session ?? null);
    if (!supplier) throw new AppError('Supplier not found', 404);

    const lines = [];
    let subtotal = 0;
    for (const item of input.items) {
      const product = await Product.findById(item.productId).session(session ?? null);
      if (!product) throw new AppError('Product not found', 404);
      const qty = roundQty(item.quantity);
      if (qty <= 0) throw new AppError('Quantity must be greater than zero', 422);
      const unit = bdtToPaisa(item.purchasePrice);
      const total = moneyTimesQty(unit, qty);
      subtotal += total;
      lines.push({ product, qty, unit, total });
    }

    const paid = bdtToPaisa(input.paidAmount);
    if (paid < 0 || paid > subtotal) throw new AppError('Paid amount is invalid', 422);
    const due = subtotal - paid;
    const number = await nextNumber('purchase', 'PU', session);
    const date = input.purchaseDate ?? new Date();

    const [purchase] = await Purchase.create(
      [
        {
          number,
          supplier: supplier._id,
          items: lines.map((line) => ({
            product: line.product._id,
            name: line.product.name,
            sku: line.product.sku,
            unit: line.product.unit,
            quantity: line.qty,
            purchasePrice: line.unit,
            unitPrice: line.unit,
            discount: 0,
            total: line.total,
          })),
          subtotal,
          total: subtotal,
          paidAmount: paid,
          dueAmount: due,
          paymentStatus: due === 0 ? 'paid' : paid === 0 ? 'unpaid' : 'partial',
          purchaseDate: date,
          notes: input.notes ?? '',
          createdBy: input.auth?.id,
          isDemo: Boolean(input.isDemo),
        },
      ],
      sessionOpts(session),
    );

    for (const line of lines) {
      const nextPrice = weightedAverage(line.product.stock, line.product.purchasePrice, line.qty, line.unit);
      await applyStockChange({
        productId: line.product._id.toString(),
        quantityChange: line.qty,
        type: 'purchase',
        purchasePrice: line.unit,
        nextPurchasePrice: nextPrice,
        reference: number,
        note: `Purchase ${number}`,
        session,
        createdBy: input.auth?.id,
        isDemo: input.isDemo,
        quiet: input.quiet,
      });
    }

    await postLedger({
      partyType: 'supplier',
      partyId: supplier._id.toString(),
      direction: 'debit',
      amountPaisa: subtotal,
      description: `Purchase ${number}`,
      entryDate: date,
      referenceType: 'purchase',
      referenceId: purchase._id.toString(),
      countsAsPurchase: true,
      session,
      isDemo: input.isDemo,
      createdBy: input.auth?.id,
    });

    if (paid > 0) {
      await postLedger({
        partyType: 'supplier',
        partyId: supplier._id.toString(),
        direction: 'credit',
        amountPaisa: paid,
        description: `Payment for ${number}`,
        entryDate: date,
        referenceType: 'purchase',
        referenceId: purchase._id.toString(),
        countsAsPayment: true,
        session,
        isDemo: input.isDemo,
        createdBy: input.auth?.id,
      });
      await Payment.create(
        [
          {
            partyType: 'supplier',
            partyId: supplier._id,
            partyName: supplier.name,
            relatedType: 'purchase',
            relatedId: purchase._id,
            amount: paid,
            method: 'cash',
            status: 'paid',
            note: `Purchase ${number}`,
            paidAt: date,
            createdBy: input.auth?.id,
            isDemo: Boolean(input.isDemo),
          },
        ],
        sessionOpts(session),
      );
    }

    if (!input.quiet) {
      await notify('purchase', 'Purchase recorded', `${number} from ${supplier.name}`, { purchaseId: purchase._id.toString() }, Boolean(input.isDemo));
      if (due > 0) {
        await notify('supplier-due', 'Supplier due', `${supplier.name} due updated after ${number}`, { supplierId: supplier._id.toString() }, Boolean(input.isDemo));
      }
      await invalidateDashboard();
    }
    await writeAudit(input.auth, 'create', 'purchase', purchase._id.toString(), { number });
    return purchase;
  });
}

type SaleItem = {
  productId: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  priceType?: 'retail' | 'wholesale';
};

export async function createSale(
  input: {
    customerId?: string;
    items: SaleItem[];
    discount?: number;
    paidAmount: number;
    paymentMethod: PaymentMethod;
    notes?: string;
    saleDate?: Date;
  } & ActionMeta,
) {
  return runInTransaction(async (session) => {
    const settings = await getSettings();
    const lines = [];
    let subtotal = 0;

    for (const item of input.items) {
      const product = await Product.findById(item.productId).session(session ?? null);
      if (!product || product.status !== 'active') throw new AppError('Invalid product', 422);
      const qty = roundQty(item.quantity);
      if (qty <= 0) throw new AppError('Quantity must be greater than zero', 422);

      let unit = item.priceType === 'wholesale' ? product.wholesalePrice : product.sellingPrice;
      if (item.unitPrice != null) {
        unit = bdtToPaisa(item.unitPrice);
        if (unit < product.minimumSellingPrice) {
          throw new AppError(`${product.name} is below the minimum selling price`, 422);
        }
      }
      const discount = bdtToPaisa(item.discount ?? 0);
      const gross = moneyTimesQty(unit, qty);
      if (discount > gross) throw new AppError('Item discount cannot exceed the line total', 422);
      subtotal += gross - discount;
      lines.push({ product, qty, unit, discount, total: gross - discount });
    }

    const orderDiscount = bdtToPaisa(input.discount ?? 0);
    if (orderDiscount > subtotal) throw new AppError('Discount cannot exceed subtotal', 422);
    const taxable = subtotal - orderDiscount;
    const tax = Math.round((taxable * settings.taxPercent) / 100);
    const total = taxable + tax;
    const paid = bdtToPaisa(input.paidAmount);
    if (paid < 0 || paid > total) throw new AppError('Paid amount is invalid', 422);
    const due = total - paid;
    if (due > 0 && !input.customerId) throw new AppError('Select a customer when the sale is not fully paid', 422);

    let customerName = '';
    if (input.customerId) {
      const customer = await Customer.findById(input.customerId).session(session ?? null);
      if (!customer) throw new AppError('Customer not found', 404);
      customerName = customer.name;
    }

    const number = await nextNumber('sale', 'SL', session);
    const date = input.saleDate ?? new Date();
    const [sale] = await Sale.create(
      [
        {
          number,
          customer: input.customerId || undefined,
          items: lines.map((line) => ({
            product: line.product._id,
            name: line.product.name,
            sku: line.product.sku,
            unit: line.product.unit,
            quantity: line.qty,
            purchasePrice: line.product.purchasePrice,
            unitPrice: line.unit,
            discount: line.discount,
            total: line.total,
          })),
          subtotal,
          discount: orderDiscount,
          tax,
          total,
          paidAmount: paid,
          dueAmount: due,
          paymentMethod: input.paymentMethod,
          paymentStatus: due === 0 ? 'paid' : 'pending',
          saleDate: date,
          notes: input.notes ?? '',
          createdBy: input.auth?.id,
          isDemo: Boolean(input.isDemo),
        },
      ],
      sessionOpts(session),
    );

    for (const line of lines) {
      await applyStockChange({
        productId: line.product._id.toString(),
        quantityChange: -line.qty,
        type: 'sale',
        purchasePrice: line.product.purchasePrice,
        sellingPrice: line.unit,
        reference: number,
        note: `Sale ${number}`,
        session,
        createdBy: input.auth?.id,
        isDemo: input.isDemo,
        quiet: input.quiet,
      });
    }

    if (input.customerId) {
      await postLedger({
        partyType: 'customer',
        partyId: input.customerId,
        direction: 'debit',
        amountPaisa: total,
        description: `Sale ${number}`,
        entryDate: date,
        referenceType: 'sale',
        referenceId: sale._id.toString(),
        countsAsPurchase: true,
        session,
        isDemo: input.isDemo,
        createdBy: input.auth?.id,
      });
      if (paid > 0) {
        await postLedger({
          partyType: 'customer',
          partyId: input.customerId,
          direction: 'credit',
          amountPaisa: paid,
          description: `Payment for ${number}`,
          entryDate: date,
          referenceType: 'sale',
          referenceId: sale._id.toString(),
          countsAsPayment: true,
          session,
          isDemo: input.isDemo,
          createdBy: input.auth?.id,
        });
      }
    }

    if (paid > 0) {
      await Payment.create(
        [
          {
            partyType: 'customer',
            partyId: input.customerId || undefined,
            partyName: customerName,
            relatedType: 'sale',
            relatedId: sale._id,
            amount: paid,
            method: input.paymentMethod,
            status: 'paid',
            note: `Sale ${number}`,
            paidAt: date,
            createdBy: input.auth?.id,
            isDemo: Boolean(input.isDemo),
          },
        ],
        sessionOpts(session),
      );
    }

    if (!input.quiet) {
      await notify('sale', 'Sale recorded', `${number} has been saved`, { saleId: sale._id.toString() }, Boolean(input.isDemo));
      if (due > 0) {
        await notify('customer-due', 'Customer due', `${customerName} has due on ${number}`, { customerId: input.customerId }, Boolean(input.isDemo));
      }
      await invalidateDashboard();
    }
    await writeAudit(input.auth, 'create', 'sale', sale._id.toString(), { number });
    return sale;
  });
}

export async function recordPartyPayment(
  input: {
    partyType: 'customer' | 'supplier';
    partyId: string;
    amount: number;
    method: PaymentMethod;
    transactionId?: string;
    note?: string;
    paidAt?: Date;
  } & ActionMeta,
) {
  const amountPaisa = bdtToPaisa(input.amount);
  if (amountPaisa <= 0) throw new AppError('Amount must be greater than zero', 422);

  return runInTransaction(async (session) => {
    const description = input.note?.trim() || (input.partyType === 'supplier' ? 'Payment to supplier' : 'Payment received');
    const posted = await postLedger({
      partyType: input.partyType,
      partyId: input.partyId,
      direction: 'credit',
      amountPaisa,
      description,
      entryDate: input.paidAt,
      referenceType: 'payment',
      countsAsPayment: true,
      session,
      isDemo: input.isDemo,
      createdBy: input.auth?.id,
    });
    if (!posted) throw new AppError('Payment failed', 400);

    const [payment] = await Payment.create(
      [
        {
          partyType: input.partyType,
          partyId: posted.party._id,
          partyName: posted.party.name,
          amount: amountPaisa,
          method: input.method,
          status: 'paid',
          transactionId: input.transactionId ?? '',
          note: description,
          paidAt: input.paidAt ?? new Date(),
          createdBy: input.auth?.id,
          isDemo: Boolean(input.isDemo),
        },
      ],
      sessionOpts(session),
    );

    if (!input.quiet) {
      await notify('payment', 'Payment recorded', `${posted.party.name}: ${description}`, { paymentId: payment._id.toString() }, Boolean(input.isDemo));
      await invalidateDashboard();
    }
    await writeAudit(input.auth, 'create', 'payment', payment._id.toString(), { partyType: input.partyType });
    return payment;
  });
}

export async function addManualLedgerEntry(
  input: {
    partyType: 'customer' | 'supplier';
    partyId: string;
    direction: 'debit' | 'credit';
    amount: number;
    description: string;
    entryDate?: Date;
  } & ActionMeta,
) {
  const amountPaisa = bdtToPaisa(input.amount);
  if (amountPaisa <= 0) throw new AppError('Amount must be greater than zero', 422);
  const result = await runInTransaction((session) =>
    postLedger({
      partyType: input.partyType,
      partyId: input.partyId,
      direction: input.direction,
      amountPaisa,
      description: input.description,
      entryDate: input.entryDate,
      referenceType: 'manual',
      countsAsPayment: input.direction === 'credit',
      countsAsPurchase: false,
      session,
      isDemo: input.isDemo,
      createdBy: input.auth?.id,
    }),
  );
  await writeAudit(input.auth, 'create', 'ledger', result?.entry._id.toString() ?? '', {
    partyType: input.partyType,
    direction: input.direction,
  });
  if (!input.quiet) await invalidateDashboard();
  return result?.entry;
}

async function commitOrderStock(
  order: { number: string; items: { product: { toString(): string }; quantity: number; unitPrice: number; name: string }[]; _id: { toString(): string } },
  session: ClientSession | undefined,
  meta: ActionMeta,
) {
  for (const item of order.items) {
    await applyStockChange({
      productId: item.product.toString(),
      quantityChange: -item.quantity,
      type: 'sale',
      sellingPrice: item.unitPrice,
      reference: order.number,
      note: `Online order ${order.number}`,
      session,
      isDemo: meta.isDemo,
      quiet: meta.quiet,
    });
  }
}

export async function restoreOrderStock(orderId: string, meta: ActionMeta = {}) {
  const order = await Order.findById(orderId);
  if (!order || !order.stockCommitted) return order;
  await runInTransaction(async (session) => {
    for (const item of order.items) {
      await applyStockChange({
        productId: item.product.toString(),
        quantityChange: item.quantity,
        type: 'return',
        sellingPrice: item.unitPrice,
        reference: order.number,
        note: `Order ${order.number} stock restored`,
        session,
        isDemo: order.isDemo || meta.isDemo,
        quiet: true,
      });
    }
    order.stockCommitted = false;
    await order.save(sessionOpts(session));
  });
  return order;
}

export async function createOnlineOrder(input: {
  customerName: string;
  phone: string;
  email?: string;
  address: string;
  district: string;
  area: string;
  note?: string;
  items: { productId: string; quantity: number }[];
  paymentMethod: PaymentMethod;
  transactionId?: string;
  isDemo?: boolean;
  quiet?: boolean;
}) {
  const settings = await getSettings();
  if (!settings.onlineOrderingEnabled) throw new AppError('Online ordering is currently turned off', 403);
  if (isCardPayment(input.paymentMethod) && !getStripe()) throw new AppError('Card payment is not configured', 503);

  const order = await runInTransaction(async (session) => {
    const lines = [];
    let subtotal = 0;
    for (const item of input.items) {
      const product = await Product.findById(item.productId).session(session ?? null);
      if (!product || product.status !== 'active') throw new AppError('Invalid product', 422);
      const qty = roundQty(item.quantity);
      if (qty <= 0) throw new AppError('Quantity must be greater than zero', 422);
      const total = moneyTimesQty(product.sellingPrice, qty);
      subtotal += total;
      lines.push({ product, qty, total });
    }

    const number = await nextNumber('order', 'KT', session);
    const total = subtotal + settings.deliveryCharge;
    const [created] = await Order.create(
      [
        {
          number,
          customerName: input.customerName,
          phone: input.phone,
          email: input.email ?? '',
          address: input.address,
          district: input.district,
          area: input.area,
          note: input.note ?? '',
          items: lines.map((line) => ({
            product: line.product._id,
            name: line.product.name,
            sku: line.product.sku,
            unit: line.product.unit,
            quantity: line.qty,
            unitPrice: line.product.sellingPrice,
            total: line.total,
          })),
          subtotal,
          deliveryCharge: settings.deliveryCharge,
          discount: 0,
          total,
          paymentMethod: input.paymentMethod,
          paymentStatus: 'pending',
          orderStatus: 'pending',
          transactionId: input.transactionId ?? '',
          stockCommitted: true,
          isDemo: Boolean(input.isDemo),
        },
      ],
      sessionOpts(session),
    );

    await commitOrderStock(created, session, input);
    return created;
  });

  if (!input.quiet) {
    await notify('order', 'New online order', `${order.number} from ${order.customerName}`, { orderId: order._id.toString() }, Boolean(input.isDemo));
    await invalidateDashboard();
  }

  if (!isCardPayment(input.paymentMethod)) {
    return { order, checkoutUrl: null as string | null };
  }

  const stripe = getStripe();
  if (!stripe) throw new AppError('Card payment is not configured', 503);

  try {
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = order.items.map((item) => ({
      quantity: 1,
      price_data: {
        currency: 'bdt',
        unit_amount: item.total,
        product_data: { name: `${item.name} × ${item.quantity} ${item.unit}` },
      },
    }));
    if (order.deliveryCharge > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: 'bdt',
          unit_amount: order.deliveryCharge,
          product_data: { name: 'Delivery charge' },
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      success_url: `${env.CLIENT_ORIGIN}/order-confirmation?order=${encodeURIComponent(order.number)}&phone=${encodeURIComponent(order.phone)}`,
      cancel_url: `${env.CLIENT_ORIGIN}/checkout?cancelled=1&order=${encodeURIComponent(order.number)}`,
      customer_email: order.email || undefined,
      metadata: {
        orderId: order._id.toString(),
        orderNumber: order.number,
        paymentMethod: input.paymentMethod,
      },
      line_items: lineItems,
    });
    order.stripeSessionId = session.id;
    await order.save();
    return { order, checkoutUrl: session.url };
  } catch (error) {
    await restoreOrderStock(order._id.toString(), { quiet: true });
    order.stockCommitted = false;
    order.paymentStatus = 'failed';
    order.orderStatus = 'cancelled';
    await order.save();
    await notify('payment-failed', 'Card payment failed', `${order.number} could not start card payment`, { orderId: order._id.toString() });
    throw error instanceof AppError ? error : new AppError('Card payment could not be started', 502);
  }
}

export async function markStripeCheckoutPaid(session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.orderId;
  if (!orderId) return;
  const order = await Order.findById(orderId);
  if (!order || order.paymentStatus === 'paid') return;
  order.paymentStatus = 'paid';
  if (order.orderStatus === 'pending') order.orderStatus = 'confirmed';
  await order.save();
  const recordedMethod = session.metadata?.paymentMethod === 'credit_card' || session.metadata?.paymentMethod === 'debit_card'
    ? session.metadata.paymentMethod
    : 'stripe';
  await Payment.create({
    partyType: 'order',
    relatedType: 'order',
    relatedId: order._id,
    partyName: order.customerName,
    amount: order.total,
    method: recordedMethod,
    status: 'paid',
    transactionId: session.id,
    note: `Stripe ${recordedMethod === 'debit_card' ? 'debit' : 'credit'} card payment for ${order.number}`,
  });
  await notify('payment', 'Online payment received', `${order.number} was paid by card`, { orderId: order._id.toString() });
  await invalidateDashboard();
}

export async function markStripeCheckoutFailed(session: Stripe.Checkout.Session, status: 'failed' | 'cancelled') {
  const orderId = session.metadata?.orderId;
  if (!orderId) return;
  const order = await Order.findById(orderId);
  if (!order || order.paymentStatus === 'paid') return;
  if (order.stockCommitted) await restoreOrderStock(order._id.toString(), { quiet: true });
  order.stockCommitted = false;
  order.paymentStatus = status;
  order.orderStatus = 'cancelled';
  await order.save();
  await notify(status === 'failed' ? 'payment-failed' : 'order', `Card payment ${status}`, `${order.number} payment ${status}`, {
    orderId: order._id.toString(),
  });
  await invalidateDashboard();
}
