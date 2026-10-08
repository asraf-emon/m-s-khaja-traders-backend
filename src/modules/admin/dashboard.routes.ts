import { Router } from 'express';
import { asyncHandler, dhakaDayRange, hasPermission, ok, paisaToBdt } from '../../common/http';
import { presentProduct } from '../../common/present';
import { requireAuth } from '../../middleware/auth';
import { Customer, Expense, Order, Product, Purchase, Sale } from '../../models';
import { cacheGet, cacheSet } from '../../db/redis';

const router = Router();
router.use(requireAuth);

function dhakaKey(offset: number) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

function summarize(sales: { subtotal: number; discount: number; total: number; items: { purchasePrice: number; quantity: number }[] }[]) {
  let revenue = 0;
  let cost = 0;
  let billed = 0;
  for (const sale of sales) {
    revenue += sale.subtotal - sale.discount;
    billed += sale.total;
    for (const item of sale.items) cost += Math.round(item.purchasePrice * item.quantity);
  }
  const profit = revenue - cost;
  return {
    sales: paisaToBdt(billed),
    revenue: paisaToBdt(revenue),
    cost: paisaToBdt(cost),
    profit: paisaToBdt(profit),
    margin: revenue === 0 ? 0 : Math.round((profit / revenue) * 1000) / 10,
  };
}

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const canSeeProfit = hasPermission(req.auth, 'reports.view');
    const cacheKey = canSeeProfit ? 'dashboard:stats:full' : 'dashboard:stats:ops';
    const cached = await cacheGet<unknown>(cacheKey);
    if (cached) return ok(res, cached, 'Dashboard fetched');

    const today = dhakaDayRange();
    const lowStockFilter = { status: 'active' as const, $expr: { $lte: ['$stock', '$minimumStock'] } };
    const [sales, purchases, expenses, customers, products, lowStockCount, lowStockDocs, pendingOrders, customerDue] = await Promise.all([
      Sale.find().lean(),
      Purchase.find().lean(),
      Expense.find().lean(),
      Customer.countDocuments(),
      Product.countDocuments({ status: 'active' }),
      Product.countDocuments(lowStockFilter),
      Product.find(lowStockFilter).populate('category', 'name nameBn slug').sort({ stock: 1 }).limit(8).lean(),
      Order.countDocuments({ orderStatus: { $in: ['pending', 'confirmed', 'processing'] } }),
      Customer.aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: '$totalDue' } } }]),
    ]);

    const todaySales = sales.filter((sale) => sale.saleDate >= today.start && sale.saleDate <= today.end);
    const todayPurchases = purchases.filter((purchase) => purchase.purchaseDate >= today.start && purchase.purchaseDate <= today.end);
    const todayExpenses = expenses.filter((expense) => expense.expenseDate >= today.start && expense.expenseDate <= today.end);
    const profit = summarize(sales);
    const todayProfit = summarize(todaySales);

    const trend = [];
    for (let offset = -6; offset <= 0; offset += 1) {
      const key = dhakaKey(offset);
      const start = new Date(`${key}T00:00:00.000+06:00`);
      const end = new Date(`${key}T23:59:59.999+06:00`);
      const daySales = sales.filter((sale) => sale.saleDate >= start && sale.saleDate <= end);
      const day = summarize(daySales);
      trend.push({ date: key, sales: day.sales, profit: canSeeProfit ? day.profit : null });
    }

    const categoryMap = new Map<string, number>();
    const populated = await Product.find({ status: 'active' }).populate('category', 'name').lean();
    for (const product of populated) {
      const name = product.category && typeof product.category === 'object' && 'name' in product.category
        ? String((product.category as { name: string }).name)
        : 'Other';
      categoryMap.set(name, (categoryMap.get(name) ?? 0) + 1);
    }

    const data = {
      today: {
        sales: todayProfit.sales,
        purchase: paisaToBdt(todayPurchases.reduce((sum, item) => sum + item.total, 0)),
        profit: canSeeProfit ? todayProfit.profit : null,
        expenses: paisaToBdt(todayExpenses.reduce((sum, item) => sum + item.amount, 0)),
      },
      totals: {
        sales: profit.sales,
        purchase: paisaToBdt(purchases.reduce((sum, item) => sum + item.total, 0)),
        profit: canSeeProfit ? profit.profit : null,
        due: paisaToBdt(customerDue[0]?.total ?? 0),
        customers,
        products,
        lowStock: lowStockCount,
        pendingOrders,
        expenses: paisaToBdt(expenses.reduce((sum, item) => sum + item.amount, 0)),
      },
      profit: canSeeProfit ? profit : null,
      lowStock: lowStockDocs.map((item) => presentProduct(item, true)),
      trend,
      categories: [...categoryMap.entries()].map(([name, count]) => ({ name, count })),
    };

    await cacheSet(cacheKey, data, 30);
    return ok(res, data, 'Dashboard fetched');
  }),
);

export const dashboardRouter = router;
