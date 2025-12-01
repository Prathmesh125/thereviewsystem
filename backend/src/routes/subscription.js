const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { verifyFirebaseToken } = require('../middleware/firebaseAuth');
const firestoreDb = require('../services/firestoreService');

const router = express.Router();

// Subscription plans configuration
const SUBSCRIPTION_PLANS = {
  free: {
    name: 'Free',
    price: 0,
    features: {
      maxReviews: 50,
      maxQRCodes: 2,
      maxCustomers: 100,
      aiGenerationsPerMonth: 10,
      analytics: 'basic',
      formTemplates: 1,
      emailNotifications: false,
      prioritySupport: false,
      customBranding: false,
      apiAccess: false
    }
  },
  starter: {
    name: 'Starter',
    price: 19,
    features: {
      maxReviews: 500,
      maxQRCodes: 10,
      maxCustomers: 1000,
      aiGenerationsPerMonth: 100,
      analytics: 'standard',
      formTemplates: 5,
      emailNotifications: true,
      prioritySupport: false,
      customBranding: false,
      apiAccess: false
    }
  },
  professional: {
    name: 'Professional',
    price: 49,
    features: {
      maxReviews: -1, // unlimited
      maxQRCodes: -1,
      maxCustomers: -1,
      aiGenerationsPerMonth: 500,
      analytics: 'advanced',
      formTemplates: -1,
      emailNotifications: true,
      prioritySupport: true,
      customBranding: true,
      apiAccess: true
    }
  },
  enterprise: {
    name: 'Enterprise',
    price: 199,
    features: {
      maxReviews: -1,
      maxQRCodes: -1,
      maxCustomers: -1,
      aiGenerationsPerMonth: -1,
      analytics: 'enterprise',
      formTemplates: -1,
      emailNotifications: true,
      prioritySupport: true,
      customBranding: true,
      apiAccess: true,
      dedicatedSupport: true,
      sla: true
    }
  }
};

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed', 
      details: errors.array() 
    });
  }
  next();
};

// GET /api/subscription/plans - Get all subscription plans
router.get('/plans', async (req, res) => {
  try {
    res.json(SUBSCRIPTION_PLANS);
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
});

// GET /api/subscription/current - Get current subscription for user
router.get('/current', verifyFirebaseToken, async (req, res) => {
  try {
    // Find user
    const user = await firestoreDb.user.findByEmail(req.user.email);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Find business owned by this user
    const business = await firestoreDb.business.findFirst({ userId: user.id });
    
    if (!business) {
      return res.status(400).json({ error: 'No business associated with user' });
    }

    // Find subscription
    let subscription = await firestoreDb.subscription.findByBusinessId(business.id);

    if (!subscription) {
      // Create default free subscription
      subscription = await firestoreDb.subscription.create({
        businessId: business.id,
        plan: 'free',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });
    }

    const planDetails = SUBSCRIPTION_PLANS[subscription.plan] || SUBSCRIPTION_PLANS.free;

    res.json({
      subscription: {
        ...subscription,
        planDetails
      }
    });
  } catch (error) {
    console.error('Error fetching subscription:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

// GET /api/subscription/usage - Get usage statistics for current subscription
router.get('/usage', verifyFirebaseToken, async (req, res) => {
  try {
    // Find user
    const user = await firestoreDb.user.findByEmail(req.user.email);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Find business owned by this user
    const business = await firestoreDb.business.findFirst({ userId: user.id });
    
    if (!business) {
      return res.status(400).json({ error: 'No business associated with user' });
    }

    // Find subscription
    let subscription = await firestoreDb.subscription.findByBusinessId(business.id);
    const plan = subscription?.plan || 'free';
    const planFeatures = SUBSCRIPTION_PLANS[plan]?.features || SUBSCRIPTION_PLANS.free.features;

    // Get current usage
    const [reviewCount, qrCodeCount, customerCount] = await Promise.all([
      firestoreDb.review.count({ businessId: business.id }),
      firestoreDb.qrCode.count({ businessId: business.id }),
      firestoreDb.customer.count({ businessId: business.id })
    ]);

    // Get AI generations this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const aiGenerations = await firestoreDb.aiGeneration.findMany({
      where: {
        businessId: business.id,
        createdAt: { gte: startOfMonth }
      }
    });

    const aiGenerationsCount = aiGenerations.length;

    const usage = {
      reviews: {
        used: reviewCount,
        limit: planFeatures.maxReviews,
        unlimited: planFeatures.maxReviews === -1
      },
      qrCodes: {
        used: qrCodeCount,
        limit: planFeatures.maxQRCodes,
        unlimited: planFeatures.maxQRCodes === -1
      },
      customers: {
        used: customerCount,
        limit: planFeatures.maxCustomers,
        unlimited: planFeatures.maxCustomers === -1
      },
      aiGenerations: {
        used: aiGenerationsCount,
        limit: planFeatures.aiGenerationsPerMonth,
        unlimited: planFeatures.aiGenerationsPerMonth === -1,
        resetsOn: new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 1)
      }
    };

    res.json({
      plan,
      usage,
      features: planFeatures
    });
  } catch (error) {
    console.error('Error fetching usage:', error);
    res.status(500).json({ error: 'Failed to fetch usage statistics' });
  }
});

// POST /api/subscription/upgrade - Upgrade subscription
router.post('/upgrade',
  verifyFirebaseToken,
  [body('plan').isIn(['starter', 'professional', 'enterprise'])],
  handleValidationErrors,
  async (req, res) => {
    try {
      // Find user
      const user = await firestoreDb.user.findByEmail(req.user.email);
      if (!user) {
        return res.status(400).json({ error: 'User not found' });
      }

      // Find business owned by this user
      const business = await firestoreDb.business.findFirst({ userId: user.id });
      
      if (!business) {
        return res.status(400).json({ error: 'No business associated with user' });
      }

      const { plan } = req.body;

      // Find or create subscription
      let subscription = await firestoreDb.subscription.findByBusinessId(business.id);
      
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      if (subscription) {
        subscription = await firestoreDb.subscription.update(
          { id: subscription.id },
          {
            plan,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd
          }
        );
      } else {
        subscription = await firestoreDb.subscription.create({
          businessId: business.id,
          plan,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd
        });
      }

      const planDetails = SUBSCRIPTION_PLANS[plan];

      res.json({
        success: true,
        message: `Successfully upgraded to ${planDetails.name} plan`,
        subscription: {
          ...subscription,
          planDetails
        }
      });
    } catch (error) {
      console.error('Error upgrading subscription:', error);
      res.status(500).json({ error: 'Failed to upgrade subscription' });
    }
  }
);

// POST /api/subscription/cancel - Cancel subscription
router.post('/cancel', verifyFirebaseToken, async (req, res) => {
  try {
    // Find user
    const user = await firestoreDb.user.findByEmail(req.user.email);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Find business owned by this user
    const business = await firestoreDb.business.findFirst({ userId: user.id });
    
    if (!business) {
      return res.status(400).json({ error: 'No business associated with user' });
    }

    // Find subscription
    const subscription = await firestoreDb.subscription.findByBusinessId(business.id);
    
    if (!subscription) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    if (subscription.plan === 'free') {
      return res.status(400).json({ error: 'Cannot cancel free plan' });
    }

    // Update subscription to cancelled, will downgrade to free at period end
    const updatedSubscription = await firestoreDb.subscription.update(
      { id: subscription.id },
      {
        status: 'cancelled',
        cancelledAt: new Date()
      }
    );

    res.json({
      success: true,
      message: 'Subscription cancelled. You will be downgraded to the free plan at the end of your billing period.',
      subscription: updatedSubscription
    });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// POST /api/subscription/check-limit - Check if user can perform action based on limits
router.post('/check-limit',
  verifyFirebaseToken,
  [body('action').isIn(['review', 'qr_code', 'customer', 'ai_generation'])],
  handleValidationErrors,
  async (req, res) => {
    try {
      // Find user
      const user = await firestoreDb.user.findByEmail(req.user.email);
      if (!user) {
        return res.status(400).json({ error: 'User not found' });
      }

      // Find business owned by this user
      const business = await firestoreDb.business.findFirst({ userId: user.id });
      
      if (!business) {
        return res.status(400).json({ error: 'No business associated with user' });
      }

      const { action } = req.body;

      // Find subscription
      const subscription = await firestoreDb.subscription.findByBusinessId(business.id);
      const plan = subscription?.plan || 'free';
      const planFeatures = SUBSCRIPTION_PLANS[plan]?.features || SUBSCRIPTION_PLANS.free.features;

      let currentCount, limit, allowed;

      switch (action) {
        case 'review':
          currentCount = await firestoreDb.review.count({ businessId: business.id });
          limit = planFeatures.maxReviews;
          allowed = limit === -1 || currentCount < limit;
          break;

        case 'qr_code':
          currentCount = await firestoreDb.qrCode.count({ businessId: business.id });
          limit = planFeatures.maxQRCodes;
          allowed = limit === -1 || currentCount < limit;
          break;

        case 'customer':
          currentCount = await firestoreDb.customer.count({ businessId: business.id });
          limit = planFeatures.maxCustomers;
          allowed = limit === -1 || currentCount < limit;
          break;

        case 'ai_generation':
          const startOfMonth = new Date();
          startOfMonth.setDate(1);
          startOfMonth.setHours(0, 0, 0, 0);
          
          const aiGens = await firestoreDb.aiGeneration.findMany({
            where: {
              businessId: business.id,
              createdAt: { gte: startOfMonth }
            }
          });
          currentCount = aiGens.length;
          limit = planFeatures.aiGenerationsPerMonth;
          allowed = limit === -1 || currentCount < limit;
          break;

        default:
          return res.status(400).json({ error: 'Invalid action' });
      }

      res.json({
        allowed,
        currentCount,
        limit,
        unlimited: limit === -1,
        plan,
        upgradeRequired: !allowed
      });
    } catch (error) {
      console.error('Error checking limit:', error);
      res.status(500).json({ error: 'Failed to check limit' });
    }
  }
);

// GET /api/subscription/features - Get features for specific plan
router.get('/features/:plan',
  [param('plan').isIn(['free', 'starter', 'professional', 'enterprise'])],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { plan } = req.params;
      const planDetails = SUBSCRIPTION_PLANS[plan];

      if (!planDetails) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      res.json(planDetails);
    } catch (error) {
      console.error('Error fetching plan features:', error);
      res.status(500).json({ error: 'Failed to fetch plan features' });
    }
  }
);

// GET /api/subscription/compare - Compare all plans
router.get('/compare', async (req, res) => {
  try {
    const comparison = Object.entries(SUBSCRIPTION_PLANS).map(([key, plan]) => ({
      id: key,
      name: plan.name,
      price: plan.price,
      ...plan.features
    }));

    res.json(comparison);
  } catch (error) {
    console.error('Error comparing plans:', error);
    res.status(500).json({ error: 'Failed to compare plans' });
  }
});

module.exports = router;
