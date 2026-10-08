export const shop = {
  name: 'M/S Khaja Traders',
  taglineEn: 'Trusted Wholesale Trading in Tongi, Gazipur',
  taglineBn: 'টঙ্গী, গাজীপুরের বিশ্বস্ত পাইকারি ব্যবসা',
  address: 'Khaja Vila, Tongi Bazar, Kachari Road, Arot Potti, Tongi, Gazipur-1710, Bangladesh',
  phones: ['01711610784', '02-9801596'],
  facebook: 'https://www.facebook.com/KhajaTraders/',
  currency: 'BDT',
} as const;

export const DEFAULT_BANK = {
  bankName: 'BRAC Bank PLC',
  branch: 'Tongi Branch',
  accountName: 'M/S Khaja Traders',
  accountNumber: '10483038345843',
  routingNumber: '2459573',
} as const;

export const UNITS = ['kg', 'gram', 'liter', 'piece', 'box', 'carton', 'packet', 'dozen', 'bag'] as const;
export type Unit = (typeof UNITS)[number];

export const PAYMENT_METHODS = [
  'cash',
  'bank_transfer',
  'credit_card',
  'debit_card',
  'bkash',
  'nagad',
  'rocket',
  'stripe',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isCardPayment(method: string) {
  return method === 'credit_card' || method === 'debit_card' || method === 'stripe';
}

export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'cancelled', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const INVENTORY_TYPES = ['purchase', 'sale', 'damage', 'return', 'adjustment'] as const;
export type InventoryType = (typeof INVENTORY_TYPES)[number];

export const PERMISSIONS = [
  'products.view',
  'products.manage',
  'categories.manage',
  'inventory.view',
  'inventory.manage',
  'purchases.view',
  'purchases.manage',
  'sales.view',
  'sales.manage',
  'orders.view',
  'orders.manage',
  'customers.view',
  'customers.manage',
  'suppliers.view',
  'suppliers.manage',
  'ledger.view',
  'ledger.manage',
  'expenses.view',
  'expenses.manage',
  'payments.view',
  'payments.manage',
  'reports.view',
  'staff.manage',
  'settings.manage',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const STAFF_DEFAULT_PERMISSIONS: Permission[] = [
  'products.view',
  'inventory.view',
  'inventory.manage',
  'purchases.view',
  'purchases.manage',
  'sales.view',
  'sales.manage',
  'orders.view',
  'customers.view',
  'customers.manage',
  'suppliers.view',
  'ledger.view',
  'ledger.manage',
  'payments.view',
];
