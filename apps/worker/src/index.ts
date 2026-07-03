import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import { processDeliveryJob } from './processors/delivery.js';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

console.log('🤖 Starting WebhookEngine Queue Worker...');

const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null
});

const worker = new Worker(
  'webhook-deliveries',
  async (job) => {
    console.log(`📥 Processing job ${job.id} for event ${job.data.eventId}`);
    await processDeliveryJob(job.data);
  },
  {
    connection: redisConnection as any,
    concurrency: 10 // Max concurrent delivery processes
  }
);

worker.on('active', (job) => {
  console.log(`🏃 Job ${job.id} has started processing.`);
});

worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completed successfully.`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed with error:`, err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received. Shutting down worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received. Shutting down worker...');
  await worker.close();
  process.exit(0);
});
