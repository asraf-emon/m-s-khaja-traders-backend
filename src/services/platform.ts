import type { NextFunction, Request, Response } from 'express';
import admin from 'firebase-admin';
import { v2 as cloudinary } from 'cloudinary';
import Stripe from 'stripe';
import { env } from '../config/env';
import { DEFAULT_BANK, PERMISSIONS, STAFF_DEFAULT_PERMISSIONS, shop } from '../config/shop';
import { AppError, type AuthStaff } from '../common/http';
import { getRedis } from '../db/redis';
import { AuditLog, Settings, Staff } from '../models';

let firebaseReady = false;
let stripeClient: Stripe | null = null;

export function getFirebase() {
  if (!env.firebaseConfigured) return null;
  if (!firebaseReady) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    firebaseReady = true;
  }
  return admin;
}

export function getStripe() {
  if (!env.stripeConfigured) return null;
  if (!stripeClient) stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  return stripeClient;
}

export function ensureCloudinary() {
  if (!env.cloudinaryConfigured) {
    throw new AppError('Cloudinary is not configured', 503);
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });
  return cloudinary;
}

export async function uploadImage(buffer: Buffer, folder: string) {
  const client = ensureCloudinary();
  const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    const stream = client.uploader.upload_stream(
      { folder: `khaja-traders/${folder}`, resource_type: 'image' },
      (error, uploaded) => {
        if (error || !uploaded) reject(error ?? new Error('Upload failed'));
        else resolve({ secure_url: uploaded.secure_url, public_id: uploaded.public_id });
      },
    );
    stream.end(buffer);
  });
  return { secureUrl: result.secure_url, publicId: result.public_id };
}

export async function destroyImage(publicId: string) {
  if (!publicId || publicId.startsWith('demo:') || !env.cloudinaryConfigured) return;
  const client = ensureCloudinary();
  await client.uploader.destroy(publicId);
}

export type PrivateAsset = {
  publicId: string;
  resourceType: string;
  fileType: string;
  originalName: string;
  uploadedAt: Date;
};

export async function uploadPrivateAsset(buffer: Buffer, folder: string, originalName: string, fileType: string): Promise<PrivateAsset> {
  const client = ensureCloudinary();
  const uploaded = await new Promise<{ public_id: string; resource_type: string }>((resolve, reject) => {
    const stream = client.uploader.upload_stream(
      {
        folder: `khaja-traders/${folder}`,
        resource_type: 'auto',
        type: 'authenticated',
        access_mode: 'authenticated',
      },
      (error, result) => {
        if (error || !result) reject(error ?? new Error('Upload failed'));
        else resolve(result);
      },
    );
    stream.end(buffer);
  });
  return {
    publicId: uploaded.public_id,
    resourceType: uploaded.resource_type,
    fileType,
    originalName,
    uploadedAt: new Date(),
  };
}

export async function destroyPrivateAsset(publicId: string, resourceType: string) {
  if (!publicId || !env.cloudinaryConfigured) return;
  const client = ensureCloudinary();
  await client.uploader.destroy(publicId, { resource_type: resourceType, type: 'authenticated', invalidate: true });
}

export function privateAssetUrl(file: Pick<PrivateAsset, 'publicId' | 'resourceType' | 'fileType'>) {
  const client = ensureCloudinary();
  const format = (file.fileType.split('/').pop() || 'jpg').toLowerCase().replace('jpeg', 'jpg');
  return client.utils.private_download_url(file.publicId, format, {
    resource_type: file.resourceType || 'image',
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + 60,
  });
}

export async function getSettings() {
  let settings = await Settings.findOne({ key: 'shop' });
  if (!settings) {
    settings = await Settings.create({
      key: 'shop',
      onlineOrderingEnabled: true,
      deliveryCharge: 6000,
      taxPercent: 0,
      bkashNumber: '',
      nagadNumber: '',
      rocketNumber: '',
      bankName: DEFAULT_BANK.bankName,
      bankBranch: DEFAULT_BANK.branch,
      bankAccountName: DEFAULT_BANK.accountName,
      bankAccountNumber: DEFAULT_BANK.accountNumber,
      bankRoutingNumber: DEFAULT_BANK.routingNumber,
    });
  }
  const bankFields = {
    bankName: DEFAULT_BANK.bankName,
    bankBranch: DEFAULT_BANK.branch,
    bankAccountName: DEFAULT_BANK.accountName,
    bankAccountNumber: DEFAULT_BANK.accountNumber,
    bankRoutingNumber: DEFAULT_BANK.routingNumber,
  } as const;
  let fillBank = false;
  for (const [field, fallback] of Object.entries(bankFields)) {
    if (!settings.get(field)) {
      settings.set(field, fallback);
      fillBank = true;
    }
  }
  if (fillBank) await settings.save();
  return settings;
}

function qrVersion(file?: { publicId?: string; uploadedAt?: Date | null } | null) {
  if (!file?.publicId) return '';
  return file.uploadedAt ? new Date(file.uploadedAt).toISOString() : '1';
}

export function presentSettings(settings: {
  onlineOrderingEnabled: boolean;
  deliveryCharge: number;
  taxPercent: number;
  bkashNumber: string;
  nagadNumber: string;
  rocketNumber: string;
  bkashQr?: { publicId?: string; uploadedAt?: Date | null } | null;
  nagadQr?: { publicId?: string; uploadedAt?: Date | null } | null;
  rocketQr?: { publicId?: string; uploadedAt?: Date | null } | null;
  bankName?: string;
  bankBranch?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankRoutingNumber?: string;
}) {
  return {
    shop,
    onlineOrderingEnabled: settings.onlineOrderingEnabled,
    deliveryCharge: settings.deliveryCharge / 100,
    taxPercent: settings.taxPercent,
    manualPayments: {
      bkash: settings.bkashNumber,
      nagad: settings.nagadNumber,
      rocket: settings.rocketNumber,
    },
    paymentQr: {
      bkash: qrVersion(settings.bkashQr),
      nagad: qrVersion(settings.nagadQr),
      rocket: qrVersion(settings.rocketQr),
    },
    bank: {
      bankName: settings.bankName || DEFAULT_BANK.bankName,
      branch: settings.bankBranch || DEFAULT_BANK.branch,
      accountName: settings.bankAccountName || DEFAULT_BANK.accountName,
      accountNumber: settings.bankAccountNumber || DEFAULT_BANK.accountNumber,
      routingNumber: settings.bankRoutingNumber || DEFAULT_BANK.routingNumber,
    },
    currency: 'BDT',
    cardPaymentsEnabled: env.stripeConfigured,
  };
}

export async function writeAudit(
  auth: AuthStaff | undefined,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  if (!auth) return;
  await AuditLog.create({
    userId: auth.id,
    userEmail: auth.email,
    action,
    entity,
    entityId,
    metadata,
  });
}

const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(prefix: string, limit: number, windowSec: number) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const ip = req.ip || 'local';
    const key = `${prefix}:${ip}`;
    try {
      const redis = getRedis();
      if (redis) {
        const count = await redis.incr(`rl:${key}`);
        if (count === 1) await redis.expire(`rl:${key}`, windowSec);
        if (count > limit) return next(new AppError('Too many requests. Please try again shortly.', 429));
        return next();
      }
    } catch (error) {
      if (error instanceof AppError) return next(error);
    }

    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.reset < now) {
      buckets.set(key, { count: 1, reset: now + windowSec * 1000 });
      return next();
    }
    current.count += 1;
    if (current.count > limit) return next(new AppError('Too many requests. Please try again shortly.', 429));
    return next();
  };
}

export async function resolveStaff(decoded: admin.auth.DecodedIdToken): Promise<AuthStaff> {
  const email = (decoded.email || '').toLowerCase();
  let staff = await Staff.findOne({ $or: [{ firebaseUid: decoded.uid }, { email }] });

  if (staff && !staff.firebaseUid) {
    staff.firebaseUid = decoded.uid;
    await staff.save();
  }

  if (!staff && env.BOOTSTRAP_ADMIN_EMAIL && email === env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
    staff = await Staff.create({
      firebaseUid: decoded.uid,
      email,
      name: decoded.name || 'Shop Admin',
      role: 'ADMIN',
      permissions: [...PERMISSIONS],
      status: 'active',
    });
  }

  if (!staff || staff.status !== 'active') {
    throw new AppError('This account is not allowed to access the shop system.', 403);
  }

  if (staff.role === 'STAFF' && staff.permissions.length === 0) {
    staff.permissions = [...STAFF_DEFAULT_PERMISSIONS];
    await staff.save();
  }

  return {
    id: staff._id.toString(),
    email: staff.email || '',
    name: staff.name,
    role: staff.role,
    permissions: staff.permissions,
  };
}
