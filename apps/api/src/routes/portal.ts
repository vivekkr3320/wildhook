import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { prisma } from '../db.js';
import {
  authenticateApiKey,
  authenticatePortalToken,
  PORTAL_JWT_SECRET,
  AuthenticatedRequest
} from '../middleware/auth.js';
import { PortalSessionSchema, EndpointCreateSchema } from '@webhookengine/shared';

const router = Router();

// Create a short-lived portal token for a customer reference (Backend to Backend)
router.post('/portal/session', authenticateApiKey as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { customerRef, expiresInSeconds } = PortalSessionSchema.parse(req.body);

    const token = jwt.sign(
      {
        orgId: req.org!.id,
        customerRef
      },
      PORTAL_JWT_SECRET,
      { expiresIn: expiresInSeconds }
    );

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    // Persist in DB
    await prisma.portalToken.create({
      data: {
        orgId: req.org!.id,
        customerRef,
        tokenHash,
        expiresAt
      }
    });

    return res.status(201).json({
      portalToken: token,
      expiresAt: expiresAt.toISOString()
    });
  } catch (err) {
    if (err && (err as any).name === 'ZodError') {
      return res.status(400).json({ error: (err as any).message });
    }
    return res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// Retrieve endpoints scoped to portal session customer_ref
router.get('/portal/endpoints', authenticatePortalToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const { orgId, customerRef } = req.portalSession!;
  const portalTag = `[portal:${customerRef}]`;

  try {
    const endpoints = await prisma.endpoint.findMany({
      where: {
        application: { orgId },
        description: { startsWith: portalTag }
      },
      include: {
        subscriptions: {
          include: { eventType: true }
        }
      }
    });

    // Clean up description tag before returning to customer
    const cleaned = endpoints.map((ep) => ({
      ...ep,
      description: ep.description?.replace(portalTag, '').trim()
    }));

    return res.json(cleaned);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve portal endpoints' });
  }
});

// Create endpoint via customer portal
router.post('/portal/endpoints', authenticatePortalToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const { orgId, customerRef } = req.portalSession!;
  const portalTag = `[portal:${customerRef}]`;

  try {
    const { url, description, eventTypes } = EndpointCreateSchema.parse(req.body);

    // Get the first application for this org to attach the endpoint to
    const app = await prisma.application.findFirst({
      where: { orgId }
    });

    if (!app) {
      return res.status(400).json({ error: 'System not fully configured. Contact support.' });
    }

    const secret = 'whsec_' + crypto.randomBytes(20).toString('base64url');

    const endpoint = await prisma.$transaction(async (tx) => {
      const ep = await tx.endpoint.create({
        data: {
          appId: app.id,
          url,
          description: `${portalTag} ${description || ''}`.trim(),
          secret,
          status: 'active'
        }
      });

      for (const typeName of eventTypes) {
        let eventType = await tx.eventType.findFirst({
          where: { name: typeName, appId: app.id }
        });

        if (!eventType) {
          eventType = await tx.eventType.create({
            data: { name: typeName, appId: app.id }
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

    return res.status(201).json({
      ...endpoint,
      description: endpoint.description?.replace(portalTag, '').trim()
    });
  } catch (err) {
    if (err && (err as any).name === 'ZodError') {
      return res.status(400).json({ error: (err as any).message });
    }
    return res.status(500).json({ error: 'Failed to create endpoint' });
  }
});

// Get delivery logs scoped to portal session customer_ref
router.get('/portal/deliveries', authenticatePortalToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const { orgId, customerRef } = req.portalSession!;
  const portalTag = `[portal:${customerRef}]`;

  try {
    const deliveries = await prisma.delivery.findMany({
      where: {
        endpoint: {
          application: { orgId },
          description: { startsWith: portalTag }
        }
      },
      include: {
        event: {
          include: { eventType: true }
        },
        endpoint: true
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    // Clean tag in endpoints
    const cleaned = deliveries.map((d) => ({
      ...d,
      endpoint: {
        ...d.endpoint,
        description: d.endpoint.description?.replace(portalTag, '').trim()
      }
    }));

    return res.json(cleaned);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve portal delivery logs' });
  }
});

// Replay a delivery log via the portal session scope
router.post('/portal/deliveries/:id/replay', authenticatePortalToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { orgId, customerRef } = req.portalSession!;
  const portalTag = `[portal:${customerRef}]`;

  try {
    const oldDelivery = await prisma.delivery.findFirst({
      where: {
        id,
        endpoint: {
          application: { orgId },
          description: { startsWith: portalTag }
        }
      },
      include: { event: true }
    });

    if (!oldDelivery) return res.status(404).json({ error: 'Delivery log not found' });

    const newDelivery = await prisma.delivery.create({
      data: {
        eventId: oldDelivery.eventId,
        endpointId: oldDelivery.endpointId,
        attemptNumber: 1,
        status: 'pending'
      }
    });

    const { enqueueWebhook } = await import('../queue.js');
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

export default router;
