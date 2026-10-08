import { Router } from 'express';
import { z } from 'zod';
import { PAYMENT_METHODS } from '../../config/shop';
import { AppError, asyncHandler, ok, paisaToBdt, dateBounds } from '../../common/http';
import { presentLedger } from '../../common/present';
import { moneySchema, objectIdSchema } from '../../common/schemas';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { Customer, Expense, LedgerEntry, Payment, Supplier } from '../../models';
import { addManualLedgerEntry, invalidateDashboard, recordPartyPayment } from '../../services/commerce';
import { writeAudit } from '../../services/platform';

const ledger = Router();
const expenses = Router();
const payments = Router();

ledger.use(requireAuth, requirePermission('ledger.view'));
expenses.use(requireAuth, requirePermission('expenses.view'));
payments.use(requireAuth, requirePermission('payments.view'));

ledger.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z.object({
      partyType: z.enum(['customer', 'supplier']),
      partyId: objectIdSchema,
    }).parse(req.query);
    const party = query.partyType === 'customer'
      ? await Customer.findById(query.partyId).lean()
      : await Supplier.findById(query.partyId).lean();
    if (!party) throw new AppError('Record not found', 404);
    const entries = await LedgerEntry.find({ partyType: query.partyType, partyId: query.partyId }).sort({ entryDate: 1, createdAt: 1 }).lean();
    return ok(res, {
      party: {
        id: party._id.toString(),
        name: party.name,
        phone: party.phone,
        address: party.address ?? '',
        notes: party.notes ?? '',
        businessName: 'businessName' in party ? party.businessName ?? '' : '',
        totalPurchases: paisaToBdt(party.totalPurchases),
        totalPaid: paisaToBdt(party.totalPaid),
        totalDue: paisaToBdt(party.totalDue),
      },
      entries: entries.map((entry) => presentLedger(entry)),
    }, 'Ledger fetched');
  }),
);

ledger.post(
  '/',
  requirePermission('ledger.manage'),
  asyncHandler(async (req, res) => {
    const input = z.object({
      partyType: z.enum(['customer', 'supplier']),
      partyId: objectIdSchema,
      direction: z.enum(['debit', 'credit']),
      amount: moneySchema,
      description: z.string().trim().min(2).max(1000),
      entryDate: z.coerce.date().optional(),
    }).parse(req.body);
    const entry = await addManualLedgerEntry({ ...input, auth: req.auth });
    if (!entry) throw new AppError('Could not save the ledger entry', 400);
    return ok(res, presentLedger(entry.toObject()), 'Ledger entry saved', 201);
  }),
);

const expenseSchema = z.object({
  title: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  amount: moneySchema.refine((value) => value > 0, 'Amount must be greater than zero'),
  expenseDate: z.coerce.date(),
  note: z.string().trim().max(300).optional().default(''),
});

function presentExpense(doc: { _id: { toString(): string }; title: string; category: string; amount: number; expenseDate: Date; note?: string }) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    category: doc.category,
    amount: paisaToBdt(doc.amount),
    expenseDate: doc.expenseDate,
    note: doc.note ?? '',
  };
}

expenses.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    const dates = dateBounds(typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined);
    if (dates) filter.expenseDate = dates;
    const items = await Expense.find(filter).sort({ expenseDate: -1 }).limit(200).lean();
    return ok(res, items.map((item) => presentExpense(item)), 'Expenses fetched');
  }),
);

expenses.post(
  '/',
  requirePermission('expenses.manage'),
  asyncHandler(async (req, res) => {
    const input = expenseSchema.parse(req.body);
    const expense = await Expense.create({ ...input, amount: Math.round(input.amount * 100), createdBy: req.auth?.id });
    await writeAudit(req.auth, 'create', 'expense', expense._id.toString());
    await invalidateDashboard();
    return ok(res, presentExpense(expense.toObject()), 'Expense recorded', 201);
  }),
);

expenses.delete(
  '/:id',
  requirePermission('expenses.manage'),
  asyncHandler(async (req, res) => {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) throw new AppError('Expense not found', 404);
    await writeAudit(req.auth, 'delete', 'expense', req.params.id);
    await invalidateDashboard();
    return ok(res, { id: req.params.id }, 'Expense deleted');
  }),
);

function presentPayment(doc: {
  _id: { toString(): string };
  partyType: string;
  partyName?: string;
  amount: number;
  method: string;
  status: string;
  transactionId?: string;
  note?: string;
  paidAt?: Date;
  createdAt?: Date;
}) {
  return {
    id: doc._id.toString(),
    partyType: doc.partyType,
    partyName: doc.partyName ?? '',
    amount: paisaToBdt(doc.amount),
    method: doc.method,
    status: doc.status,
    transactionId: doc.transactionId ?? '',
    note: doc.note ?? '',
    paidAt: doc.paidAt ?? doc.createdAt,
  };
}

payments.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    const dates = dateBounds(typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined);
    if (dates) filter.paidAt = dates;
    const items = await Payment.find(filter).sort({ paidAt: -1 }).limit(200).lean();
    return ok(res, items.map((item) => presentPayment(item)), 'Payments fetched');
  }),
);

payments.post(
  '/',
  requirePermission('payments.manage'),
  asyncHandler(async (req, res) => {
    const input = z.object({
      partyType: z.enum(['customer', 'supplier']),
      partyId: objectIdSchema,
      amount: moneySchema.refine((value) => value > 0, 'Amount must be greater than zero'),
      method: z.enum(PAYMENT_METHODS),
      transactionId: z.string().trim().max(80).optional(),
      note: z.string().trim().max(240).optional(),
      paidAt: z.coerce.date().optional(),
    }).parse(req.body);
    const payment = await recordPartyPayment({ ...input, auth: req.auth });
    return ok(res, presentPayment(payment.toObject()), 'Payment recorded', 201);
  }),
);

export const ledgerRouter = ledger;
export const expenseRouter = expenses;
export const paymentRouter = payments;
