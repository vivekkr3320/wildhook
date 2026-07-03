import { Router, Response } from 'express';
import { prisma } from '../db.js';
import { authenticateApiKey, AuthenticatedRequest } from '../middleware/auth.js';
import { EventIngestSchema } from '@webhookengine/shared';
import { enqueueWebhook } from '../queue.js';

// Simple in-memory cache for plan event limits to optimize hot ingestion path
const planCache: Record<string, { limit: number; timestamp: number }> = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const router = Router();

// Ingest a new event
router.post('/events', authenticateApiKey as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { eventType, payload, idempotencyKey } = EventIngestSchema.parse(req.body);
    const appId = req.headers['x-app-id'] as string;

    if (!appId) {
      return res.status(400).json({ error: 'x-app-id header is required to specify the application' });
    }

    // Verify application belongs to organization
    const app = await prisma.application.findFirst({
      where: { id: appId, orgId: req.org!.id }
    });

    if (!app) {
      return res.status(404).json({ error: 'Application not found or unauthorized' });
    }

    // Billing Quota Check
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

    const usageCounters = await prisma.usageCounter.findMany({
      where: {
        orgId: req.org!.id,
        periodStart: { gte: startOfMonth },
        periodEnd: { lte: endOfMonth }
      }
    });

    const totalEvents = usageCounters.reduce((sum, c) => sum + c.eventCount, 0);

    const planLimits: Record<string, number> = {
      free: 10000,
      starter: 100000,
      growth: 1000000,
      business: 10000000,
      enterprise: 999999999
    };

    const orgPlan = req.org!.plan || 'free';
    let limit = planLimits[orgPlan] || 10000;

    const cached = planCache[orgPlan];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      limit = cached.limit;
    } else {
      const planRecord = await prisma.plan.findFirst({
        where: { name: orgPlan }
      });
      if (planRecord) {
        limit = planRecord.eventLimit;
        planCache[orgPlan] = { limit, timestamp: Date.now() };
      }
    }

    const isOverage = totalEvents >= limit;

    // Hard block on Free tier only
    if (req.org!.plan === 'free' && isOverage) {
      return res.status(402).json({
        error: `Webhook quota exceeded. You have dispatched ${totalEvents} of your ${limit} limit for this billing period. Please upgrade to a paid plan.`
      });
    }

    // Find or create EventType
    let typeRecord = await prisma.eventType.findFirst({
      where: { name: eventType, appId }
    });

    if (!typeRecord) {
      typeRecord = await prisma.eventType.create({
        data: { name: eventType, appId }
      });
    }

    // Handle Idempotency
    if (idempotencyKey) {
      const existingEvent = await prisma.event.findFirst({
        where: { appId, idempotencyKey }
      });
      if (existingEvent) {
        return res.status(200).json({
          message: 'Duplicate event ignored (idempotent)',
          eventId: existingEvent.id
        });
      }
    }

    // Create Event
    const event = await prisma.event.create({
      data: {
        appId,
        eventTypeId: typeRecord.id,
        payloadJson: JSON.stringify(payload),
        idempotencyKey
      }
    });

    // Match active subscriptions
    const subscriptions = await prisma.subscription.findMany({
      where: {
        eventTypeId: typeRecord.id,
        endpoint: { appId, status: 'active' }
      },
      include: { endpoint: true }
    });

    const deliveriesToCreate = subscriptions.map((sub) => ({
      eventId: event.id,
      endpointId: sub.endpointId,
      attemptNumber: 1,
      status: 'pending'
    }));

    if (deliveriesToCreate.length > 0) {
      // Create delivery logs
      await prisma.$transaction(
        deliveriesToCreate.map((d) =>
          prisma.delivery.create({
            data: d
          })
        )
      );

      // Enqueue delivery jobs
      for (const d of deliveriesToCreate) {
        await enqueueWebhook({
          eventId: event.id,
          endpointId: d.endpointId,
          attemptNumber: 1
        });
      }
    }

    // Update usage counters
    const counterDate = new Date();
    counterDate.setHours(0, 0, 0, 0);
    const endOfDay = new Date(counterDate);
    endOfDay.setHours(23, 59, 59, 999);
    const counterId = `${req.org!.id}-${counterDate.toISOString().split('T')[0]}`;

    try {
      await prisma.usageCounter.upsert({
        where: { id: counterId },
        create: {
          id: counterId,
          orgId: req.org!.id,
          periodStart: counterDate,
          periodEnd: endOfDay,
          eventCount: 1,
          overageCount: isOverage ? 1 : 0
        },
        update: {
          eventCount: { increment: 1 },
          overageCount: isOverage ? { increment: 1 } : undefined
        }
      });
    } catch (upsertErr) {
      console.error('Failed to update usage counter', upsertErr);
    }

    return res.status(202).json({
      message: 'Event accepted',
      eventId: event.id,
      deliveriesCount: deliveriesToCreate.length
    });

  } catch (err) {
    if (err && (err as any).name === 'ZodError') {
      return res.status(400).json({ error: (err as any).message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Failed to ingest event' });
  }
});

// Retrieve details for a specific event
router.get('/events/:id', authenticateApiKey as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  try {
    const event = await prisma.event.findFirst({
      where: { id, application: { orgId: req.org!.id } },
      include: {
        eventType: true,
        deliveries: {
          include: { endpoint: true }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    return res.json(event);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve event' });
  }
});

export default router;
