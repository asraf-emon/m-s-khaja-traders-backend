import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env } from './config/env';
import { ok } from './common/http';
import { getRedisStatus } from './db/redis';
import { errorHandler, notFound } from './middleware/errorHandler';
import { rateLimit } from './services/platform';
import { productRouter } from './modules/products/products.routes';
import { categoryRouter } from './modules/categories/categories.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { purchaseRouter, saleRouter } from './modules/purchases/trade.routes';
import { orderRouter, stripeWebhook } from './modules/orders/orders.routes';
import { customerRouter, supplierRouter } from './modules/customers/parties.routes';
import { expenseRouter, ledgerRouter, paymentRouter } from './modules/ledger/finance.routes';
import { dashboardRouter } from './modules/admin/dashboard.routes';
import { reportRouter } from './modules/reports/reports.routes';
import { auditRouter, authRouter, notificationRouter, settingsRouter, uploadRouter } from './modules/staff/system.routes';
import { staffRouter } from './modules/staff/staff.routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  const allowedOrigins = env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  }));
  app.post('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
  app.use(express.json({ limit: '1mb' }));
  app.use(rateLimit('api', 300, 15 * 60));

  app.get('/api/health', (_req, res) => {
    const mongo = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    return ok(res, { mongo, redis: getRedisStatus(), database: 'inventory-management' }, 'Healthy');
  });

  app.use('/api/auth', authRouter);
  app.use('/api/products', productRouter);
  app.use('/api/categories', categoryRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/purchases', purchaseRouter);
  app.use('/api/sales', saleRouter);
  app.use('/api/orders', rateLimit('orders', 30, 15 * 60), orderRouter);
  app.use('/api/customers', customerRouter);
  app.use('/api/suppliers', supplierRouter);
  app.use('/api/ledger', ledgerRouter);
  app.use('/api/expenses', expenseRouter);
  app.use('/api/payments', paymentRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/reports', reportRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/uploads', uploadRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
