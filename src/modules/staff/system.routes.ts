import { Readable } from 'node:stream';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AppError, asyncHandler, bdtToPaisa, ok } from '../../common/http';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { AuditLog, Notification, Staff } from '../../models';
import { destroyPrivateAsset, getSettings, presentSettings, privateAssetUrl, uploadImage, uploadPrivateAsset, writeAudit } from '../../services/platform';

const settings = Router();
const notifications = Router();
const uploads = Router();
const auth = Router();

notifications.use(requireAuth);
uploads.use(requireAuth, requirePermission('products.manage'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

auth.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const record = await Staff.findById(req.auth?.id).lean();
    return ok(res, {
      id: req.auth?.id,
      email: req.auth?.email,
      name: req.auth?.name,
      role: req.auth?.role,
      permissions: req.auth?.permissions,
      phone: record?.phone ?? '',
    }, 'Profile fetched');
  }),
);

const walletMethod = z.enum(['bkash', 'nagad', 'rocket']);

const qrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function acceptQr(req: Request, res: Response, next: NextFunction) {
  qrUpload.single('file')(req, res, (error: unknown) => {
    if (!error) return next();
    const coded = error as { code?: string; message?: string };
    if (coded.code === 'LIMIT_FILE_SIZE') return next(new AppError('File is too large', 413));
    return next(new AppError(coded.message || 'Upload rejected', 400));
  });
}

function qrRecord(method: 'bkash' | 'nagad' | 'rocket', current: Awaited<ReturnType<typeof getSettings>>) {
  if (method === 'bkash') return current.bkashQr;
  if (method === 'nagad') return current.nagadQr;
  return current.rocketQr;
}

settings.get(
  '/public',
  asyncHandler(async (_req, res) => {
    const current = await getSettings();
    return ok(res, presentSettings(current), 'Settings fetched');
  }),
);

settings.get(
  '/public/qr/:method',
  asyncHandler(async (req, res) => {
    const method = walletMethod.parse(req.params.method);
    const current = await getSettings();
    const file = qrRecord(method, current);
    if (!file?.publicId || !file.fileType) throw new AppError('QR code not found', 404);
    const upstream = await fetch(privateAssetUrl({
      publicId: file.publicId,
      resourceType: file.resourceType || 'image',
      fileType: file.fileType,
    }));
    if (!upstream.ok || !upstream.body) throw new AppError('Could not read the QR code', 502);
    res.setHeader('Content-Type', file.fileType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=300');
    Readable.fromWeb(upstream.body as import('stream/web').ReadableStream).pipe(res);
  }),
);

settings.post(
  '/qr/:method',
  requireAuth,
  requirePermission('settings.manage'),
  acceptQr,
  asyncHandler(async (req, res) => {
    const method = walletMethod.parse(req.params.method);
    const file = req.file;
    const extension = file?.originalname.split('.').pop()?.toLowerCase() ?? '';
    const allowed = file?.mimetype === 'image/png' ? ['png'] : file?.mimetype === 'image/jpeg' ? ['jpg', 'jpeg'] : [];
    if (!file || !allowed.includes(extension)) throw new AppError('Use a JPG, JPEG, or PNG file', 422);
    const current = await getSettings();
    const previous = qrRecord(method, current);
    const uploaded = await uploadPrivateAsset(file.buffer, `payment-qr/${method}`, file.originalname, file.mimetype);
    const next = {
      publicId: uploaded.publicId,
      resourceType: uploaded.resourceType,
      fileType: uploaded.fileType,
      uploadedAt: new Date(),
    };
    if (method === 'bkash') current.bkashQr = next;
    else if (method === 'nagad') current.nagadQr = next;
    else current.rocketQr = next;
    await current.save();
    if (previous?.publicId) await destroyPrivateAsset(previous.publicId, previous.resourceType || 'image').catch(() => undefined);
    await writeAudit(req.auth, 'upload', 'payment-qr', current._id.toString(), { method });
    return ok(res, presentSettings(current), 'QR code saved');
  }),
);

settings.get(
  '/',
  requireAuth,
  requirePermission('settings.manage'),
  asyncHandler(async (_req, res) => {
    const current = await getSettings();
    return ok(res, presentSettings(current), 'Settings fetched');
  }),
);

settings.patch(
  '/',
  requireAuth,
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    const input = z.object({
      onlineOrderingEnabled: z.boolean().optional(),
      deliveryCharge: z.coerce.number().min(0).optional(),
      taxPercent: z.coerce.number().min(0).max(100).optional(),
      bkashNumber: z.string().trim().max(20).optional(),
      nagadNumber: z.string().trim().max(20).optional(),
      rocketNumber: z.string().trim().max(20).optional(),
      bankName: z.string().trim().min(2).max(80).optional(),
      bankBranch: z.string().trim().min(2).max(80).optional(),
      bankAccountName: z.string().trim().min(2).max(80).optional(),
      bankAccountNumber: z.string().trim().min(4).max(30).optional(),
      bankRoutingNumber: z.string().trim().min(3).max(20).optional(),
    }).parse(req.body);
    const current = await getSettings();
    if (input.onlineOrderingEnabled != null) current.onlineOrderingEnabled = input.onlineOrderingEnabled;
    if (input.deliveryCharge != null) current.deliveryCharge = bdtToPaisa(input.deliveryCharge);
    if (input.taxPercent != null) current.taxPercent = input.taxPercent;
    if (input.bkashNumber != null) current.bkashNumber = input.bkashNumber;
    if (input.nagadNumber != null) current.nagadNumber = input.nagadNumber;
    if (input.rocketNumber != null) current.rocketNumber = input.rocketNumber;
    if (input.bankName != null) current.bankName = input.bankName;
    if (input.bankBranch != null) current.bankBranch = input.bankBranch;
    if (input.bankAccountName != null) current.bankAccountName = input.bankAccountName;
    if (input.bankAccountNumber != null) current.bankAccountNumber = input.bankAccountNumber;
    if (input.bankRoutingNumber != null) current.bankRoutingNumber = input.bankRoutingNumber;
    await current.save();
    await writeAudit(req.auth, 'update', 'settings', current._id.toString(), input);
    return ok(res, presentSettings(current), 'Settings updated');
  }),
);

notifications.get(
  '/',
  asyncHandler(async (_req, res) => {
    const items = await Notification.find().sort({ createdAt: -1 }).limit(40).lean();
    return ok(res, {
      unread: items.filter((item) => !item.read).length,
      items: items.map((item) => ({
        id: item._id.toString(),
        type: item.type,
        title: item.title,
        message: item.message,
        read: item.read,
        createdAt: item.createdAt,
      })),
    }, 'Notifications fetched');
  }),
);

notifications.patch(
  '/read-all',
  asyncHandler(async (_req, res) => {
    await Notification.updateMany({ read: false }, { read: true });
    return ok(res, { read: true }, 'Notifications marked read');
  }),
);

notifications.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await Notification.findByIdAndUpdate(req.params.id, { read: true });
    return ok(res, { id: req.params.id }, 'Notification updated');
  }),
);

const audit = Router();
audit.use(requireAuth, requirePermission('audit.view'));
audit.get(
  '/',
  asyncHandler(async (_req, res) => {
    const items = await AuditLog.find().sort({ createdAt: -1 }).limit(100).lean();
    return ok(res, items.map((item) => ({
      id: item._id.toString(),
      userEmail: item.userEmail,
      action: item.action,
      entity: item.entity,
      entityId: item.entityId,
      metadata: item.metadata,
      createdAt: item.createdAt,
    })), 'Audit log fetched');
  }),
);

uploads.post(
  '/',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Choose an image', 422);
    const image = await uploadImage(req.file.buffer, 'uploads');
    return ok(res, image, 'Image uploaded', 201);
  }),
);

export const settingsRouter = settings;
export const notificationRouter = notifications;
export const auditRouter = audit;
export const uploadRouter = uploads;
export const authRouter = auth;
