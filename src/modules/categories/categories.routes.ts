import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler, ok } from '../../common/http';
import { presentCategory } from '../../common/present';
import { objectIdSchema } from '../../common/schemas';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { Category, Product } from '../../models';
import { cacheDel, cacheGet, cacheSet } from '../../db/redis';
import { writeAudit } from '../../services/platform';

const router = Router();

const categorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  nameBn: z.string().trim().max(80).optional().default(''),
  description: z.string().trim().max(500).optional().default(''),
  descriptionBn: z.string().trim().max(500).optional().default(''),
  status: z.enum(['active', 'inactive']).optional(),
  image: z.object({ secureUrl: z.string().url(), publicId: z.string().min(1) }).nullable().optional(),
});

function slugify(name: string) {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `category-${Date.now()}`;
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const cached = await cacheGet<ReturnType<typeof presentCategory>[]>('categories:public');
    if (cached) return ok(res, cached, 'Categories fetched');
    const categories = await Category.find({ status: 'active' }).sort({ name: 1 }).lean();
    const data = categories.map((item) => presentCategory(item));
    await cacheSet('categories:public', data, 60);
    return ok(res, data, 'Categories fetched');
  }),
);

router.get(
  '/manage',
  requireAuth,
  requirePermission('products.view'),
  asyncHandler(async (_req, res) => {
    const categories = await Category.find().sort({ name: 1 }).lean();
    return ok(res, categories.map((item) => presentCategory(item)), 'Categories fetched');
  }),
);

router.post(
  '/',
  requireAuth,
  requirePermission('categories.manage'),
  asyncHandler(async (req, res) => {
    const input = categorySchema.parse(req.body);
    const category = await Category.create({ ...input, slug: slugify(input.name), status: input.status ?? 'active' });
    await cacheDel('categories:public');
    await writeAudit(req.auth, 'create', 'category', category._id.toString());
    return ok(res, presentCategory(category.toObject()), 'Category created successfully', 201);
  }),
);

router.patch(
  '/:id',
  requireAuth,
  requirePermission('categories.manage'),
  asyncHandler(async (req, res) => {
    const input = categorySchema.partial().parse(req.body);
    const category = await Category.findById(req.params.id);
    if (!category) throw new AppError('Category not found', 404);
    if (input.name != null) {
      category.name = input.name;
      category.slug = slugify(input.name);
    }
    if (input.nameBn != null) category.nameBn = input.nameBn;
    if (input.description != null) category.description = input.description;
    if (input.descriptionBn != null) category.descriptionBn = input.descriptionBn;
    if (input.status != null) category.status = input.status;
    if (input.image !== undefined) category.image = input.image ?? undefined;
    await category.save();
    await cacheDel('categories:public');
    await writeAudit(req.auth, 'update', 'category', category._id.toString());
    return ok(res, presentCategory(category.toObject()), 'Category updated successfully');
  }),
);

router.delete(
  '/:id',
  requireAuth,
  requirePermission('categories.manage'),
  asyncHandler(async (req, res) => {
    objectIdSchema.parse(req.params.id);
    const used = await Product.exists({ category: req.params.id });
    if (used) throw new AppError('Move products out of this category before deleting it', 409);
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) throw new AppError('Category not found', 404);
    await cacheDel('categories:public');
    await writeAudit(req.auth, 'delete', 'category', req.params.id);
    return ok(res, { id: req.params.id }, 'Category deleted successfully');
  }),
);

export const categoryRouter = router;
