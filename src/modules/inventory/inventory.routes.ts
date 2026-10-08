import { Router } from 'express';
import { z } from 'zod';
import { INVENTORY_TYPES } from '../../config/shop';
import { AppError, asyncHandler, ok, paisaToBdt, dateBounds } from '../../common/http';
import { presentProduct, stockStatus } from '../../common/present';
import { objectIdSchema, qtySchema } from '../../common/schemas';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { InventoryTransaction, Product } from '../../models';
import { applyStockChange, invalidateDashboard } from '../../services/commerce';
import { writeAudit } from '../../services/platform';

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  requirePermission('inventory.view'),
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { status: 'active' };
    if (req.query.stock === 'low') filter.$expr = { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$minimumStock'] }] };
    if (req.query.stock === 'out') filter.stock = 0;
    const products = await Product.find(filter).populate('category', 'name nameBn slug').sort({ name: 1 }).lean();
    return ok(res, products.map((item) => presentProduct(item, true)), 'Inventory fetched');
  }),
);

router.get(
  '/history',
  requirePermission('inventory.view'),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const filter: Record<string, unknown> = {};
    if (typeof req.query.productId === 'string' && req.query.productId) filter.product = req.query.productId;
    if (typeof req.query.type === 'string' && req.query.type) filter.type = req.query.type;
    const dates = dateBounds(typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined);
    if (dates) filter.createdAt = dates;
    const [items, total] = await Promise.all([
      InventoryTransaction.find(filter).populate('product', 'name sku unit').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      InventoryTransaction.countDocuments(filter),
    ]);
    return ok(res, {
      items: items.map((item) => {
        const product = item.product && typeof item.product === 'object' && 'name' in item.product
          ? item.product as unknown as { _id: { toString(): string }; name: string; sku: string; unit: string }
          : null;
        return {
          id: item._id.toString(),
          type: item.type,
          quantity: item.quantity,
          quantityChange: item.quantityChange,
          purchasePrice: paisaToBdt(item.purchasePrice),
          sellingPrice: paisaToBdt(item.sellingPrice),
          reference: item.reference,
          note: item.note,
          product: product ? { id: product._id.toString(), name: product.name, sku: product.sku, unit: product.unit } : null,
          createdAt: item.createdAt,
        };
      }),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
    }, 'Inventory history fetched');
  }),
);

const adjustSchema = z.object({
  productId: objectIdSchema,
  type: z.enum(INVENTORY_TYPES),
  quantity: qtySchema,
  direction: z.enum(['in', 'out']).optional(),
  note: z.string().trim().max(300).optional().default(''),
});

router.post(
  '/adjust',
  requirePermission('inventory.manage'),
  asyncHandler(async (req, res) => {
    const input = adjustSchema.parse(req.body);
    if (input.type === 'purchase' || input.type === 'sale') {
      throw new AppError('Use purchase or sale records for those stock movements', 422);
    }
    const signed = input.type === 'damage' || (input.type === 'adjustment' && input.direction !== 'in')
      ? -input.quantity
      : input.quantity;
    if (input.type === 'adjustment' && !input.direction) throw new AppError('Choose stock in or stock out', 422);
    const product = await applyStockChange({
      productId: input.productId,
      quantityChange: signed,
      type: input.type,
      note: input.note,
      createdBy: req.auth?.id,
    });
    await writeAudit(req.auth, 'adjust', 'inventory', product._id.toString(), { type: input.type, quantity: signed });
    await invalidateDashboard();
    return ok(res, {
      id: product._id.toString(),
      stock: product.stock,
      stockStatus: stockStatus(product.stock, product.minimumStock),
    }, 'Inventory updated');
  }),
);

export const inventoryRouter = router;
