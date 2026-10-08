import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.string().default('development'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  REDIS_URL: z.string().optional().default(''),
  CLIENT_ORIGIN: z.string().default('http://localhost:3000'),
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional().default(''),
  FIREBASE_PROJECT_ID: z.string().optional().default(''),
  FIREBASE_CLIENT_EMAIL: z.string().optional().default(''),
  FIREBASE_PRIVATE_KEY: z.string().optional().default(''),
  CLOUDINARY_URL: z.string().optional().default(''),
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

function cloudinaryFromUrl(value: string) {
  const match = value.match(/^cloudinary:\/\/([^:]+):([^@]+)@([^/\s]+)/);
  if (!match) return { cloud: '', key: '', secret: '' };
  return {
    key: decodeURIComponent(match[1]),
    secret: decodeURIComponent(match[2]),
    cloud: match[3],
  };
}

const fromUrl = cloudinaryFromUrl(parsed.data.CLOUDINARY_URL);
const cloudName = parsed.data.CLOUDINARY_CLOUD_NAME || fromUrl.cloud;
const cloudKey = parsed.data.CLOUDINARY_API_KEY || fromUrl.key;
const cloudSecret = parsed.data.CLOUDINARY_API_SECRET || fromUrl.secret;

export const env = {
  ...parsed.data,
  CLOUDINARY_CLOUD_NAME: cloudName,
  CLOUDINARY_API_KEY: cloudKey,
  CLOUDINARY_API_SECRET: cloudSecret,
  isProd: parsed.data.NODE_ENV === 'production',
  firebaseConfigured: Boolean(
    parsed.data.FIREBASE_PROJECT_ID &&
      parsed.data.FIREBASE_CLIENT_EMAIL &&
      parsed.data.FIREBASE_PRIVATE_KEY,
  ),
  cloudinaryConfigured: Boolean(cloudName && cloudKey && cloudSecret),
  stripeConfigured: Boolean(parsed.data.STRIPE_SECRET_KEY),
};
