// Enable mock queue in-process before importing any database or API handlers
process.env.USE_MOCK_QUEUE = 'true';
process.env.PORT = '3000';
process.env.JWT_SECRET = 'test-secret-key';

import { prisma } from '../apps/api/dist/db.js';
import { hashApiKey } from '../apps/api/dist/middleware/auth.js';
import { registerMockQueueHandler } from '../apps/api/dist/queue.js';
import { processDeliveryJob } from '../apps/worker/dist/processors/delivery.js';
import { WebhookEngine } from '../packages/sdk/dist/index.js';
import { verifySignature } from '../packages/shared/dist/crypto.js';
import express from 'express';

// Register the worker processor as the mock queue handler
registerMockQueueHandler(processDeliveryJob);

async function main() {
  console.log('⚡ Running End-to-End Integration Test Flow...');
  
  // 1. Clean and Seed Database
  console.log('🧹 Seeding local database...');
  try {
    await prisma.delivery.deleteMany();
    await prisma.event.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.endpoint.deleteMany();
    await prisma.eventType.deleteMany();
    await prisma.application.deleteMany();
    await prisma.apiKey.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  } catch (err) {
    console.warn('DB clean warning (continuing):', err);
  }

  const org = await prisma.organization.create({
    data: {
      id: 'org_test_123',
      name: 'E2E Test Org',
      plan: 'business' // Set business tier to enable transformations
    }
  });

  const app = await prisma.application.create({
    data: {
      id: 'app_test_123',
      orgId: org.id,
      name: 'E2E Test App'
    }
  });

  const apiKeyStr = 'whkey_test_api_key_12345';
  await prisma.apiKey.create({
    data: {
      orgId: org.id,
      keyHash: hashApiKey(apiKeyStr),
      environment: 'production'
    }
  });

  const eventType = await prisma.eventType.create({
    data: {
      appId: app.id,
      name: 'user.created'
    }
  });

  const endpointSecret = 'whsec_testsecretkey12345';
  const endpoint = await prisma.endpoint.create({
    data: {
      id: 'ep_test_123',
      appId: app.id,
      url: 'http://localhost:4000/webhook-receiver',
      description: 'Mock Receiver',
      secret: endpointSecret,
      status: 'active'
    }
  });

  await prisma.subscription.create({
    data: {
      endpointId: endpoint.id,
      eventTypeId: eventType.id
    }
  });

  // Setup Transformation (Business tier)
  await prisma.transformation.create({
    data: {
      endpointId: endpoint.id,
      code: `
        function transform(payload, eventType) {
          payload.transformedBy = 'WebhookEngine Sandbox';
          payload.status = 'processed';
          return payload;
        }
      `,
      enabled: true
    }
  });

  console.log('✅ Database setup complete.');

  // 2. Start Mock Webhook Receiver on port 4000
  let receivedPayload: any = null;
  let signatureVerified = false;

  const mockReceiver = express();
  mockReceiver.use(express.json());
  mockReceiver.post('/webhook-receiver', (req, res) => {
    console.log('📥 Mock Receiver got request body:', req.body);
    receivedPayload = req.body;
    
    // Verify signature
    const sigHeader = req.headers['webhook-signature'] as string;
    const bodyStr = JSON.stringify(req.body);
    const isValid = verifySignature(bodyStr, sigHeader, endpointSecret);
    signatureVerified = isValid;
    console.log(`🔒 HMAC Signature Validation Status: ${isValid ? 'VALID' : 'INVALID'}`);

    res.status(200).send('OK');
  });

  const receiverServer = mockReceiver.listen(4000, () => {
    console.log('📡 Mock Webhook Receiver listening on port 4000');
  });

  // 3. Start API Service in-process
  console.log('🚀 Starting API Service in-process...');
  const apiModule = await import('../apps/api/dist/index.js');

  // Wait 1.5 seconds for API server to boot up
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // 4. Use SDK client to dispatch event
  console.log('📤 Dispatching test event via SDK client...');
  const sdk = new WebhookEngine({
    apiKey: apiKeyStr,
    appId: app.id,
    baseUrl: 'http://localhost:3000'
  });

  try {
    const res = await sdk.events.create({
      eventType: 'user.created',
      payload: {
        userId: 'usr_500',
        name: 'John Doe',
        email: 'john@example.com'
      }
    });
    console.log('✅ SDK response:', res);
  } catch (err) {
    console.error('❌ SDK event dispatch failed:', err);
  }

  // Wait 2 seconds for delivery queue setTimeout to process
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // 5. Verify results
  console.log('\n🔍 Verifying Delivery logs in DB...');
  const dbDeliveries = await prisma.delivery.findMany({
    include: { event: true }
  });

  console.log('DB Delivery Log:', dbDeliveries);

  let testPassed = true;

  if (dbDeliveries.length === 0) {
    console.error('❌ Failed: No delivery logs created in DB.');
    testPassed = false;
  } else {
    const log = dbDeliveries[0];
    if (log.status !== 'success') {
      console.error(`❌ Failed: Delivery status in DB is '${log.status}'. Expected 'success'.`);
      testPassed = false;
    } else {
      console.log('✅ Success: Delivery log recorded success status.');
    }
  }

  if (!receivedPayload) {
    console.error('❌ Failed: Mock Webhook Receiver did not receive payload.');
    testPassed = false;
  } else {
    console.log('✅ Success: Mock Webhook Receiver received the event.');
    
    // Verify transformation applied
    if (receivedPayload.transformedBy === 'WebhookEngine Sandbox' && receivedPayload.status === 'processed') {
      console.log('✅ Success: Payload Transformation successfully processed inside QuickJS sandbox.');
    } else {
      console.error('❌ Failed: Payload does not contain transformation keys:', receivedPayload);
      testPassed = false;
    }

    if (signatureVerified) {
      console.log('✅ Success: HMAC-SHA256 signature verified matching receiver.');
    } else {
      console.error('❌ Failed: Signature verification failed on receiver.');
      testPassed = false;
    }
  }

  // 6. Cleanup
  console.log('\n🧹 Cleaning up receiver and API servers...');
  receiverServer.close();
  if (apiModule && (apiModule as any).server) {
    (apiModule as any).server.close();
  }
  await prisma.$disconnect();

  if (testPassed) {
    console.log('\n🎉 ALL END-TO-END PIPELINE VERIFICATIONS PASSED SUCCESSFULLY!');
    process.exit(0);
  } else {
    console.log('\n❌ PIPELINE VERIFICATION FAILED.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
