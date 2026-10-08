import { paisaToBdt } from './http';

type IdLike = { toString(): string };

export type ImageLike = { secureUrl: string; publicId: string };

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export function presentCategory(doc: {
  _id: IdLike;
  name: string;
  nameBn?: string;
  slug: string;
  description?: string;
  descriptionBn?: string;
  image?: ImageLike | null;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    nameBn: doc.nameBn ?? '',
    slug: doc.slug,
    description: doc.description ?? '',
    descriptionBn: doc.descriptionBn ?? '',
    image: doc.image ?? null,
    status: doc.status,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

export function presentCategoryRef(category: unknown) {
  if (!category || typeof category !== 'object' || !('name' in category)) return null;
  const value = category as { _id: IdLike; name: string; nameBn?: string; slug?: string };
  return {
    id: value._id.toString(),
    name: value.name,
    nameBn: value.nameBn ?? '',
    slug: value.slug ?? '',
  };
}

export function stockStatus(stock: number, minimumStock: number) {
  if (stock <= 0) return 'out' as const;
  if (stock <= minimumStock) return 'low' as const;
  return 'in' as const;
}

export function presentProduct(
  doc: {
    _id: IdLike;
    name: string;
    nameBn?: string;
    description?: string;
    descriptionBn?: string;
    sku: string;
    barcode?: string;
    category: unknown;
    unit: string;
    purchasePrice: number;
    sellingPrice: number;
    wholesalePrice: number;
    minimumSellingPrice: number;
    stock: number;
    minimumStock: number;
    images?: ImageLike[];
    status: string;
    isFeatured?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
  },
  includeCost: boolean,
) {
  const publicFields = {
    id: doc._id.toString(),
    name: doc.name,
    nameBn: doc.nameBn ?? '',
    description: doc.description ?? '',
    descriptionBn: doc.descriptionBn ?? '',
    sku: doc.sku,
    category: presentCategoryRef(doc.category),
    unit: doc.unit,
    sellingPrice: paisaToBdt(doc.sellingPrice),
    wholesalePrice: paisaToBdt(doc.wholesalePrice),
    stock: doc.stock,
    stockStatus: stockStatus(doc.stock, doc.minimumStock),
    images: doc.images ?? [],
    status: doc.status,
    isFeatured: Boolean(doc.isFeatured),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };

  if (!includeCost) return publicFields;

  return {
    ...publicFields,
    barcode: doc.barcode ?? '',
    purchasePrice: paisaToBdt(doc.purchasePrice),
    minimumSellingPrice: paisaToBdt(doc.minimumSellingPrice),
    minimumStock: doc.minimumStock,
  };
}

export function settlement(paid: number, due: number, status: string) {
  if (status === 'failed' || status === 'cancelled' || status === 'refunded') return status;
  if (due <= 0) return 'paid';
  if (paid > 0) return 'partial';
  return 'pending';
}

export function presentParty(doc: {
  _id: IdLike;
  name: string;
  phone: string;
  address?: string;
  totalPurchases: number;
  totalPaid: number;
  totalDue: number;
  notes?: string;
  email?: string;
  district?: string;
  area?: string;
  businessName?: string;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    phone: doc.phone,
    address: doc.address ?? '',
    email: doc.email ?? '',
    district: doc.district ?? '',
    area: doc.area ?? '',
    businessName: doc.businessName ?? '',
    totalPurchases: paisaToBdt(doc.totalPurchases),
    totalPaid: paisaToBdt(doc.totalPaid),
    totalDue: paisaToBdt(doc.totalDue),
    notes: doc.notes ?? '',
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

export function presentLedger(doc: {
  _id: IdLike;
  partyType: string;
  partyId: IdLike;
  direction: string;
  amount: number;
  balanceAfter: number;
  description: string;
  entryDate: Date;
  referenceType?: string;
  createdAt?: Date;
}) {
  return {
    id: doc._id.toString(),
    partyType: doc.partyType,
    partyId: doc.partyId.toString(),
    direction: doc.direction,
    amount: paisaToBdt(doc.amount),
    balanceAfter: paisaToBdt(doc.balanceAfter),
    description: doc.description,
    entryDate: iso(doc.entryDate),
    referenceType: doc.referenceType ?? '',
    createdAt: iso(doc.createdAt),
  };
}
