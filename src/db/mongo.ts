import mongoose from 'mongoose';
import { env } from '../config/env';
import { Staff } from '../models';

export async function connectMongo() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI);
  const indexes = await Staff.collection.indexes();
  const legacy = indexes.find((index) => index.name === 'email_1' && !index.partialFilterExpression);
  if (legacy) await Staff.collection.dropIndex('email_1');
  return mongoose.connection;
}
