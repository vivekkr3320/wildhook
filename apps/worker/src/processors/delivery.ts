import { getQuickJS } from 'quickjs-emscripten';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '../db.js';
import { generateSignatureHeader } from '@webhookengine/shared';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Setup Redis connection for scheduling retries
let redisConnection: any = null;
let retryQueue: any = null;

if (process.env.USE_MOCK_QUEUE !== 'true' || process.env.NODE_ENV === 'production') {
  redisConnection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  retryQueue = new Queue('webhook-deliveries', { connection: redisConnection as any });
}

// Initialize Gemini SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'MOCK_GEMINI_KEY');

// Executing code inside QuickJS sandbox
export async function executeTransformation(code: string, payload: any, eventType: string): Promise<any> {
  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();

  try {
    const payloadStr = JSON.stringify(payload);
    vm.setProp(vm.global, 'payload', vm.newString(payloadStr));
    vm.setProp(vm.global, 'eventType', vm.newString(eventType));

    // The script handles the payload transform
    const script = `
      (function() {
        const parsedPayload = JSON.parse(payload);
        ${code}
        if (typeof transform === 'function') {
          return JSON.stringify(transform(parsedPayload, eventType));
        }
        return JSON.stringify(parsedPayload);
      })()
    `;

    const result = vm.evalCode(script) as any;

    if (result.error) {
      const errorStr = vm.dump(result.error);
      result.error.dispose();
      throw new Error(`Transformation Error: ${errorStr}`);
    }

    const transformedStr = vm.getString(result.value);
    result.value.dispose();
    return JSON.parse(transformedStr);
  } finally {
    vm.dispose();
  }
}

// Generate diagnosis using Gemini
async function runAiDiagnosis(endpointUrl: string, recentFailures: any[]): Promise<string> {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MOCK_GEMINI_KEY') {
    return 'Gemini API key not configured. Mocked Diagnosis: The endpoint returned a non-2xx status code. Please verify that your receiver matches the expected schema and has correct header authorization.';
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `
You are an expert developer operations assistant specializing in webhook reliability and network debugging.
An endpoint is failing to receive webhooks from our WebhookEngine.
Endpoint URL: ${endpointUrl}

Here are the details of the recent failure attempts:
${recentFailures.map((f, i) => `
Attempt #${f.attemptNumber}:
- Response Status: ${f.responseCode ?? 'Network Error / Timeout'}
- Response Body: ${f.responseBody ?? 'N/A'}
`).join('\n')}

Based on the response codes, bodies, and URL, diagnose why the webhook delivery is failing.
Keep your analysis very concise (under 150 words), direct, and written in plain English.
Provide actionable suggestions for the endpoint owner to fix the issue.
`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('Gemini diagnosis failed:', err);
    return `AI diagnosis failed to run: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Send alerts (Slack / Email)
async function triggerAlerts(orgId: string, endpointUrl: string, diagnosis: string, failures: any[]) {
  const configs = await prisma.alertConfig.findMany({
    where: { orgId, enabled: true }
  });

  for (const config of configs) {
    if (config.channel === 'slack') {
      try {
        const response = await fetch(config.target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `⚠️ *Webhook Delivery Alert* ⚠️\n\nEndpoint *${endpointUrl}* has failed after ${failures.length} consecutive attempts.\n\n*AI Diagnosis:*\n${diagnosis}`
          })
        });
        if (!response.ok) {
          console.error(`Failed to send Slack alert to ${config.target}`);
        }
      } catch (err) {
        console.error('Slack dispatch error:', err);
      }
    } else if (config.channel === 'email') {
      console.log(`[ALERT EMAIL] To: ${config.target}\nSubject: Webhook Failure Alert for ${endpointUrl}\nContent:\nEndpoint has failed. \nAI Diagnosis: ${diagnosis}`);
    }
  }
}

// Core delivery processor
export async function processDeliveryJob(jobData: {
  eventId: string;
  endpointId: string;
  attemptNumber: number;
}) {
  const { eventId, endpointId, attemptNumber } = jobData;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { eventType: true }
  });

  const endpoint = await prisma.endpoint.findUnique({
    where: { id: endpointId },
    include: {
      application: { include: { organization: true } },
      transformation: true
    }
  });

  if (!event || !endpoint) {
    console.error(`Invalid job parameters: Event: ${eventId}, Endpoint: ${endpointId}`);
    return;
  }

  if (endpoint.status !== 'active') {
    console.log(`Endpoint ${endpointId} is inactive. Skipping delivery.`);
    return;
  }

  const org = endpoint.application.organization;
  let payload = JSON.parse(event.payloadJson);

  // 1. Run Transformations if configured (Business tier check)
  if (endpoint.transformation?.enabled && org.plan === 'business') {
    try {
      payload = await executeTransformation(
        endpoint.transformation.code,
        payload,
        event.eventType.name
      );
    } catch (transErr) {
      const errorMsg = transErr instanceof Error ? transErr.message : String(transErr);
      console.error(`Transformation failed on endpoint ${endpointId}:`, errorMsg);
      
      // Update delivery record as failure due to transformation
      await prisma.delivery.create({
        data: {
          eventId,
          endpointId,
          attemptNumber,
          status: 'failed',
          responseCode: null,
          responseBody: `Transformation Error: ${errorMsg}`,
          durationMs: 0
        }
      });
      return;
    }
  }

  // 2. Sign Payload (HMAC-SHA256)
  const rawPayloadString = JSON.stringify(payload);
  const { header } = generateSignatureHeader(rawPayloadString, endpoint.secret);

  // 3. Dispatch POST Request
  const start = Date.now();
  let responseCode: number | null = null;
  let responseBody: string | null = null;
  let success = false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Webhook-Signature': header,
        'x-webhook-event-id': eventId,
        'x-webhook-attempt': String(attemptNumber)
      },
      body: rawPayloadString,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    responseCode = res.status;
    responseBody = await res.text();
    success = res.status >= 200 && res.status < 300;
  } catch (fetchErr) {
    responseBody = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    success = false;
  }

  const durationMs = Date.now() - start;

  // 4. Log attempt (update pending record or create new success/failed record)
  const existingDelivery = await prisma.delivery.findFirst({
    where: {
      eventId,
      endpointId,
      attemptNumber,
      status: 'pending'
    }
  });

  if (existingDelivery) {
    await prisma.delivery.update({
      where: { id: existingDelivery.id },
      data: {
        status: success ? 'success' : 'failed',
        responseCode,
        responseBody: responseBody ? responseBody.substring(0, 1000) : null,
        durationMs
      }
    });
  } else {
    await prisma.delivery.create({
      data: {
        eventId,
        endpointId,
        attemptNumber,
        status: success ? 'success' : 'failed',
        responseCode,
        responseBody: responseBody ? responseBody.substring(0, 1000) : null,
        durationMs
      }
    });
  }

  if (success) {
    console.log(`✅ Webhook delivered successfully to ${endpoint.url} on attempt ${attemptNumber}`);
    return;
  }

  // 5. Handle Failure and Retries
  const maxAttempts = 5;
  const backoffDelays = [
    60 * 1000,       // 1 min
    5 * 60 * 1000,   // 5 mins
    30 * 60 * 1000,  // 30 mins
    2 * 60 * 60 * 1000, // 2 hours
    12 * 60 * 60 * 1000 // 12 hours
  ];

  if (attemptNumber < maxAttempts) {
    const delay = backoffDelays[attemptNumber - 1] || 60 * 1000;
    const nextRetryAt = new Date(Date.now() + delay);

    console.log(`⚠️ Delivery failed to ${endpoint.url}. Retrying attempt ${attemptNumber + 1} in ${delay / 1000}s`);

    // Create a pending record for the next retry attempt
    await prisma.delivery.create({
      data: {
        eventId,
        endpointId,
        attemptNumber: attemptNumber + 1,
        status: 'pending',
        nextRetryAt
      }
    });

    // Queue retry job with delay
    if (process.env.USE_MOCK_QUEUE === 'true' && process.env.NODE_ENV !== 'production') {
      setTimeout(() => {
        processDeliveryJob({
          eventId,
          endpointId,
          attemptNumber: attemptNumber + 1
        }).catch(console.error);
      }, delay);
    } else {
      await retryQueue.add(
        'deliver',
        {
          eventId,
          endpointId,
          attemptNumber: attemptNumber + 1
        },
        { delay }
      );
    }
  } else {
    // Max attempts reached — Final Failure
    console.error(`❌ Max delivery attempts reached for event ${eventId} to ${endpoint.url}`);

    // Fetch last 3 failures for diagnosis
    const recentFailures = await prisma.delivery.findMany({
      where: { eventId, endpointId },
      orderBy: { attemptNumber: 'desc' },
      take: 3
    });

    // Run AI Diagnosis (gated/business tier fallback)
    const diagnosis = await runAiDiagnosis(endpoint.url, recentFailures);

    // Trigger alerts
    await triggerAlerts(org.id, endpoint.url, diagnosis, recentFailures);

    // Disable the endpoint if consecutive failures occur
    await prisma.endpoint.update({
      where: { id: endpointId },
      data: {
        status: 'disabled',
        disabledAt: new Date()
      }
    });
  }
}
