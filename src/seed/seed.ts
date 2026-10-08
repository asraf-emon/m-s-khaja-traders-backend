import { connectMongo } from '../db/mongo';
import {
  Category,
  Customer,
  Expense,
  InventoryTransaction,
  LedgerEntry,
  Notification,
  Order,
  Payment,
  Product,
  Purchase,
  Sale,
  Supplier,
} from '../models';
import { addManualLedgerEntry, createOnlineOrder, createPurchase, createSale } from '../services/commerce';
import { getSettings } from '../services/platform';
import mongoose from 'mongoose';

const demo = { isDemo: true, quiet: true };

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function image(id: string, photo: string) {
  return {
    secureUrl: `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=1200&h=900&q=80`,
    publicId: `demo:${id}`,
  };
}

async function clearDemo() {
  await Promise.all([
    Product.deleteMany({ isDemo: true }),
    Category.deleteMany({ isDemo: true }),
    Customer.deleteMany({ isDemo: true }),
    Supplier.deleteMany({ isDemo: true }),
    Purchase.deleteMany({ isDemo: true }),
    Sale.deleteMany({ isDemo: true }),
    Expense.deleteMany({ isDemo: true }),
    Payment.deleteMany({ isDemo: true }),
    InventoryTransaction.deleteMany({ isDemo: true }),
    LedgerEntry.deleteMany({ isDemo: true }),
    Order.deleteMany({ isDemo: true }),
    Notification.deleteMany({ isDemo: true }),
  ]);
}

async function seed() {
  await connectMongo();
  await clearDemo();
  await getSettings();

  const [rice, oil, sweet, flour, fresh, tea, spice] = await Category.create([
    { name: 'Rice & Lentils', nameBn: 'চাল ও ডাল', slug: 'rice-lentils', description: 'Wholesale rice and pulses', descriptionBn: 'পাইকারি চাল ও ডাল', isDemo: true },
    { name: 'Edible Oil', nameBn: 'ভোজ্য তেল', slug: 'edible-oil', description: 'Soybean and mustard oil', descriptionBn: 'সয়াবিন ও সরিষার তেল', isDemo: true },
    { name: 'Sugar & Salt', nameBn: 'চিনি ও লবণ', slug: 'sugar-salt', description: 'Everyday staples', descriptionBn: 'প্রতিদিনের চিনি ও লবণ', isDemo: true },
    { name: 'Flour', nameBn: 'আটা ও ময়দা', slug: 'flour', description: 'Atta and maida', descriptionBn: 'আটা ও ময়দা', isDemo: true },
    { name: 'Fresh Produce', nameBn: 'তাজা সবজি', slug: 'fresh-produce', description: 'Potato, onion and garlic', descriptionBn: 'আলু, পেঁয়াজ ও রসুন', isDemo: true },
    { name: 'Tea & Biscuits', nameBn: 'চা ও বিস্কুট', slug: 'tea-biscuits', description: 'Tea and biscuits', descriptionBn: 'চা ও বিস্কুট', isDemo: true },
    { name: 'Spices', nameBn: 'মসলা', slug: 'spices', description: 'Ground and whole spices', descriptionBn: 'গুঁড়া ও আস্ত মসলা', isDemo: true },
  ]);

  const specs = [
    ['KT-RICE-MIN-50', 'Miniket Rice 50kg', 'মিনিকেট চাল ৫০ কেজি', rice._id, 'bag', 2650, 2920, 3100, 2800, 5, true, 'photo-1586201375761-83865001e31c'],
    ['KT-RICE-NAZ-25', 'Nazirshail Rice 25kg', 'নাজিরশাইল চাল ২৫ কেজি', rice._id, 'bag', 1600, 1780, 1900, 1700, 4, true, 'photo-1536304993881-ff6e9eefa2a6'],
    ['KT-DAL-MAS-1', 'Masoor Dal', 'মসুর ডাল', rice._id, 'kg', 110, 125, 140, 115, 20, false, 'photo-1615485290382-441e4d049cb5'],
    ['KT-DAL-MUG-1', 'Mung Dal', 'মুগ ডাল', rice._id, 'kg', 130, 150, 165, 140, 15, false, 'photo-1515543904379-3d757afe72e4'],
    ['KT-OIL-SOY-5', 'Soybean Oil 5L', 'সয়াবিন তেল ৫ লিটার', oil._id, 'piece', 820, 900, 960, 860, 8, true, 'photo-1474979266404-7eaacbcd87c5'],
    ['KT-OIL-MUS-1', 'Mustard Oil 1L', 'সরিষার তেল ১ লিটার', oil._id, 'piece', 280, 320, 350, 300, 10, false, 'photo-1474979266404-7eaacbcd87c5'],
    ['KT-SUGAR-1', 'Sugar', 'চিনি', sweet._id, 'kg', 95, 110, 125, 100, 25, true, 'photo-1581264692636-3cf6f29655c2'],
    ['KT-SALT-1', 'Salt', 'লবণ', sweet._id, 'kg', 28, 35, 40, 30, 20, false, 'photo-1518112166137-85f9979a43aa'],
    ['KT-ATTA-2', 'Wheat Flour 2kg', 'আটা ২ কেজি', flour._id, 'packet', 90, 105, 120, 95, 15, false, 'photo-1574323347407-f5e1ad6d020b'],
    ['KT-POTATO-1', 'Potato', 'আলু', fresh._id, 'kg', 32, 40, 48, 35, 30, false, 'photo-1518977676601-b53f82aba655'],
    ['KT-ONION-1', 'Onion', 'পেঁয়াজ', fresh._id, 'kg', 55, 70, 85, 60, 25, true, 'photo-1508747703725-719777637510'],
    ['KT-GARLIC-1', 'Garlic', 'রসুন', fresh._id, 'kg', 140, 170, 190, 150, 8, false, 'photo-1540148426945-6cf4249a1c4b'],
    ['KT-TEA-400', 'Black Tea 400g', 'কালো চা ৪০০ গ্রাম', tea._id, 'packet', 210, 245, 270, 230, 6, true, 'photo-1564890369478-c89ca6d9cde9'],
    ['KT-BISC-CAR', 'Energy Biscuits Carton', 'এনার্জি বিস্কুট কার্টন', tea._id, 'carton', 480, 540, 590, 500, 5, false, 'photo-1558961363-fa8fdf82db35'],
    ['KT-TURMERIC', 'Turmeric Powder', 'হলুদ গুঁড়া', spice._id, 'kg', 220, 260, 290, 240, 5, false, 'photo-1596040033229-a9821ebd058d'],
    ['KT-CHILI', 'Chili Powder', 'মরিচের গুঁড়া', spice._id, 'kg', 280, 330, 360, 300, 5, false, 'photo-1596040033229-a9821ebd058d'],
    ['KT-CUMIN', 'Cumin Seed', 'জিরা', spice._id, 'kg', 650, 740, 820, 700, 3, true, 'photo-1596040033229-a9821ebd058d'],
  ] as const;

  const products = await Product.create(specs.map((item) => ({
    sku: item[0],
    name: item[1],
    nameBn: item[2],
    description: `${item[1]} for wholesale grocery shops. Demo seed data.`,
    descriptionBn: `${item[2]} — পাইকারি মুদি দোকানের জন্য। এটি ডেমো তথ্য।`,
    category: item[3],
    unit: item[4],
    purchasePrice: item[5] * 100,
    sellingPrice: item[7] * 100,
    wholesalePrice: item[6] * 100,
    minimumSellingPrice: item[8] * 100,
    stock: 0,
    minimumStock: item[9],
    images: [image(item[0].toLowerCase(), item[11])],
    status: 'active',
    isFeatured: item[10],
    isDemo: true,
  })));

  const bySku = (sku: string) => {
    const found = products.find((item) => item.sku === sku);
    if (!found) throw new Error(`Missing product ${sku}`);
    return found._id.toString();
  };

  const [grain, oilHouse, spiceMill] = await Supplier.create([
    { name: 'Habib Rahman', businessName: 'Dhaka Grain House', phone: '01713001001', address: 'Kawran Bazar, Dhaka', notes: 'Demo supplier. Call before Friday delivery.', isDemo: true },
    { name: 'Nasima Akter', businessName: 'Chattogram Oil Supply', phone: '01816001002', address: 'Khatunganj, Chattogram', notes: 'Demo supplier. Invoice copy kept in the shop file.', isDemo: true },
    { name: 'Jamal Uddin', businessName: 'Bogura Spice Mills', phone: '01914001003', address: 'Bogura Sadar', notes: 'Demo supplier. Quality note: check cumin bags on arrival.', isDemo: true },
  ]);

  const [rahim, karim, bhai, nusrat] = await Customer.create([
    { name: 'Rahim Store', phone: '01712001001', address: 'Tongi Bazar', district: 'Gazipur', area: 'Arot Potti', notes: 'পুরনো খাতা: বৈশাখে আগের বাকি মিটানো হয়েছে। ডেমো ক্রেতা।', isDemo: true },
    { name: 'Karim Brothers', phone: '01712001002', address: 'Joydebpur Road', district: 'Gazipur', area: 'Chowrasta', notes: 'Pays every Saturday. Demo customer.', isDemo: true },
    { name: 'Bhai Bhai Grocery', phone: '01819001003', address: 'Sector 7, Uttara', district: 'Dhaka', area: 'Uttara', notes: 'Demo customer. Prefers afternoon delivery.', isDemo: true },
    { name: 'Nusrat Varieties', phone: '01611001004', address: 'Kachari Road', district: 'Gazipur', area: 'Tongi', notes: 'ডেমো ক্রেতা। খাতায় আলাদা নোট রাখা আছে।', isDemo: true },
  ]);

  await createPurchase({
    ...demo,
    supplierId: grain._id.toString(),
    purchaseDate: daysAgo(12),
    paidAmount: 80000,
    notes: 'Demo grain purchase',
    items: [
      { productId: bySku('KT-RICE-MIN-50'), quantity: 20, purchasePrice: 2650 },
      { productId: bySku('KT-RICE-NAZ-25'), quantity: 12, purchasePrice: 1600 },
      { productId: bySku('KT-DAL-MAS-1'), quantity: 80, purchasePrice: 110 },
      { productId: bySku('KT-DAL-MUG-1'), quantity: 40, purchasePrice: 130 },
      { productId: bySku('KT-SUGAR-1'), quantity: 100, purchasePrice: 95 },
      { productId: bySku('KT-SALT-1'), quantity: 80, purchasePrice: 28 },
      { productId: bySku('KT-ATTA-2'), quantity: 50, purchasePrice: 90 },
    ],
  });

  await createPurchase({
    ...demo,
    supplierId: oilHouse._id.toString(),
    purchaseDate: daysAgo(10),
    paidAmount: 28900,
    notes: 'Demo oil purchase',
    items: [
      { productId: bySku('KT-OIL-SOY-5'), quantity: 25, purchasePrice: 820 },
      { productId: bySku('KT-OIL-MUS-1'), quantity: 30, purchasePrice: 280 },
    ],
  });

  await createPurchase({
    ...demo,
    supplierId: spiceMill._id.toString(),
    purchaseDate: daysAgo(8),
    paidAmount: 20000,
    notes: 'Demo spice and vegetable purchase',
    items: [
      { productId: bySku('KT-POTATO-1'), quantity: 70, purchasePrice: 32 },
      { productId: bySku('KT-ONION-1'), quantity: 40, purchasePrice: 55 },
      { productId: bySku('KT-GARLIC-1'), quantity: 20, purchasePrice: 140 },
      { productId: bySku('KT-TEA-400'), quantity: 24, purchasePrice: 210 },
      { productId: bySku('KT-BISC-CAR'), quantity: 15, purchasePrice: 480 },
      { productId: bySku('KT-TURMERIC'), quantity: 12, purchasePrice: 220 },
      { productId: bySku('KT-CHILI'), quantity: 10, purchasePrice: 280 },
      { productId: bySku('KT-CUMIN'), quantity: 6, purchasePrice: 650 },
    ],
  });

  await createSale({
    ...demo,
    customerId: rahim._id.toString(),
    saleDate: daysAgo(0),
    paymentMethod: 'cash',
    paidAmount: 8000,
    notes: 'Demo sale. Remaining amount stays in hishab khata.',
    items: [
      { productId: bySku('KT-RICE-MIN-50'), quantity: 4, priceType: 'wholesale' },
      { productId: bySku('KT-OIL-SOY-5'), quantity: 6, priceType: 'wholesale' },
      { productId: bySku('KT-SUGAR-1'), quantity: 20, priceType: 'wholesale' },
    ],
  });

  await createSale({
    ...demo,
    customerId: karim._id.toString(),
    saleDate: daysAgo(1),
    paymentMethod: 'bkash',
    paidAmount: 2000,
    notes: 'bKash demo reference BKASH-DEMO-2201',
    items: [
      { productId: bySku('KT-ONION-1'), quantity: 30, priceType: 'wholesale' },
      { productId: bySku('KT-POTATO-1'), quantity: 40, priceType: 'wholesale' },
      { productId: bySku('KT-GARLIC-1'), quantity: 4, priceType: 'wholesale' },
    ],
  });

  await createSale({
    ...demo,
    customerId: bhai._id.toString(),
    saleDate: daysAgo(2),
    paymentMethod: 'cash',
    paidAmount: 2000,
    items: [
      { productId: bySku('KT-TEA-400'), quantity: 4, priceType: 'wholesale' },
      { productId: bySku('KT-BISC-CAR'), quantity: 2, priceType: 'wholesale' },
      { productId: bySku('KT-ATTA-2'), quantity: 6, priceType: 'wholesale' },
    ],
  });

  await createSale({
    ...demo,
    customerId: nusrat._id.toString(),
    saleDate: daysAgo(4),
    paymentMethod: 'nagad',
    paidAmount: 3000,
    notes: 'Nagad demo reference NAGAD-DEMO-7781',
    items: [
      { productId: bySku('KT-DAL-MAS-1'), quantity: 15, priceType: 'wholesale' },
      { productId: bySku('KT-DAL-MUG-1'), quantity: 8, priceType: 'wholesale' },
      { productId: bySku('KT-OIL-MUS-1'), quantity: 6, priceType: 'wholesale' },
    ],
  });

  await createSale({
    ...demo,
    saleDate: daysAgo(5),
    paymentMethod: 'cash',
    paidAmount: 2320,
    items: [
      { productId: bySku('KT-SALT-1'), quantity: 8, priceType: 'retail' },
      { productId: bySku('KT-CUMIN'), quantity: 2, priceType: 'retail' },
      { productId: bySku('KT-CHILI'), quantity: 1, priceType: 'retail' },
    ],
  });

  await createSale({
    ...demo,
    customerId: rahim._id.toString(),
    saleDate: daysAgo(3),
    paymentMethod: 'cash',
    paidAmount: 0,
    notes: 'Credit sale written in the khata.',
    items: [
      { productId: bySku('KT-ONION-1'), quantity: 6, priceType: 'wholesale' },
      { productId: bySku('KT-POTATO-1'), quantity: 22, priceType: 'wholesale' },
      { productId: bySku('KT-CUMIN'), quantity: 4, priceType: 'wholesale' },
    ],
  });

  await addManualLedgerEntry({
    ...demo,
    partyType: 'customer',
    partyId: rahim._id.toString(),
    direction: 'credit',
    amount: 500,
    description: 'খাতার নোট: একটি বস্তা ফেরত। নগদ নয়, ৳500 সমন্বয়। Demo notebook note.',
    entryDate: daysAgo(0),
  });

  await createOnlineOrder({
    isDemo: true,
    quiet: true,
    customerName: 'Shop Customer',
    phone: '01711001009',
    address: 'House 4, Kachari Road, Tongi',
    district: 'Gazipur',
    area: 'Tongi Bazar',
    note: 'Demo online order. Please call before delivery.',
    paymentMethod: 'bkash',
    transactionId: 'BKASH-DEMO-1001',
    items: [
      { productId: bySku('KT-TEA-400'), quantity: 1 },
      { productId: bySku('KT-SUGAR-1'), quantity: 2 },
    ],
  });

  await Expense.create([
    { title: 'Shop rent', category: 'Rent', amount: 1500000, expenseDate: daysAgo(6), note: 'Demo monthly rent', isDemo: true },
    { title: 'Electricity bill', category: 'Utilities', amount: 350000, expenseDate: daysAgo(3), note: 'Demo electricity bill', isDemo: true },
    { title: 'Tongi delivery van', category: 'Transport', amount: 220000, expenseDate: daysAgo(1), note: 'Demo transport cost', isDemo: true },
  ]);

  const low = await Product.find({ isDemo: true, status: 'active', $expr: { $lte: ['$stock', '$minimumStock'] } });
  if (low.length) {
    await Notification.insertMany(low.map((item) => ({
      type: item.stock <= 0 ? 'out-of-stock' : 'low-stock',
      title: item.stock <= 0 ? 'Out of stock' : 'Low stock',
      message: `${item.name} is at ${item.stock} ${item.unit}`,
      isDemo: true,
      metadata: { productId: item._id.toString(), stock: item.stock },
    })));
  }

  console.log('Demo data seeded. Products, purchases, sales, dues and hishab entries are marked isDemo.');
  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
