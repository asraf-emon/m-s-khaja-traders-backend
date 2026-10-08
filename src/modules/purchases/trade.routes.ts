import { Router } from 'express';
import { z } from 'zod';
import { PAYMENT_METHODS } from '../../config/shop';
import { AppError, asyncHandler, escapeRegex, ok, paisaToBdt, parseDateRange, dateBounds } from '../../common/http';
import { presentParty, presentProduct, settlement } from '../../common/present';
import { mobileSchema, moneySchema, objectIdSchema, qtySchema } from '../../common/schemas';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { Customer, Product, Purchase, Sale, Supplier } from '../../models';
import { createPurchase, createSale } from '../../services/commerce';
import { writeAudit } from '../../services/platform';

const purchases = Router();
const sales = Router();

purchases.use(requireAuth);
sales.use(requireAuth);

function presentPurchase(doc: {
  _id: { toString(): string };
  number: string;
  supplier: unknown;
  items: { name: string; quantity: number; unit?: string; purchasePrice: number; total: number; sku?: string }[];
  subtotal: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  paymentStatus: string;
  purchaseDate: Date;
  notes?: string;
  createdAt?: Date;
}) {
  const supplier = doc.supplier && typeof doc.supplier === 'object' && 'name' in doc.supplier
    ? presentParty(doc.supplier as Parameters<typeof presentParty>[0])
    : null;
  return {
    id: doc._id.toString(),
    number: doc.number,
    supplier,
    items: doc.items.map((item) => ({
      name: item.name,
      sku: item.sku ?? '',
      unit: item.unit ?? '',
      quantity: item.quantity,
      purchasePrice: paisaToBdt(item.purchasePrice),
      total: paisaToBdt(item.total),
    })),
    subtotal: paisaToBdt(doc.subtotal),
    total: paisaToBdt(doc.total),
    paidAmount: paisaToBdt(doc.paidAmount),
    dueAmount: paisaToBdt(doc.dueAmount),
    paymentStatus: doc.paymentStatus,
    purchaseDate: doc.purchaseDate,
    notes: doc.notes ?? '',
    createdAt: doc.createdAt,
  };
}

function presentSale(doc: {
  _id: { toString(): string };
  number: string;
  customer?: unknown;
  items: { name: string; sku?: string; unit?: string; quantity: number; unitPrice: number; discount: number; total: number; purchasePrice: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  saleDate: Date;
  notes?: string;
  createdAt?: Date;
}) {
  const customer = doc.customer && typeof doc.customer === 'object' && 'name' in doc.customer
    ? presentParty(doc.customer as Parameters<typeof presentParty>[0])
    : null;
  return {
    id: doc._id.toString(),
    number: doc.number,
    customer,
    items: doc.items.map((item) => ({
      name: item.name,
      sku: item.sku ?? '',
      unit: item.unit ?? '',
      quantity: item.quantity,
      unitPrice: paisaToBdt(item.unitPrice),
      discount: paisaToBdt(item.discount),
      total: paisaToBdt(item.total),
      purchasePrice: paisaToBdt(item.purchasePrice),
    })),
    subtotal: paisaToBdt(doc.subtotal),
    discount: paisaToBdt(doc.discount),
    tax: paisaToBdt(doc.tax),
    total: paisaToBdt(doc.total),
    paidAmount: paisaToBdt(doc.paidAmount),
    dueAmount: paisaToBdt(doc.dueAmount),
    paymentMethod: doc.paymentMethod,
    paymentStatus: settlement(doc.paidAmount, doc.dueAmount, doc.paymentStatus),
    saleDate: doc.saleDate,
    notes: doc.notes ?? '',
    createdAt: doc.createdAt,
  };
}

const purchaseBody = z.object({
  supplierId: objectIdSchema,
  items: z.array(z.object({
    productId: objectIdSchema,
    quantity: qtySchema,
    purchasePrice: moneySchema,
  })).min(1),
  paidAmount: moneySchema,
  purchaseDate: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
});

purchases.get(
  '/',
  requirePermission('purchases.view'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 20;
    const filter: Record<string, unknown> = {};
    const dates = dateBounds(typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined);
    if (dates) filter.purchaseDate = dates;
    const [items, total] = await Promise.all([
      Purchase.find(filter).populate('supplier').sort({ purchaseDate: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Purchase.countDocuments(filter),
    ]);
    return ok(res, { items: items.map((item) => presentPurchase(item)), page, limit, total }, 'Purchases fetched');
  }),
);

purchases.get(
  '/:id',
  requirePermission('purchases.view'),
  asyncHandler(async (req, res) => {
    const purchase = await Purchase.findById(req.params.id).populate('supplier').lean();
    if (!purchase) throw new AppError('Purchase not found', 404);
    return ok(res, presentPurchase(purchase), 'Purchase fetched');
  }),
);

purchases.post(
  '/',
  requirePermission('purchases.manage'),
  asyncHandler(async (req, res) => {
    const input = purchaseBody.parse(req.body);
    const purchase = await createPurchase({ ...input, auth: req.auth });
    const fresh = await Purchase.findById(purchase._id).populate('supplier').lean();
    return ok(res, presentPurchase(fresh!), 'Purchase recorded', 201);
  }),
);

const saleBody = z.object({
  customerId: objectIdSchema.optional(),
  items: z.array(z.object({
    productId: objectIdSchema,
    quantity: qtySchema,
    unitPrice: moneySchema.optional(),
    discount: moneySchema.optional(),
    priceType: z.enum(['retail', 'wholesale']).optional(),
  })).min(1),
  discount: moneySchema.optional(),
  paidAmount: moneySchema,
  paymentMethod: z.enum(PAYMENT_METHODS),
  notes: z.string().trim().max(500).optional(),
  saleDate: z.coerce.date().optional(),
});

sales.get(
  '/',
  requirePermission('sales.view'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 20;
    const filter: Record<string, unknown> = {};
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      filter.number = new RegExp(escapeRegex(req.query.search.trim()), 'i');
    }
    const dates = dateBounds(typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined);
    if (dates) filter.saleDate = dates;
    const [items, total] = await Promise.all([
      Sale.find(filter).populate('customer').sort({ saleDate: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Sale.countDocuments(filter),
    ]);
    return ok(res, { items: items.map((item) => presentSale(item)), page, limit, total }, 'Sales fetched');
  }),
);

sales.get(
  '/meta/products',
  requirePermission('sales.view'),
  asyncHandler(async (_req, res) => {
    const products = await Product.find({ status: 'active' }).populate('category', 'name nameBn slug').sort({ name: 1 }).lean();
    return ok(res, products.map((item) => presentProduct(item, true)), 'Products fetched');
  }),
);

sales.get(
  '/:id',
  requirePermission('sales.view'),
  asyncHandler(async (req, res) => {
    const sale = await Sale.findById(req.params.id).populate('customer').lean();
    if (!sale) throw new AppError('Sale not found', 404);
    return ok(res, presentSale(sale), 'Sale fetched');
  }),
);

sales.post(
  '/',
  requirePermission('sales.manage'),
  asyncHandler(async (req, res) => {
    const input = saleBody.parse(req.body);
    const sale = await createSale({ ...input, auth: req.auth });
    const fresh = await Sale.findById(sale._id).populate('customer').lean();
    return ok(res, presentSale(fresh!), 'Sale recorded', 201);
  }),
);

const partySchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: mobileSchema,
  address: z.string().trim().max(300).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
});

export const customerBody = partySchema.extend({
  email: z.string().trim().email().optional().or(z.literal('')).default(''),
  district: z.string().trim().max(80).optional().default(''),
  area: z.string().trim().max(80).optional().default(''),
});

export const supplierBody = partySchema.extend({
  businessName: z.string().trim().max(120).optional().default(''),
  phone: z.string().trim().min(6).max(20),
});

export const purchaseRouter = purchases;
export const saleRouter = sales;

export async function listCustomers(search?: string) {
  const filter = search ? { $or: [{ name: new RegExp(escapeRegex(search), 'i') }, { phone: new RegExp(escapeRegex(search), 'i') }] } : {};
  return Customer.find(filter).sort({ name: 1 }).lean();
}

export async function listSuppliers(search?: string) {
  const filter = search ? { $or: [{ name: new RegExp(escapeRegex(search), 'i') }, { businessName: new RegExp(escapeRegex(search), 'i') }, { phone: new RegExp(escapeRegex(search), 'i') }] } : {};
  return Supplier.find(filter).sort({ name: 1 }).lean();
}

export { presentSale, parseDateRange };
