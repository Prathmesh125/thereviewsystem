const subscriptionService = require('../services/subscriptionService');
const firestoreDb = require('../services/firestoreService');

/**
 * Middleware to check subscription limits for specific features
 */
const checkSubscriptionLimit = (feature) => {
  return async (req, res, next) => {
    try {
      // Get business ID from request context
      let businessId = req.body.businessId || req.params.businessId;
      
      // If not provided directly, get from user's business
      if (!businessId && req.user?.email) {
        const business = await firestoreDb.business.findFirst({
          userId: (await firestoreDb.user.findByEmail(req.user.email))?.id
        });
        businessId = business?.id;
      }

      if (!businessId) {
        return res.status(400).json({
          success: false,
          message: 'Business not found'
        });
      }

      // Check usage limit
      const usageCheck = await subscriptionService.checkUsageLimit(businessId, feature);
      
      if (!usageCheck.allowed) {
        const plan = await subscriptionService.getSubscriptionAnalytics(businessId);
        const currentPlan = plan.currentPlan;
        
        let upgradeMessage = '';
        if (currentPlan.id === 'free') {
          upgradeMessage = 'Upgrade to Pro or Ultimate plan to continue using this feature.';
        } else if (currentPlan.id === 'pro') {
          upgradeMessage = 'Upgrade to Ultimate plan for unlimited access.';
        }

        return res.status(403).json({
          success: false,
          message: `Usage limit reached for ${feature}`,
          details: {
            used: usageCheck.used,
            limit: usageCheck.limit,
            currentPlan: currentPlan.name,
            upgradeMessage
          },
          upgradeRequired: true
        });
      }

      // Add usage info to request for logging
      req.subscriptionUsage = usageCheck;
      req.businessId = businessId;
      
      next();
    } catch (error) {
      console.error('Error checking subscription limit:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to verify subscription limits'
      });
    }
  };
};

/**
 * Middleware to check if a feature is available in current plan
 */
const requireFeature = (feature) => {
  return async (req, res, next) => {
    try {
      // Get business ID
      let businessId = req.body.businessId || req.params.businessId;
      
      if (!businessId && req.user?.email) {
        const user = await firestoreDb.user.findByEmail(req.user.email);
        if (user) {
          const business = await firestoreDb.business.findFirst({ userId: user.id });
          businessId = business?.id;
        }
      }

      if (!businessId) {
        return res.status(400).json({
          success: false,
          message: 'Business not found'
        });
      }

      // Get current subscription
      const subscription = await firestoreDb.subscription.findByBusinessId(businessId);
      const planId = subscription?.plan || 'free';
      const plan = subscriptionService.getPlan(planId);

      // Check if feature is available
      if (!plan.features[feature]) {
        return res.status(403).json({
          success: false,
          message: `Feature '${feature}' is not available in your current plan`,
          currentPlan: plan.name,
          upgradeRequired: true
        });
      }

      req.businessId = businessId;
      next();
    } catch (error) {
      console.error('Error checking feature availability:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to verify feature availability'
      });
    }
  };
};

/**
 * Middleware to check if user has a paid subscription
 */
const requirePaidPlan = async (req, res, next) => {
  try {
    let businessId = req.body.businessId || req.params.businessId;
    
    if (!businessId && req.user?.email) {
      const user = await firestoreDb.user.findByEmail(req.user.email);
      if (user) {
        const business = await firestoreDb.business.findFirst({ userId: user.id });
        businessId = business?.id;
      }
    }

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: 'Business not found'
      });
    }

    const subscription = await firestoreDb.subscription.findByBusinessId(businessId);
    const planId = subscription?.plan || 'free';
    
    if (planId === 'free') {
      return res.status(403).json({
        success: false,
        message: 'This feature requires a paid subscription',
        upgradeRequired: true
      });
    }

    req.businessId = businessId;
    next();
  } catch (error) {
    console.error('Error checking paid plan:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify subscription status'
    });
  }
};

/**
 * Record successful usage of a feature
 */
const recordUsage = async (businessId, featureType, metadata = {}) => {
  try {
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    // Create a usage record in Firestore
    await firestoreDb.subscriptionUsage.create({
      businessId,
      month: thisMonth,
      featureType,
      count: 1,
      lastUsedAt: new Date(),
      metadata: JSON.stringify(metadata)
    });
  } catch (error) {
    console.error('Error recording usage:', error);
    // Don't throw error to avoid breaking the main flow
  }
};

module.exports = {
  checkSubscriptionLimit,
  requireFeature,
  requirePaidPlan,
  recordUsage
};
