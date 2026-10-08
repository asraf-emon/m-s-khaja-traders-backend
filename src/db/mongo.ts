import mongoose from 'mongoose';
import { env } from '../config/env';
import { Staff } from '../models';

export async function connectMongo() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI);
  try {
    const indexes = await Staff.collection.indexes();
    const legacy = indexes.find((index) => index.name === 'email_1' && !index.partialFilterExpression);
    if (legacy) await Staff.collection.dropIndex('email_1');
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 26) throw error;
  }
  return mongoose.connection;
}
