import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const mobileSchema = z
  .string()
  .trim()
  .transform((value) => {
    const compact = value.replace(/[\s-]/g, '');
    if (compact.startsWith('+880')) return `0${compact.slice(4)}`;
    if (compact.startsWith('880')) return `0${compact.slice(3)}`;
    return compact;
  })
  .refine((value) => /^01[3-9]\d{8}$/.test(value), 'Enter a valid Bangladesh mobile number');

export const moneySchema = z.coerce.number().min(0, 'Amount cannot be negative');
export const qtySchema = z.coerce.number().positive('Quantity must be greater than zero');
