import { prisma } from '../db.js';
import Razorpay from 'razorpay';

// Initialize Razorpay client (assumes credentials exist in env)
const razorpay = new (Razorpay as any)({
  key_id: process.env.RAZORPAY_KEY_ID || 'mock_key',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'mock_secret'
});

export async function processOverageBilling() {
  console.log('⏳ Running monthly overage billing cron job...');
  const now = new Date();

  // Find all active subscriptions that have reached their period end
  const pastDueSubscriptions = await prisma.subscriptionBilling.findMany({
    where: {
      status: 'active',
      currentPeriodEnd: { lte: now }
    }
  });

  console.log(`🔍 Found ${pastDueSubscriptions.length} subscriptions past due for period rollover.`);

  for (const sub of pastDueSubscriptions) {
    try {
      const orgId = sub.orgId;
      
      // Get all usage counters in the subscription's active billing cycle
      const usageCounters = await prisma.usageCounter.findMany({
        where: {
          orgId,
          periodEnd: { lte: sub.currentPeriodEnd }
        }
      });

      const totalOverage = usageCounters.reduce((sum, c) => sum + c.overageCount, 0);
      const totalEvents = usageCounters.reduce((sum, c) => sum + c.eventCount, 0);

      console.log(`Org ${orgId}: Total events = ${totalEvents}, Overages = ${totalOverage}`);

      if (totalOverage > 0) {
        // ₹99 per block of 10,000 overage events (rounded up)
        const overageBlocks = Math.ceil(totalOverage / 10000);
        const amountInr = overageBlocks * 99;
        const amountInPaise = amountInr * 100; // Razorpay expects amount in smallest currency unit

        console.log(`💳 Charging Org ${orgId} for ${overageBlocks} overage blocks: ₹${amountInr}`);

        if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_ID !== 'mock_key' && sub.razorpaySubId) {
          // Create an Add-On charge on the Razorpay Subscription
          // In Razorpay, add-ons charge the customer automatically on the next invoice generation or immediately
          await razorpay.subscriptions.createAddon(sub.razorpaySubId, {
            item: {
              name: `Overage Webhook Volume (${totalOverage} events)`,
              amount: amountInPaise,
              currency: 'INR'
            },
            quantity: 1
          });
          console.log(`✅ Razorpay addon charge registered successfully for subscription: ${sub.razorpaySubId}`);
        } else {
          console.log(`[MOCK BILLING] Simulated Razorpay addon charge of ₹${amountInr} for sub ${sub.razorpaySubId}`);
        }
      }

      // Roll over the billing cycle by adding 30 days
      const newPeriodEnd = new Date(sub.currentPeriodEnd.getTime() + 30 * 24 * 60 * 60 * 1000);

      await prisma.$transaction([
        // Archive/Reset current overages so they aren't billed twice
        prisma.usageCounter.updateMany({
          where: {
            orgId,
            periodEnd: { lte: sub.currentPeriodEnd }
          },
          data: {
            overageCount: 0
          }
        }),
        // Roll over subscription period
        prisma.subscriptionBilling.update({
          where: { id: sub.id },
          data: {
            currentPeriodEnd: newPeriodEnd
          }
        })
      ]);

      console.log(`✅ Org ${orgId} billing cycle successfully rolled over. Next period end: ${newPeriodEnd.toISOString()}`);
    } catch (err) {
      console.error(`❌ Failed to process overage billing for subscription ID ${sub.id}:`, err);
    }
  }

  console.log('✨ Overage billing cron run complete.');
}
