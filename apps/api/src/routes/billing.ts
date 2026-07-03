import { Router, Response } from 'express';
import { prisma } from '../db.js';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

// Retrieve billing details and monthly usage statistics
router.get('/billing/usage', authenticateUser as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

    // Sum all usage counters for the current month
    const counters = await prisma.usageCounter.findMany({
      where: {
        orgId: req.org!.id,
        periodStart: { gte: startOfMonth },
        periodEnd: { lte: endOfMonth }
      }
    });

    const totalEvents = counters.reduce((sum, c) => sum + c.eventCount, 0);
    const totalOverage = counters.reduce((sum, c) => sum + c.overageCount, 0);

    // Tier configuration limits
    const planLimits: Record<string, { limit: number; price: number; name: string }> = {
      free: { limit: 10000, price: 0, name: 'Free Tier' },
      starter: { limit: 100000, price: 1500, name: 'Starter Tier' },
      growth: { limit: 1000000, price: 4900, name: 'Growth Tier' },
      business: { limit: 10000000, price: 15000, name: 'Business Tier' },
      enterprise: { limit: 999999999, price: 50000, name: 'Enterprise Tier' }
    };

    const currentPlan = req.org!.plan || 'free';
    const planConfig = planLimits[currentPlan] || planLimits.free;

    return res.json({
      plan: currentPlan,
      planName: planConfig.name,
      eventLimit: planConfig.limit,
      eventCount: totalEvents,
      overageCount: totalOverage,
      percentUsed: Math.min((totalEvents / planConfig.limit) * 100, 100),
      periodStart: startOfMonth.toISOString(),
      periodEnd: endOfMonth.toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve usage stats' });
  }
});

// Razorpay Webhook listener (Subscription lifecycle management)
router.post('/billing/razorpay/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const payload = req.body;

  // In production, you would verify the signature using Razorpay Webhook Secret:
  // const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(payload)).digest('hex');
  // if (signature !== expectedSignature) return res.status(400).send('Invalid signature');

  try {
    const { event, payload: eventPayload } = payload;

    if (!event || !eventPayload) {
      return res.status(400).json({ error: 'Invalid webhook payload structure' });
    }

    const subEntity = eventPayload.subscription?.entity;
    if (!subEntity) {
      return res.json({ status: 'ignored', reason: 'No subscription entity' });
    }

    const razorpaySubId = subEntity.id;
    const razorpayCustomerId = subEntity.customer_id;
    const status = subEntity.status; // active, authenticated, charged, completed, created, halted, pending, activated, cancelled
    
    // Map notes or standard mapping to find organization
    // Let's assume organization ID was passed as metadata in subscription notes
    const orgId = subEntity.notes?.orgId;

    if (!orgId) {
      return res.json({ status: 'ignored', reason: 'No orgId found in subscription notes' });
    }

    let planName = 'free';
    if (event === 'subscription.charged' || status === 'active' || status === 'activated') {
      const planId = subEntity.plan_id;
      if (planId === process.env.RAZORPAY_PLAN_STARTER) planName = 'starter';
      else if (planId === process.env.RAZORPAY_PLAN_GROWTH) planName = 'growth';
      else if (planId === process.env.RAZORPAY_PLAN_BUSINESS) planName = 'business';
    } else if (
      event === 'subscription.cancelled' ||
      event === 'subscription.halted' ||
      status === 'cancelled' ||
      status === 'halted'
    ) {
      planName = 'free';
    }

    await prisma.$transaction(async (tx) => {
      // Update Org tier
      await tx.organization.update({
        where: { id: orgId },
        data: {
          plan: planName,
          razorpayCustomerId: razorpayCustomerId || undefined
        }
      });

      // Find or create Plan in DB
      let planRecord = await tx.plan.findFirst({
        where: { name: planName }
      });

      if (!planRecord) {
        planRecord = await tx.plan.create({
          data: {
            name: planName,
            eventLimit: planName === 'growth' ? 1000000 : planName === 'business' ? 10000000 : 10000,
            retentionDays: planName === 'business' ? 90 : 30,
            priceInr: planName === 'growth' ? 4900 : planName === 'business' ? 15000 : 0,
            featuresJson: JSON.stringify([])
          }
        });
      }

      // Upsert billing subscription record
      await tx.subscriptionBilling.upsert({
        where: { id: orgId }, // Assumes 1 active billing profile per org
        create: {
          id: orgId,
          orgId,
          planId: planRecord.id,
          razorpaySubId,
          status,
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // Default 30 days
        },
        update: {
          planId: planRecord.id,
          razorpaySubId,
          status,
          currentPeriodEnd: subEntity.current_end ? new Date(subEntity.current_end * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });
    });

    return res.json({ status: 'success', message: 'Billing synced' });
  } catch (err) {
    console.error('Razorpay Webhook Error:', err);
    return res.status(500).json({ error: 'Failed to process Razorpay webhook' });
  }
});

export default router;
