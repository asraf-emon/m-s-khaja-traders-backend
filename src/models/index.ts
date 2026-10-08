import mongoose, { Schema, type InferSchemaType, type Types } from 'mongoose';
import { INVENTORY_TYPES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, PERMISSIONS, UNITS } from '../config/shop';

const imageSchema = new Schema(
  {
    secureUrl: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { _id: false },
);

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    nameBn: { type: String, default: '', trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: '' },
    descriptionBn: { type: String, default: '' },
    image: { type: imageSchema, required: false },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    nameBn: { type: String, default: '', trim: true },
    description: { type: String, default: '' },
    descriptionBn: { type: String, default: '' },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
    barcode: { type: String, default: '', trim: true, index: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    unit: { type: String, enum: UNITS, required: true },
    purchasePrice: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    wholesalePrice: { type: Number, required: true, min: 0 },
    minimumSellingPrice: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, default: 0, min: 0 },
    minimumStock: { type: Number, required: true, default: 0, min: 0 },
    images: { type: [imageSchema], default: [] },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    isFeatured: { type: Boolean, default: false },
    isDemo: { type: Boolean, default: false, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Staff' },
  },
  { timestamps: true },
);

productSchema.index({ name: 1, nameBn: 1, sku: 1 });

const partyFields = {
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true, index: true },
  address: { type: String, default: '' },
  totalPurchases: { type: Number, default: 0 },
  totalPaid: { type: Number, default: 0 },
  totalDue: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  isDemo: { type: Boolean, default: false, index: true },
};

const customerSchema = new Schema(
  {
    ...partyFields,
    email: { type: String, default: '', trim: true },
    district: { type: String, default: '' },
    area: { type: String, default: '' },
  },
  { timestamps: true },
);

const supplierSchema = new Schema(
  {
    ...partyFields,
    businessName: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

const privateFileSchema = new Schema(
  {
    publicId: { type: String, required: true },
    resourceType: { type: String, required: true },
    fileType: { type: String, required: true },
    originalName: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const staffSchema = new Schema(
  {
    firebaseUid: { type: String, unique: true, sparse: true },
    email: { type: String, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
    details: { type: String, default: '' },
    nidNumber: { type: String, default: '' },
    photo: { type: privateFileSchema, required: false },
    nidDocument: { type: privateFileSchema, required: false },
    role: { type: String, enum: ['ADMIN', 'STAFF'], required: true },
    permissions: { type: [{ type: String, enum: PERMISSIONS }], default: [] },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true },
);

staffSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } }, name: 'email_partial' },
);

const lineSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    sku: { type: String, default: '' },
    unit: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 0 },
    purchasePrice: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const purchaseSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    items: { type: [lineSchema], required: true },
    subtotal: { type: Number, required: true },
    total: { type: Number, required: true },
    paidAmount: { type: Number, required: true, default: 0 },
    dueAmount: { type: Number, required: true, default: 0 },
    paymentStatus: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
    purchaseDate: { type: Date, required: true, index: true },
    notes: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Staff' },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

const saleSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
    items: { type: [lineSchema], required: true },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    paidAmount: { type: Number, required: true, default: 0 },
    dueAmount: { type: Number, required: true, default: 0 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
    saleDate: { type: Date, required: true, index: true },
    notes: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Staff' },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

const expenseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    expenseDate: { type: Date, required: true, index: true },
    note: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Staff' },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

const paymentSchema = new Schema(
  {
    partyType: { type: String, enum: ['customer', 'supplier', 'order'], required: true },
    partyId: { type: Schema.Types.ObjectId },
    partyName: { type: String, default: '' },
    relatedType: { type: String, default: '' },
    relatedId: { type: Schema.Types.ObjectId },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'paid' },
    transactionId: { type: String, default: '' },
    note: { type: String, default: '' },
    paidAt: { type: Date, default: () => new Date() },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Staff' },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

const inventoryTransactionSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    type: { type: String, enum: INVENTORY_TYPES, required: true },
    quantity: { type: Number, required: true, min: 0 },
    quantityChange: { type: Number, required: true },
    purchasePrice: { type: Number, default: 0 },
    sellingPrice: { type: Number, default: 0 },
    reference: { type: String, default: '' },
    note: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Staff' },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

const ledgerSchema = new Schema(
  {
    partyType: { type: String, enum: ['customer', 'supplier'], required: true },
    partyId: { type: Schema.Types.ObjectId, required: true },
    direction: { type: String, enum: ['debit', 'credit'], required: true },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true },
    description: { type: String, required: true },
    entryDate: { type: Date, required: true, index: true },
    referenceType: { type: String, default: '' },
    referenceId: { type: Schema.Types.ObjectId },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Staff' },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

ledgerSchema.index({ partyType: 1, partyId: 1, entryDate: -1 });

const orderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    sku: { type: String, default: '' },
    unit: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    customerName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    email: { type: String, default: '' },
    address: { type: String, required: true },
    district: { type: String, required: true },
    area: { type: String, required: true },
    note: { type: String, default: '' },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true },
    deliveryCharge: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    total: { type: Number, required: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
    orderStatus: { type: String, enum: ORDER_STATUSES, default: 'pending', index: true },
    transactionId: { type: String, default: '' },
    stripeSessionId: { type: String, default: '' },
    stockCommitted: { type: Boolean, default: false },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

const notificationSchema = new Schema(
  {
    type: { type: String, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const auditSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'Staff' },
    userEmail: { type: String, default: '' },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

auditSchema.index({ createdAt: -1 });

const paymentQrSchema = new Schema(
  {
    publicId: { type: String, default: '' },
    resourceType: { type: String, default: 'image' },
    fileType: { type: String, default: '' },
    uploadedAt: { type: Date },
  },
  { _id: false },
);

const settingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    onlineOrderingEnabled: { type: Boolean, default: true },
    deliveryCharge: { type: Number, default: 0 },
    taxPercent: { type: Number, default: 0 },
    bkashNumber: { type: String, default: '' },
    nagadNumber: { type: String, default: '' },
    rocketNumber: { type: String, default: '' },
    bkashQr: { type: paymentQrSchema, default: () => ({}) },
    nagadQr: { type: paymentQrSchema, default: () => ({}) },
    rocketQr: { type: paymentQrSchema, default: () => ({}) },
    bankName: { type: String, default: 'BRAC Bank PLC' },
    bankBranch: { type: String, default: 'Tongi Branch' },
    bankAccountName: { type: String, default: 'M/S Khaja Traders' },
    bankAccountNumber: { type: String, default: '10483038345843' },
    bankRoutingNumber: { type: String, default: '2459573' },
  },
  { timestamps: true },
);

const counterSchema = new Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

export const Category = mongoose.model('Category', categorySchema);
export const Product = mongoose.model('Product', productSchema);
export const Customer = mongoose.model('Customer', customerSchema);
export const Supplier = mongoose.model('Supplier', supplierSchema);
export const Staff = mongoose.model('Staff', staffSchema);
export const Purchase = mongoose.model('Purchase', purchaseSchema);
export const Sale = mongoose.model('Sale', saleSchema);
export const Expense = mongoose.model('Expense', expenseSchema);
export const Payment = mongoose.model('Payment', paymentSchema);
export const InventoryTransaction = mongoose.model('InventoryTransaction', inventoryTransactionSchema);
export const LedgerEntry = mongoose.model('LedgerEntry', ledgerSchema);
export const Order = mongoose.model('Order', orderSchema);
export const Notification = mongoose.model('Notification', notificationSchema);
export const AuditLog = mongoose.model('AuditLog', auditSchema);
export const Settings = mongoose.model('Settings', settingsSchema);
export const Counter = mongoose.model('Counter', counterSchema);

export type CategoryDoc = InferSchemaType<typeof categorySchema> & { _id: Types.ObjectId };
export type ProductDoc = InferSchemaType<typeof productSchema> & { _id: Types.ObjectId };
export type CustomerDoc = InferSchemaType<typeof customerSchema> & { _id: Types.ObjectId };
export type SupplierDoc = InferSchemaType<typeof supplierSchema> & { _id: Types.ObjectId };
export type StaffDoc = InferSchemaType<typeof staffSchema> & { _id: Types.ObjectId };
export type SettingsDoc = InferSchemaType<typeof settingsSchema> & { _id: Types.ObjectId };
