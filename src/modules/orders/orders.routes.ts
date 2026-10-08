import { Router } from 'express';
import { z } from 'zod';
import { ORDER_STATUSES, PAYMENT_STATUSES, isCardPayment } from '../../config/shop';
import { AppError, asyncHandler, escapeRegex, ok, paisaToBdt, dateBounds } from '../../common/http';
import { mobileSchema, objectIdSchema, qtySchema } from '../../common/schemas';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { Order } from '../../models';
import { createOnlineOrder, invalidateDashboard, restoreOrderStock } from '../../services/commerce';
import { getStripe, writeAudit } from '../../services/platform';
import { markStripeCheckoutFailed, markStripeCheckoutPaid } from '../../services/commerce';
import { env } from '../../config/env';

const router = Router();

function presentOrder(doc: {
  _id: { toString(): string };
  number: string;
  customerName: string;
  phone: string;
  email?: string;
  address: string;
  district: string;
  area: string;
  note?: string;
  items: { name: string; sku?: string; unit?: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  deliveryCharge: number;
  discount: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  transactionId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: doc._id.toString(),
    number: doc.number,
    customerName: doc.customerName,
    phone: doc.phone,
    email: doc.email ?? '',
    address: doc.address,
    district: doc.district,
    area: doc.area,
    note: doc.note ?? '',
    items: doc.items.map((item) => ({
      name: item.name,
      sku: item.sku ?? '',
      unit: item.unit ?? '',
      quantity: item.quantity,
      unitPrice: paisaToBdt(item.unitPrice),
      total: paisaToBdt(item.total),
    })),
    subtotal: paisaToBdt(doc.subtotal),
    deliveryCharge: paisaToBdt(doc.deliveryCharge),
    discount: paisaToBdt(doc.discount),
    total: paisaToBdt(doc.total),
    paymentMethod: doc.paymentMethod,
    paymentStatus: doc.paymentStatus,
    orderStatus: doc.orderStatus,
    transactionId: doc.transactionId ?? '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

const orderBody = z.object({
  customerName: z.string().trim().min(2).max(120),
  phone: mobileSchema,
  email: z.string().trim().email().optional().or(z.literal('')),
  address: z.string().trim().min(5).max(300),
  district: z.string().trim().min(2).max(80),
  area: z.string().trim().min(2).max(80),
  note: z.string().trim().max(500).optional(),
  items: z.array(z.object({ productId: objectIdSchema, quantity: qtySchema })).min(1),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'bkash', 'nagad', 'rocket', 'credit_card', 'debit_card', 'stripe']),
  transactionId: z.string().trim().max(80).optional(),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = orderBody.parse(req.body);
    if (!isCardPayment(input.paymentMethod) && input.paymentMethod !== 'cash' && !input.transactionId) {
      throw new AppError('Enter the transaction or reference number', 422);
    }
    const result = await createOnlineOrder(input);
    return ok(res, { order: presentOrder(result.order.toObject()), checkoutUrl: result.checkoutUrl }, 'Order placed', 201);
  }),
);

router.get(
  '/track',
  asyncHandler(async (req, res) => {
    const query = z.object({ order: z.string().min(3), phone: mobileSchema }).parse(req.query);
    const order = await Order.findOne({ number: query.order, phone: query.phone }).lean();
    if (!order) throw new AppError('Order not found', 404);
    return ok(res, presentOrder(order), 'Order fetched');
  }),
);

router.get(
  '/',
  requireAuth,
  requirePermission('orders.view'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 20;
    const filter: Record<string, unknown> = {};
    if (typeof req.query.status === 'string' && req.query.status) filter.orderStatus = req.query.status;
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const pattern = new RegExp(escapeRegex(req.query.search.trim()), 'i');
      filter.$or = [{ number: pattern }, { customerName: pattern }, { phone: pattern }];
    }
    const dates = dateBounds(typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined);
    if (dates) filter.createdAt = dates;
    const [items, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    return ok(res, { items: items.map((item) => presentOrder(item)), page, limit, total }, 'Orders fetched');
  }),
);

router.get(
  '/:id',
  requireAuth,
  requirePermission('orders.view'),
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id).lean();
    if (!order) throw new AppError('Order not found', 404);
    return ok(res, presentOrder(order), 'Order fetched');
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requirePermission('orders.manage'),
  asyncHandler(async (req, res) => {
    const input = z.object({
      orderStatus: z.enum(ORDER_STATUSES).optional(),
      paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    }).parse(req.body);
    const order = await Order.findById(req.params.id);
    if (!order) throw new AppError('Order not found', 404);
    if (input.orderStatus === 'cancelled' && order.orderStatus !== 'cancelled' && order.stockCommitted) {
      await restoreOrderStock(order._id.toString());
      order.stockCommitted = false;
    }
    if (input.orderStatus) order.orderStatus = input.orderStatus;
    if (input.paymentStatus) order.paymentStatus = input.paymentStatus;
    await order.save();
    await writeAudit(req.auth, 'update', 'order', order._id.toString(), input);
    await invalidateDashboard();
    return ok(res, presentOrder(order.toObject()), 'Order updated');
  }),
);

export async function stripeWebhook(req: import('express').Request, res: import('express').Response) {
  const stripe = getStripe();
  const signature = req.headers['stripe-signature'];
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET || typeof signature !== 'string') {
    return res.status(503).json({ success: false, message: 'Stripe webhook is not configured', error: null });
  }
  try {
    const event = stripe.webhooks.constructEvent(req.body as Buffer, signature, env.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.payment_status === 'paid') await markStripeCheckoutPaid(session);
    } else if (event.type === 'checkout.session.expired') {
      await markStripeCheckoutFailed(event.data.object, 'cancelled');
    } else if (event.type === 'checkout.session.async_payment_failed') {
      await markStripeCheckoutFailed(event.data.object, 'failed');
    }
    return res.json({ received: true });
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid Stripe signature', error: null });
  }
}

export const orderRouter = router;
