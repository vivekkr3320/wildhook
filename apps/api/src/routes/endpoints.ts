import { Router, Response } from 'express';
import * as crypto from 'crypto';
import { prisma } from '../db.js';
import { authenticateUser, AuthenticatedRequest, requirePlan } from '../middleware/auth.js';
import {
  EndpointCreateSchema,
  EndpointUpdateSchema,
  TransformationSchema,
  AlertConfigSchema
} from '@webhookengine/shared';
import { enqueueWebhook } from '../queue.js';

const router = Router();

// --- Applications ---

router.get('/apps', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const apps = await prisma.application.findMany({
      where: { orgId: req.org!.id }
    });
    return res.json(apps);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve applications' });
  }
});

router.post('/apps', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Application name is required' });

  try {
    const app = await prisma.application.create({
      data: { name, orgId: req.org!.id }
    });
    return res.status(201).json(app);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create application' });
  }
});

// --- Endpoints ---

router.get('/apps/:appId/endpoints', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  const { appId } = req.params;

  try {
    const app = await prisma.application.findFirst({
      where: { id: appId, orgId: req.org!.id }
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const endpoints = await prisma.endpoint.findMany({
      where: { appId },
      include: {
        subscriptions: {
          include: { eventType: true }
        },
        transformation: true
      }
    });

    return res.json(endpoints);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve endpoints' });
  }
});

router.post('/apps/:appId/endpoints', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  const { appId } = req.params;

  try {
    const app = await prisma.application.findFirst({
      where: { id: appId, orgId: req.org!.id }
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const { url, description, eventTypes } = EndpointCreateSchema.parse(req.body);

    const secret = 'whsec_' + crypto.randomBytes(20).toString('base64url');

    const endpoint = await prisma.$transaction(async (tx) => {
      const ep = await tx.endpoint.create({
        data: {
          appId,
          url,
          description,
          secret,
          status: 'active'
        }
      });

      // Map eventTypes to EventType entities and create subscriptions
      for (const typeName of eventTypes) {
        let eventType = await tx.eventType.findFirst({
          where: { name: typeName, appId }
        });

        if (!eventType) {
          eventType = await tx.eventType.create({
            data: { name: typeName, appId }
          });
        }

        await tx.subscription.create({
          data: {
            endpointId: ep.id,
            eventTypeId: eventType.id
          }
        });
      }

      return ep;
    });

    return res.status(201).json(endpoint);
  } catch (err) {
    if (err && (err as any).name === 'ZodError') {
      return res.status(400).json({ error: (err as any).message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to create endpoint' });
  }
});

router.patch('/endpoints/:id', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  try {
    const endpoint = await prisma.endpoint.findFirst({
      where: { id, application: { orgId: req.org!.id } }
    });
    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

    const { url, description, eventTypes, status } = EndpointUpdateSchema.parse(req.body);

    const updated = await prisma.$transaction(async (tx) => {
      const ep = await tx.endpoint.update({
        where: { id },
        data: {
          url: url ?? undefined,
          description: description ?? undefined,
          status: status ?? undefined,
          disabledAt: status === 'disabled' ? new Date() : status === 'active' ? null : undefined
        }
      });

      if (eventTypes) {
        // Clear previous subscriptions and add new ones
        await tx.subscription.deleteMany({ where: { endpointId: id } });

        for (const typeName of eventTypes) {
          let eventType = await tx.eventType.findFirst({
            where: { name: typeName, appId: endpoint.appId }
          });

          if (!eventType) {
            eventType = await tx.eventType.create({
              data: { name: typeName, appId: endpoint.appId }
            });
          }

          await tx.subscription.create({
            data: {
              endpointId: id,
              eventTypeId: eventType.id
            }
          });
        }
      }

      return ep;
    });

    return res.json(updated);
  } catch (err) {
    if (err && (err as any).name === 'ZodError') {
      return res.status(400).json({ error: (err as any).message });
    }
    return res.status(500).json({ error: 'Failed to update endpoint' });
  }
});

router.delete('/endpoints/:id', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  try {
    const endpoint = await prisma.endpoint.findFirst({
      where: { id, application: { orgId: req.org!.id } }
    });
    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

    await prisma.endpoint.delete({ where: { id } });
    return res.json({ message: 'Endpoint deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete endpoint' });
  }
});

// --- Test Sandbox Mode ---

router.post('/endpoints/:id/test', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  try {
    const endpoint = await prisma.endpoint.findFirst({
      where: { id, application: { orgId: req.org!.id } },
      include: { application: true }
    });
    if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

    // Find or create test event type
    let testType = await prisma.eventType.findFirst({
      where: { name: 'test.event', appId: endpoint.appId }
    });
    if (!testType) {
      testType = await prisma.eventType.create({
        data: { name: 'test.event', appId: endpoint.appId }
      });
    }

    const event = await prisma.event.create({
      data: {
        appId: endpoint.appId,
        eventTypeId: testType.id,
        payloadJson: JSON.stringify({
          event: 'test.event',
          timestamp: new Date().toISOString(),
          msg: 'This is a test webhook event from WebhookEngine'
        })
      }
    });

    const delivery = await prisma.delivery.create({
      data: {
        eventId: event.id,
        endpointId: endpoint.id,
        attemptNumber: 1,
        status: 'pending'
      }
    });

    await enqueueWebhook({
      eventId: event.id,
      endpointId: endpoint.id,
      attemptNumber: 1
    });

    return res.json({
      message: 'Test webhook enqueued',
      eventId: event.id,
      deliveryId: delivery.id
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to trigger test webhook' });
  }
});

// --- Replay Delivery ---

router.post('/deliveries/:id/replay', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  try {
    const oldDelivery = await prisma.delivery.findFirst({
      where: { id, endpoint: { application: { orgId: req.org!.id } } },
      include: { event: true }
    });

    if (!oldDelivery) return res.status(404).json({ error: 'Delivery log not found' });

    // Create a new delivery attempt
    const newDelivery = await prisma.delivery.create({
      data: {
        eventId: oldDelivery.eventId,
        endpointId: oldDelivery.endpointId,
        attemptNumber: 1,
        status: 'pending'
      }
    });

    await enqueueWebhook({
      eventId: oldDelivery.eventId,
      endpointId: oldDelivery.endpointId,
      attemptNumber: 1
    });

    return res.json({
      message: 'Webhook replay enqueued',
      deliveryId: newDelivery.id
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to replay webhook' });
  }
});

// --- Payload Transformations (Gated) ---

router.post(
  '/endpoints/:id/transformation',
  authenticateUser as any,
  requirePlan('business') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    try {
      const endpoint = await prisma.endpoint.findFirst({
        where: { id, application: { orgId: req.org!.id } }
      });
      if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });

      const { code, language, enabled } = TransformationSchema.parse(req.body);

      const trans = await prisma.transformation.upsert({
        where: { endpointId: id },
        create: {
          endpointId: id,
          code,
          language,
          enabled
        },
        update: {
          code,
          language,
          enabled
        }
      });

      return res.json(trans);
    } catch (err) {
      if (err && (err as any).name === 'ZodError') {
        return res.status(400).json({ error: (err as any).message });
      }
      return res.status(500).json({ error: 'Failed to configure payload transformation' });
    }
  }
);

// --- Alert Configs ---

router.get('/alerts/config', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configs = await prisma.alertConfig.findMany({
      where: { orgId: req.org!.id }
    });
    return res.json(configs);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve alert configurations' });
  }
});

router.post('/alerts/config', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { channel, target, threshold, enabled } = AlertConfigSchema.parse(req.body);

    const config = await prisma.alertConfig.create({
      data: {
        orgId: req.org!.id,
        channel,
        target,
        threshold,
        enabled
      }
    });

    return res.status(201).json(config);
  } catch (err) {
    if (err && (err as any).name === 'ZodError') {
      return res.status(400).json({ error: (err as any).message });
    }
    return res.status(500).json({ error: 'Failed to create alert configuration' });
  }
});

export default router;
