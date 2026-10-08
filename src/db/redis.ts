import Redis from 'ioredis';
import { env } from '../config/env';

let redis: Redis | null = null;
let redisStatus: 'disabled' | 'connected' | 'unavailable' = 'disabled';

export function getRedis() {
  return redis;
}

export function getRedisStatus() {
  return redisStatus;
}

export async function connectRedis() {
  if (!env.REDIS_URL) {
    redisStatus = 'disabled';
    return;
  }

  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2500,
    retryStrategy: () => null,
  });

  client.on('error', () => {
    redisStatus = 'unavailable';
  });

  try {
    await client.connect();
    await client.ping();
    redis = client;
    redisStatus = 'connected';
  } catch {
    redis = null;
    redisStatus = 'unavailable';
    client.disconnect();
    console.warn('Redis is unavailable. Continuing without cache.');
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    /* cache is optional */
  }
}

export async function cacheDel(key: string) {
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    /* cache is optional */
  }
}
