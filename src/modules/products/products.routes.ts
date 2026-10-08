import { Router } from 'express';
import { z } from 'zod';
import { UNITS } from '../../config/shop';
import { asyncHandler, escapeRegex, ok } from '../../common/http';
import { presentProduct } from '../../common/present';
import { objectIdSchema } from '../../common/schemas';
import { bdtToPaisa } from '../../common/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { Category, Order, Product, Purchase, Sale } from '../../models';
import { applyStockChange, invalidateDashboard } from '../../services/commerce';
import { destroyImage, uploadImage, writeAudit } from '../../services/platform';
import multer from 'multer';
import { AppError } from '../../common/http';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const router = Router();

const productSchema = z.object({
  name: z.string().trim().min(2).max(160),
  nameBn: z.string().trim().max(160).optional().default(''),
  description: z.string().trim().max(4000).optional().default(''),
  descriptionBn: z.string().trim().max(4000).optional().default(''),
  sku: z.string().trim().min(2).max(40),
  barcode: z.string().trim().max(64).optional().default(''),
  categoryId: objectIdSchema,
  unit: z.enum(UNITS),
  purchasePrice: z.coerce.number().min(0),
  sellingPrice: z.coerce.number().min(0),
  wholesalePrice: z.coerce.number().min(0),
  minimumSellingPrice: z.coerce.number().min(0).optional(),
  stock: z.coerce.number().min(0).optional(),
  minimumStock: z.coerce.number().min(0),
  status: z.enum(['active', 'inactive']).optional(),
  isFeatured: z.boolean().optional(),
});

function paging(query: Record<string, unknown>, fallback = 12) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(60, Math.max(1, Number(query.limit) || fallback));
  return { page, limit, skip: (page - 1) * limit };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = paging(req.query as Record<string, unknown>);
    const filter: Record<string, unknown> = { status: 'active' };
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: pattern }, { nameBn: pattern }, { sku: pattern }, { barcode: pattern }];
    }
    if (typeof req.query.category === 'string' && req.query.category) filter.category = req.query.category;
    if (req.query.featured === 'true') filter.isFeatured = true;

    const minPrice = Number(req.query.minPrice);
    const maxPrice = Number(req.query.maxPrice);
    if (Number.isFinite(minPrice) && req.query.minPrice) filter.sellingPrice = { ...(filter.sellingPrice as object), $gte: bdtToPaisa(minPrice) };
    if (Number.isFinite(maxPrice) && req.query.maxPrice) {
      filter.sellingPrice = { ...((filter.sellingPrice as object) || {}), $lte: bdtToPaisa(maxPrice) };
    }

    if (req.query.stock === 'out') filter.stock = 0;
    if (req.query.stock === 'low') filter.$expr = { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$minimumStock'] }] };
    if (req.query.stock === 'in') filter.$expr = { $gt: ['$stock', '$minimumStock'] };

    const sortMap = {
      price_asc: { sellingPrice: 1 },
      price_desc: { sellingPrice: -1 },
      name: { name: 1 },
      newest: { createdAt: -1 },
    } as const;
    const sortKey = typeof req.query.sort === 'string' && req.query.sort in sortMap ? (req.query.sort as keyof typeof sortMap) : 'newest';

    const [items, total] = await Promise.all([
      Product.find(filter).populate('category', 'name nameBn slug').sort(sortMap[sortKey]).skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);

    return ok(res, {
      items: items.map((item) => presentProduct(item, false)),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
    }, 'Products fetched');
  }),
);

router.get(
  '/manage',
  requireAuth,
  requirePermission('products.view'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = paging(req.query as Record<string, unknown>, 20);
    const filter: Record<string, unknown> = {};
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: pattern }, { nameBn: pattern }, { sku: pattern }, { barcode: pattern }];
    }
    if (typeof req.query.category === 'string' && req.query.category) filter.category = req.query.category;
    if (typeof req.query.status === 'string' && req.query.status) filter.status = req.query.status;
    const [items, total] = await Promise.all([
      Product.find(filter).populate('category', 'name nameBn slug').sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);
    return ok(res, {
      items: items.map((item) => presentProduct(item, true)),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
    }, 'Products fetched');
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id).populate('category', 'name nameBn slug').lean();
    if (!product || product.status !== 'active') throw new AppError('Product not found', 404);
    return ok(res, presentProduct(product, false), 'Product fetched');
  }),
);

router.get(
  '/:id/manage',
  requireAuth,
  requirePermission('products.view'),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id).populate('category', 'name nameBn slug').lean();
    if (!product) throw new AppError('Product not found', 404);
    return ok(res, presentProduct(product, true), 'Product fetched');
  }),
);

function pricesOrThrow(input: z.infer<typeof productSchema>) {
  const purchasePrice = bdtToPaisa(input.purchasePrice);
  const sellingPrice = bdtToPaisa(input.sellingPrice);
  const wholesalePrice = bdtToPaisa(input.wholesalePrice);
  const minimumSellingPrice = bdtToPaisa(input.minimumSellingPrice ?? input.purchasePrice);
  if (sellingPrice < minimumSellingPrice || wholesalePrice < minimumSellingPrice) {
    throw new AppError('Selling and wholesale prices must be at least the minimum selling price', 422);
  }
  return { purchasePrice, sellingPrice, wholesalePrice, minimumSellingPrice };
}

router.post(
  '/',
  requireAuth,
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const input = productSchema.parse(req.body);
    const category = await Category.findById(input.categoryId);
    if (!category) throw new AppError('Category not found', 404);
    const prices = pricesOrThrow(input);
    const product = await Product.create({
      name: input.name,
      nameBn: input.nameBn,
      description: input.description,
      descriptionBn: input.descriptionBn,
      sku: input.sku.toUpperCase(),
      barcode: input.barcode,
      category: category._id,
      unit: input.unit,
      ...prices,
      stock: 0,
      minimumStock: input.minimumStock,
      status: input.status ?? 'active',
      isFeatured: Boolean(input.isFeatured),
      createdBy: req.auth?.id,
    });
    if ((input.stock ?? 0) > 0) {
      await applyStockChange({
        productId: product._id.toString(),
        quantityChange: input.stock ?? 0,
        type: 'adjustment',
        note: 'Opening stock',
        createdBy: req.auth?.id,
      });
    }
    await writeAudit(req.auth, 'create', 'product', product._id.toString(), { sku: product.sku });
    await invalidateDashboard();
    const fresh = await Product.findById(product._id).populate('category', 'name nameBn slug').lean();
    return ok(res, presentProduct(fresh!, true), 'Product created successfully', 201);
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const input = productSchema.partial().parse(req.body);
    const product = await Product.findById(req.params.id);
    if (!product) throw new AppError('Product not found', 404);
    if (input.categoryId) {
      const category = await Category.findById(input.categoryId);
      if (!category) throw new AppError('Category not found', 404);
      product.category = category._id;
    }
    if (input.name != null) product.name = input.name;
    if (input.nameBn != null) product.nameBn = input.nameBn;
    if (input.description != null) product.description = input.description;
    if (input.descriptionBn != null) product.descriptionBn = input.descriptionBn;
    if (input.sku != null) product.sku = input.sku.toUpperCase();
    if (input.barcode != null) product.barcode = input.barcode;
    if (input.unit != null) product.unit = input.unit;
    if (input.minimumStock != null) product.minimumStock = input.minimumStock;
    if (input.status != null) product.status = input.status;
    if (input.isFeatured != null) product.isFeatured = input.isFeatured;
    if (input.purchasePrice != null) product.purchasePrice = bdtToPaisa(input.purchasePrice);
    if (input.sellingPrice != null) product.sellingPrice = bdtToPaisa(input.sellingPrice);
    if (input.wholesalePrice != null) product.wholesalePrice = bdtToPaisa(input.wholesalePrice);
    if (input.minimumSellingPrice != null) product.minimumSellingPrice = bdtToPaisa(input.minimumSellingPrice);
    if (product.sellingPrice < product.minimumSellingPrice || product.wholesalePrice < product.minimumSellingPrice) {
      throw new AppError('Selling and wholesale prices must be at least the minimum selling price', 422);
    }
    await product.save();
    if (input.stock != null && input.stock !== product.stock) {
      await applyStockChange({
        productId: product._id.toString(),
        quantityChange: input.stock - product.stock,
        type: 'adjustment',
        note: 'Stock edited from product form',
        createdBy: req.auth?.id,
      });
    }
    await writeAudit(req.auth, 'update', 'product', product._id.toString(), { fields: Object.keys(input) });
    await invalidateDashboard();
    const fresh = await Product.findById(product._id).populate('category', 'name nameBn slug').lean();
    return ok(res, presentProduct(fresh!, true), 'Product updated successfully');
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) throw new AppError('Product not found', 404);
    const used = await Sale.exists({ 'items.product': product._id })
      || await Purchase.exists({ 'items.product': product._id })
      || await Order.exists({ 'items.product': product._id });
    if (used) {
      product.status = 'inactive';
      await product.save();
      await writeAudit(req.auth, 'archive', 'product', product._id.toString());
      return ok(res, { id: product._id.toString(), status: 'inactive' }, 'Product archived because it has history');
    }
    for (const image of product.images) await destroyImage(image.publicId);
    await product.deleteOne();
    await writeAudit(req.auth, 'delete', 'product', req.params.id);
    await invalidateDashboard();
    return ok(res, { id: req.params.id }, 'Product deleted successfully');
  }),
);

router.post(
  '/:id/images',
  requireAuth,
  requirePermission('products.manage'),
  upload.array('images', 6),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) throw new AppError('Product not found', 404);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new AppError('Choose at least one image', 422);
    const uploaded = [];
    for (const file of files) uploaded.push(await uploadImage(file.buffer, 'products'));
    product.images.push(...uploaded);
    await product.save();
    await writeAudit(req.auth, 'upload', 'product', product._id.toString(), { count: uploaded.length });
    return ok(res, uploaded, 'Images uploaded');
  }),
);

router.delete(
  '/:id/images',
  requireAuth,
  requirePermission('products.manage'),
  asyncHandler(async (req, res) => {
    const body = z.object({ publicId: z.string().min(1) }).parse(req.body);
    const product = await Product.findById(req.params.id);
    if (!product) throw new AppError('Product not found', 404);
    const image = product.images.find((item) => item.publicId === body.publicId);
    if (!image) throw new AppError('Image not found', 404);
    await destroyImage(image.publicId);
    const kept = product.images
      .filter((item) => item.publicId !== body.publicId)
      .map((item) => ({ secureUrl: item.secureUrl, publicId: item.publicId }));
    product.images.splice(0, product.images.length, ...kept);
    await product.save();
    return ok(res, { publicId: body.publicId }, 'Image removed');
  }),
);

export const productRouter = router;
