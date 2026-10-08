import { env } from './config/env';
import { connectMongo } from './db/mongo';
import { connectRedis } from './db/redis';
import { createApp } from './app';

async function main() {
  await connectMongo();
  await connectRedis();
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`Khaja Traders API listening on http://localhost:${env.PORT}`);
  });
}

main().catch((error) => {
  console.error('Failed to start API', error);
  process.exit(1);
});
