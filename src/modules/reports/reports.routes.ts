import { Router } from 'express';
import { asyncHandler, ok, paisaToBdt, parseDateRange } from '../../common/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { Customer, Expense, Product, Purchase, Sale, Supplier } from '../../models';

const router = Router();
router.use(requireAuth, requirePermission('reports.view'));

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { start, end } = parseDateRange(typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined);
    const [sales, purchases, expenses, customers, suppliers, products] = await Promise.all([
      Sale.find({ saleDate: { $gte: start, $lte: end } }).lean(),
      Purchase.find({ purchaseDate: { $gte: start, $lte: end } }).lean(),
      Expense.find({ expenseDate: { $gte: start, $lte: end } }).lean(),
      Customer.find({ totalDue: { $gt: 0 } }).sort({ totalDue: -1 }).lean(),
      Supplier.find({ totalDue: { $gt: 0 } }).sort({ totalDue: -1 }).lean(),
      Product.find().sort({ name: 1 }).lean(),
    ]);

    let revenue = 0;
    let cost = 0;
    let billed = 0;
    const best = new Map<string, { name: string; quantity: number; revenue: number }>();
    for (const sale of sales) {
      revenue += sale.subtotal - sale.discount;
      billed += sale.total;
      for (const item of sale.items) {
        cost += Math.round(item.purchasePrice * item.quantity);
        const key = item.sku || item.name;
        const current = best.get(key) ?? { name: item.name, quantity: 0, revenue: 0 };
        current.quantity += item.quantity;
        current.revenue += item.total;
        best.set(key, current);
      }
    }
    const profit = revenue - cost;
    const expenseTotal = expenses.reduce((sum, item) => sum + item.amount, 0);

    return ok(res, {
      from: start.toISOString(),
      to: end.toISOString(),
      sales: paisaToBdt(billed),
      purchase: paisaToBdt(purchases.reduce((sum, item) => sum + item.total, 0)),
      revenue: paisaToBdt(revenue),
      cost: paisaToBdt(cost),
      profit: paisaToBdt(profit),
      margin: revenue === 0 ? 0 : Math.round((profit / revenue) * 1000) / 10,
      expenses: paisaToBdt(expenseTotal),
      netProfit: paisaToBdt(profit - expenseTotal),
      bestsellers: [...best.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 8).map((item) => ({
        ...item,
        revenue: paisaToBdt(item.revenue),
      })),
      customerDues: customers.map((item) => ({ id: item._id.toString(), name: item.name, phone: item.phone, due: paisaToBdt(item.totalDue) })),
      supplierDues: suppliers.map((item) => ({ id: item._id.toString(), name: item.name, phone: item.phone, due: paisaToBdt(item.totalDue) })),
      inventory: products.map((item) => ({
        id: item._id.toString(),
        name: item.name,
        sku: item.sku,
        stock: item.stock,
        unit: item.unit,
        stockValue: paisaToBdt(Math.round(item.stock * item.purchasePrice)),
      })),
    }, 'Report fetched');
  }),
);

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const { start, end } = parseDateRange(typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined);
    const type = req.query.type === 'purchases' || req.query.type === 'expenses' ? req.query.type : 'sales';
    const columns = type === 'sales'
      ? ['Number', 'Date', 'Total', 'Paid', 'Due', 'Method']
      : type === 'purchases'
        ? ['Number', 'Date', 'Total', 'Paid', 'Due']
        : ['Title', 'Category', 'Date', 'Amount'];
    const rows: string[][] = [];

    if (type === 'sales') {
      const sales = await Sale.find({ saleDate: { $gte: start, $lte: end } }).sort({ saleDate: 1 }).lean();
      for (const sale of sales) {
        rows.push([sale.number, sale.saleDate.toISOString().slice(0, 10), String(paisaToBdt(sale.total)), String(paisaToBdt(sale.paidAmount)), String(paisaToBdt(sale.dueAmount)), sale.paymentMethod]);
      }
    } else if (type === 'purchases') {
      const purchases = await Purchase.find({ purchaseDate: { $gte: start, $lte: end } }).sort({ purchaseDate: 1 }).lean();
      for (const purchase of purchases) {
        rows.push([purchase.number, purchase.purchaseDate.toISOString().slice(0, 10), String(paisaToBdt(purchase.total)), String(paisaToBdt(purchase.paidAmount)), String(paisaToBdt(purchase.dueAmount))]);
      }
    } else {
      const expenses = await Expense.find({ expenseDate: { $gte: start, $lte: end } }).sort({ expenseDate: 1 }).lean();
      for (const expense of expenses) {
        rows.push([expense.title, expense.category, expense.expenseDate.toISOString().slice(0, 10), String(paisaToBdt(expense.amount))]);
      }
    }

    return ok(res, { type, columns, rows }, 'Report fetched');
  }),
);

export const reportRouter = router;
