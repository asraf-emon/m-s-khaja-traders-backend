import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler, escapeRegex, ok } from '../../common/http';
import { presentLedger, presentParty } from '../../common/present';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { Customer, LedgerEntry, Sale, Supplier } from '../../models';
import { customerBody, supplierBody } from '../purchases/trade.routes';
import { writeAudit } from '../../services/platform';

const customers = Router();
const suppliers = Router();
customers.use(requireAuth, requirePermission('customers.view'));
suppliers.use(requireAuth, requirePermission('suppliers.view'));

function searchFilter(search: unknown, fields: string[]) {
  if (typeof search !== 'string' || !search.trim()) return {};
  const pattern = new RegExp(escapeRegex(search.trim()), 'i');
  return { $or: fields.map((field) => ({ [field]: pattern })) };
}

customers.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await Customer.find(searchFilter(req.query.search, ['name', 'phone'])).sort({ name: 1 }).lean();
    return ok(res, items.map((item) => presentParty(item)), 'Customers fetched');
  }),
);

customers.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await Customer.findById(req.params.id).lean();
    if (!customer) throw new AppError('Customer not found', 404);
    const [ledger, sales] = await Promise.all([
      LedgerEntry.find({ partyType: 'customer', partyId: customer._id }).sort({ entryDate: -1, createdAt: -1 }).limit(100).lean(),
      Sale.find({ customer: customer._id }).sort({ saleDate: -1 }).limit(50).lean(),
    ]);
    return ok(res, {
      customer: presentParty(customer),
      ledger: ledger.map((entry) => presentLedger(entry)),
      sales: sales.map((sale) => ({
        id: sale._id.toString(),
        number: sale.number,
        total: sale.total / 100,
        dueAmount: sale.dueAmount / 100,
        saleDate: sale.saleDate,
      })),
    }, 'Customer fetched');
  }),
);

customers.post(
  '/',
  requirePermission('customers.manage'),
  asyncHandler(async (req, res) => {
    const input = customerBody.parse(req.body);
    const existing = await Customer.findOne({ phone: input.phone });
    if (existing) throw new AppError('A customer with this mobile number already exists', 409);
    const customer = await Customer.create(input);
    await writeAudit(req.auth, 'create', 'customer', customer._id.toString());
    return ok(res, presentParty(customer.toObject()), 'Customer created', 201);
  }),
);

customers.patch(
  '/:id',
  requirePermission('customers.manage'),
  asyncHandler(async (req, res) => {
    const input = customerBody.partial().parse(req.body);
    const customer = await Customer.findByIdAndUpdate(req.params.id, input, { new: true });
    if (!customer) throw new AppError('Customer not found', 404);
    await writeAudit(req.auth, 'update', 'customer', customer._id.toString());
    return ok(res, presentParty(customer.toObject()), 'Customer updated');
  }),
);

customers.delete(
  '/:id',
  requirePermission('customers.manage'),
  asyncHandler(async (req, res) => {
    const customer = await Customer.findById(req.params.id);
    if (!customer) throw new AppError('Customer not found', 404);
    if (customer.totalDue !== 0) throw new AppError('Clear the customer balance before deleting', 409);
    await customer.deleteOne();
    await writeAudit(req.auth, 'delete', 'customer', req.params.id);
    return ok(res, { id: req.params.id }, 'Customer deleted');
  }),
);

suppliers.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await Supplier.find(searchFilter(req.query.search, ['name', 'businessName', 'phone'])).sort({ name: 1 }).lean();
    return ok(res, items.map((item) => presentParty(item)), 'Suppliers fetched');
  }),
);

suppliers.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const supplier = await Supplier.findById(req.params.id).lean();
    if (!supplier) throw new AppError('Supplier not found', 404);
    const ledger = await LedgerEntry.find({ partyType: 'supplier', partyId: supplier._id }).sort({ entryDate: -1, createdAt: -1 }).limit(100).lean();
    return ok(res, { supplier: presentParty(supplier), ledger: ledger.map((entry) => presentLedger(entry)) }, 'Supplier fetched');
  }),
);

suppliers.post(
  '/',
  requirePermission('suppliers.manage'),
  asyncHandler(async (req, res) => {
    const input = supplierBody.parse(req.body);
    const existing = await Supplier.findOne({ phone: input.phone });
    if (existing) throw new AppError('A supplier with this phone number already exists', 409);
    const supplier = await Supplier.create(input);
    await writeAudit(req.auth, 'create', 'supplier', supplier._id.toString());
    return ok(res, presentParty(supplier.toObject()), 'Supplier created', 201);
  }),
);

suppliers.patch(
  '/:id',
  requirePermission('suppliers.manage'),
  asyncHandler(async (req, res) => {
    const input = supplierBody.partial().parse(req.body);
    const supplier = await Supplier.findByIdAndUpdate(req.params.id, input, { new: true });
    if (!supplier) throw new AppError('Supplier not found', 404);
    await writeAudit(req.auth, 'update', 'supplier', supplier._id.toString());
    return ok(res, presentParty(supplier.toObject()), 'Supplier updated');
  }),
);

suppliers.delete(
  '/:id',
  requirePermission('suppliers.manage'),
  asyncHandler(async (req, res) => {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) throw new AppError('Supplier not found', 404);
    if (supplier.totalDue !== 0) throw new AppError('Clear the supplier balance before deleting', 409);
    await supplier.deleteOne();
    await writeAudit(req.auth, 'delete', 'supplier', req.params.id);
    return ok(res, { id: req.params.id }, 'Supplier deleted');
  }),
);

export const customerRouter = customers;
export const supplierRouter = suppliers;

void z;
