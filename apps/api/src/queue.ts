import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export let redisConnection: any = null;
export let deliveryQueue: any = null;

if (process.env.USE_MOCK_QUEUE !== 'true' || process.env.NODE_ENV === 'production') {
  redisConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null
  });

  deliveryQueue = new Queue('webhook-deliveries', {
    connection: redisConnection as any,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false
    }
  });
}

type JobHandler = (data: { eventId: string; endpointId: string; attemptNumber: number }) => Promise<void>;
let mockHandler: JobHandler | null = null;

export function registerMockQueueHandler(handler: JobHandler) {
  mockHandler = handler;
}

export async function enqueueWebhook(data: {
  eventId: string;
  endpointId: string;
  attemptNumber: number;
}) {
  if (process.env.USE_MOCK_QUEUE === 'true' && process.env.NODE_ENV !== 'production') {
    console.log(`[MOCK QUEUE] Direct dispatching event ${data.eventId} to endpoint ${data.endpointId}`);
    if (mockHandler) {
      setTimeout(() => {
        mockHandler!(data).catch((err) => console.error('Mock Queue Processing Error:', err));
      }, 100);
    } else {
      console.warn('[MOCK QUEUE] Warning: No mock queue handler registered!');
    }
  } else {
    await deliveryQueue.add('deliver', data);
  }
}
