import { Readable } from 'node:stream';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { PERMISSIONS, STAFF_DEFAULT_PERMISSIONS } from '../../config/shop';
import { AppError, asyncHandler, escapeRegex, ok } from '../../common/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { Staff } from '../../models';
import { destroyPrivateAsset, getFirebase, privateAssetUrl, uploadPrivateAsset, writeAudit, type PrivateAsset } from '../../services/platform';

const staff = Router();
staff.use(requireAuth, requireRole('ADMIN'));

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const nidUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

function acceptUpload(uploader: multer.Multer, field: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    uploader.single(field)(req, res, (error: unknown) => {
      if (!error) return next();
      const coded = error as { code?: string; message?: string };
      if (coded.code === 'LIMIT_FILE_SIZE') return next(new AppError('File is too large', 413));
      return next(new AppError(coded.message || 'Upload rejected', 400));
    });
  };
}

function extensionOf(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function assertFile(file: Express.Multer.File | undefined, allowed: Record<string, string[]>) {
  if (!file) throw new AppError('Choose a file', 422);
  const extensions = allowed[file.mimetype];
  const extension = extensionOf(file.originalname);
  if (!extensions?.includes(extension)) {
    throw new AppError('Use a PDF, JPG, JPEG, or PNG file', 422);
  }
  return file;
}

const staffBody = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(300).optional(),
  details: z.string().trim().max(2000).optional(),
  nidNumber: z.string().trim().max(30).optional(),
  email: z.union([z.string().trim().email(), z.literal('')]).optional(),
  password: z.union([z.string().min(8).max(64), z.literal('')]).optional(),
  role: z.enum(['ADMIN', 'STAFF']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

function presentFile(file?: { fileType?: string; originalName?: string; uploadedAt?: Date } | null) {
  if (!file?.fileType) return null;
  return {
    fileType: file.fileType,
    originalName: file.originalName ?? '',
    uploadedAt: file.uploadedAt,
  };
}

function presentStaff(doc: {
  _id: { toString(): string };
  name: string;
  phone?: string;
  address?: string;
  details?: string;
    email?: string | null;
  role: string;
  status: string;
  nidNumber?: string;
  photo?: { publicId?: string } | null;
  nidDocument?: { fileType?: string; originalName?: string; uploadedAt?: Date; publicId?: string } | null;
  createdAt?: Date;
  updatedAt?: Date;
}, includeSensitive: boolean) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    phone: doc.phone ?? '',
    address: doc.address ?? '',
    details: doc.details ?? '',
    email: doc.email ?? '',
    role: doc.role,
    status: doc.status,
    hasPhoto: Boolean(doc.photo?.publicId),
    hasNid: Boolean(doc.nidDocument?.publicId),
    nidNumber: includeSensitive ? doc.nidNumber ?? '' : '',
    nidDocument: includeSensitive ? presentFile(doc.nidDocument) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function sendPrivateFile(res: Response, file: PrivateAsset | null | undefined, disposition: 'inline' | 'attachment') {
  if (!file?.publicId) throw new AppError('File not found', 404);
  const upstream = await fetch(privateAssetUrl(file));
  if (!upstream.ok || !upstream.body) throw new AppError('Could not read the stored file', 502);
  const filename = (file.originalName || 'document').replace(/[^a-zA-Z0-9._-]/g, '_') || 'document';
  res.setHeader('Content-Type', file.fileType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  Readable.fromWeb(upstream.body as import('stream/web').ReadableStream).pipe(res);
}

staff.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z.object({
      q: z.string().trim().max(80).optional().default(''),
      status: z.enum(['active', 'inactive', 'all']).optional().default('all'),
    }).parse(req.query);
    const filter: Record<string, unknown> = {};
    if (query.status !== 'all') filter.status = query.status;
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: pattern }, { phone: pattern }, { address: pattern }, { nidNumber: pattern }];
    }
    const items = await Staff.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    return ok(res, items.map((item) => presentStaff(item, false)), 'Staff fetched');
  }),
);

staff.get(
  '/:id/photo',
  asyncHandler(async (req, res) => {
    const record = await Staff.findById(req.params.id).lean();
    if (!record) throw new AppError('Staff not found', 404);
    await sendPrivateFile(res, record.photo ?? undefined, 'inline');
  }),
);

staff.get(
  '/:id/nid',
  asyncHandler(async (req, res) => {
    const record = await Staff.findById(req.params.id).lean();
    if (!record) throw new AppError('Staff not found', 404);
    await sendPrivateFile(res, record.nidDocument ?? undefined, 'inline');
  }),
);

staff.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const record = await Staff.findById(req.params.id).lean();
    if (!record) throw new AppError('Staff not found', 404);
    return ok(res, presentStaff(record, true), 'Staff fetched');
  }),
);

staff.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = staffBody.parse(req.body);
    const email = input.email?.toLowerCase() || '';
    let firebaseUid = '';
    if (email && input.password) {
      const firebase = getFirebase();
      if (!firebase) throw new AppError('Firebase Admin is not configured', 503);
      try {
        const user = await firebase.auth().createUser({ email, password: input.password, displayName: input.name });
        firebaseUid = user.uid;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'auth/email-already-exists') throw new AppError('This email already has a login', 409);
        throw new AppError('Could not create the login', 400);
      }
    } else if (email && !input.password) {
      throw new AppError('A password is required when an email login is added', 422);
    }

    const record = await Staff.create({
      firebaseUid: firebaseUid || undefined,
      email: email || undefined,
      name: input.name,
      phone: input.phone ?? '',
      address: input.address ?? '',
      details: input.details ?? '',
      nidNumber: input.nidNumber ?? '',
      role: input.role ?? 'STAFF',
      permissions: (input.role ?? 'STAFF') === 'ADMIN' ? [...PERMISSIONS] : [...STAFF_DEFAULT_PERMISSIONS],
      status: input.status ?? 'active',
    });
    await writeAudit(req.auth, 'create', 'staff', record._id.toString(), { name: record.name });
    return ok(res, presentStaff(record.toObject(), true), 'Staff record saved', 201);
  }),
);

staff.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = staffBody.partial().parse(req.body);
    const record = await Staff.findById(req.params.id);
    if (!record) throw new AppError('Staff not found', 404);
    if (record._id.toString() === req.auth?.id && input.status === 'inactive') {
      throw new AppError('You cannot deactivate your own account', 422);
    }
    if (input.name != null) record.name = input.name;
    if (input.phone != null) record.phone = input.phone;
    if (input.address != null) record.address = input.address;
    if (input.details != null) record.details = input.details;
    if (input.nidNumber != null) record.nidNumber = input.nidNumber;
    if (input.role != null) {
      record.role = input.role;
      record.permissions = input.role === 'ADMIN' ? [...PERMISSIONS] : [...STAFF_DEFAULT_PERMISSIONS];
    }
    if (input.status != null) record.status = input.status;
    if (input.email) record.email = input.email.toLowerCase();

    const firebase = getFirebase();
    if (firebase && record.firebaseUid) {
      await firebase.auth().updateUser(record.firebaseUid, {
        displayName: record.name,
        email: record.email || undefined,
        password: input.password || undefined,
        disabled: record.status === 'inactive',
      }).catch(() => undefined);
    }
    await record.save();
    await writeAudit(req.auth, 'update', 'staff', record._id.toString(), { name: record.name, status: record.status });
    return ok(res, presentStaff(record.toObject(), true), 'Staff updated');
  }),
);

async function replaceFile(recordId: string, kind: 'photo' | 'nid', file: { buffer: Buffer; originalname: string; mimetype: string }) {
  const record = await Staff.findById(recordId);
  if (!record) throw new AppError('Staff not found', 404);
  const previous = kind === 'photo' ? record.photo : record.nidDocument;
  const folder = kind === 'photo' ? 'staff-photos' : 'staff-nid';
  const uploaded = await uploadPrivateAsset(file.buffer, folder, file.originalname, file.mimetype);
  if (kind === 'photo') record.photo = uploaded;
  else record.nidDocument = uploaded;
  await record.save();
  if (previous?.publicId) await destroyPrivateAsset(previous.publicId, previous.resourceType).catch(() => undefined);
  return record;
}

staff.post(
  '/:id/photo',
  acceptUpload(photoUpload, 'file'),
  asyncHandler(async (req, res) => {
    const file = assertFile(req.file, { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'] });
    const record = await replaceFile(req.params.id, 'photo', file);
    await writeAudit(req.auth, 'upload', 'staff-photo', record._id.toString(), {});
    return ok(res, { hasPhoto: true }, 'Photo saved');
  }),
);

staff.post(
  '/:id/nid',
  acceptUpload(nidUpload, 'file'),
  asyncHandler(async (req, res) => {
    const file = assertFile(req.file, {
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'application/pdf': ['pdf'],
    });
    const record = await replaceFile(req.params.id, 'nid', file);
    await writeAudit(req.auth, 'upload', 'staff-nid', record._id.toString(), { fileType: file.mimetype });
    return ok(res, presentFile(record.nidDocument), 'NID document saved');
  }),
);

staff.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const record = await Staff.findById(req.params.id);
    if (!record) throw new AppError('Staff not found', 404);
    if (record._id.toString() === req.auth?.id) throw new AppError('You cannot delete your own account', 422);
    if (record.photo?.publicId) await destroyPrivateAsset(record.photo.publicId, record.photo.resourceType).catch(() => undefined);
    if (record.nidDocument?.publicId) await destroyPrivateAsset(record.nidDocument.publicId, record.nidDocument.resourceType).catch(() => undefined);
    const firebase = getFirebase();
    if (firebase && record.firebaseUid) {
      await firebase.auth().updateUser(record.firebaseUid, { disabled: true }).catch(() => undefined);
    }
    await record.deleteOne();
    await writeAudit(req.auth, 'delete', 'staff', req.params.id, { name: record.name });
    return ok(res, { id: req.params.id }, 'Staff record removed');
  }),
);

export const staffRouter = staff;
