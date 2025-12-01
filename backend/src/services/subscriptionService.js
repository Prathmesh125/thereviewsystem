const firestoreDb = require('./firestoreService');

class SubscriptionService {
  constructor() {
    this.plans = {
      FREE: {
        id: 'free',
        name: 'Free',
        price: 0,
        priceINR: 0,
        features: {
          aiEnhancementsPerMonth: 5,
          reviewsPerMonth: 10,
          customFormFields: 3,
          basicAnalytics: true,
          emailSupport: false,
          customBranding: false,
          advancedAnalytics: false,
          prioritySupport: false,
          apiAccess: false,
          whiteLabel: false,
          multipleLocations: 1
        }
      },
      STARTER: {
        id: 'starter',
        name: 'Starter',
        price: 19,
        priceINR: 1577,
        monthlyPriceINR: 1577,
        yearlyPriceINR: 15770,
        features: {
          aiEnhancementsPerMonth: 100,
          reviewsPerMonth: 500,
          customFormFields: 10,
          basicAnalytics: true,
          emailSupport: true,
          customBranding: false,
          advancedAnalytics: false,
          prioritySupport: false,
          apiAccess: false,
          whiteLabel: false,
          multipleLocations: 3
        }
      },
      PROFESSIONAL: {
        id: 'professional',
        name: 'Professional',
        price: 49,
        priceINR: 4067,
        monthlyPriceINR: 4067,
        yearlyPriceINR: 40670,
        features: {
          aiEnhancementsPerMonth: 500,
          reviewsPerMonth: -1,
          customFormFields: -1,
          basicAnalytics: true,
          emailSupport: true,
          customBranding: true,
          advancedAnalytics: true,
          prioritySupport: true,
          apiAccess: true,
          whiteLabel: false,
          multipleLocations: 10
        }
      },
      ENTERPRISE: {
        id: 'enterprise',
        name: 'Enterprise',
        price: 199,
        priceINR: 16517,
        monthlyPriceINR: 16517,
        yearlyPriceINR: 165170,
        features: {
          aiEnhancementsPerMonth: -1, // Unlimited
          reviewsPerMonth: -1, // Unlimited
          customFormFields: -1, // Unlimited
          basicAnalytics: true,
          emailSupport: true,
          customBranding: true,
          advancedAnalytics: true,
          prioritySupport: true,
          apiAccess: true,
          whiteLabel: true,
          multipleLocations: -1 // Unlimited
        }
      }
    };
  }

  /**
   * Get subscription plan details
   */
  getPlan(planId) {
    const upperPlanId = planId.toUpperCase();
    return this.plans[upperPlanId] || this.plans.FREE;
  }

  /**
   * Get plan pricing based on billing cycle
   */
  getPlanPricing(planId, billingCycle = 'monthly') {
    const plan = this.getPlan(planId);
    if (planId.toUpperCase() === 'FREE') {
      return { price: 0, priceINR: 0, billingCycle: 'free' };
    }
    
    if (billingCycle === 'yearly') {
      return {
        price: plan.price * 10, // 10 months price (2 months free)
        priceINR: plan.yearlyPriceINR,
        billingCycle: 'yearly'
      };
    }
    
    return {
      price: plan.price,
      priceINR: plan.monthlyPriceINR,
      billingCycle: 'monthly'
    };
  }

  /**
   * Get all available plans
   */
  getAllPlans() {
    return Object.values(this.plans);
  }

  /**
   * Check if user can perform an action based on their subscription
   */
  async checkUsageLimit(businessId, feature) {
    try {
      // Get business subscription
      const subscription = await firestoreDb.subscription.findByBusinessId(businessId);

      if (!subscription) {
        // No subscription, use free plan limits
        return this.checkFeatureLimit('FREE', feature, businessId);
      }

      return this.checkFeatureLimit(subscription.plan || 'FREE', feature, businessId);
      
    } catch (error) {
      console.error('Error checking usage limit:', error);
      return { allowed: false, message: 'Unable to verify subscription' };
    }
  }

  /**
   * Check specific feature limit
   */
  async checkFeatureLimit(planId, feature, businessId) {
    const plan = this.getPlan(planId);
    const limit = plan.features[feature];

    // If unlimited (-1), allow
    if (limit === -1) {
      return { allowed: true, limit: 'unlimited', used: 0 };
    }

    // If feature is boolean, return the boolean value
    if (typeof limit === 'boolean') {
      return { allowed: limit, limit, used: 0 };
    }

    // For numeric limits, check current usage
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    let used = 0;

    try {
      switch (feature) {
        case 'aiEnhancementsPerMonth':
          const aiGenerations = await firestoreDb.aiGeneration.findMany({
            where: {
              businessId,
              createdAt: { gte: startOfMonth }
            }
          });
          used = aiGenerations.length;
          break;

        case 'reviewsPerMonth':
          const reviews = await firestoreDb.review.findMany({
            where: {
              businessId,
              createdAt: { gte: startOfMonth }
            }
          });
          used = reviews.length;
          break;

        default:
          // For other features, assume no current usage tracking needed
          used = 0;
      }
    } catch (error) {
      console.error('Error checking current usage:', error);
      used = 0;
    }

    return {
      allowed: used < limit,
      limit,
      used,
      remaining: Math.max(0, limit - used)
    };
  }

  /**
   * Create or update subscription
   */
  async createSubscription(businessId, planId, paymentIntentId = null) {
    try {
      const plan = this.getPlan(planId);
      const business = await firestoreDb.business.findById(businessId);

      if (!business) {
        throw new Error('Business not found');
      }

      // Check if subscription already exists
      const existingSubscription = await firestoreDb.subscription.findByBusinessId(businessId);

      const subscriptionData = {
        businessId,
        plan: plan.id.toUpperCase(),
        planName: plan.name,
        price: plan.price,
        status: plan.price === 0 ? 'active' : 'pending', // Free plan is immediately active
        paymentIntentId,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        features: JSON.stringify(plan.features)
      };

      let subscription;
      if (existingSubscription) {
        // Update existing subscription
        subscription = await firestoreDb.subscription.update(
          { id: existingSubscription.id },
          subscriptionData
        );
      } else {
        // Create new subscription
        subscription = await firestoreDb.subscription.create(subscriptionData);
      }

      return subscription;
    } catch (error) {
      console.error('Error creating subscription:', error);
      throw error;
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(businessId) {
    try {
      const subscription = await firestoreDb.subscription.findByBusinessId(businessId);

      if (!subscription) {
        throw new Error('No active subscription found');
      }

      // Update subscription to cancelled, but keep it active until end date
      const updatedSubscription = await firestoreDb.subscription.update(
        { id: subscription.id },
        {
          status: 'cancelled',
          cancelledAt: new Date()
        }
      );

      return updatedSubscription;
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      throw error;
    }
  }

  /**
   * Get subscription analytics for business owner
   */
  async getSubscriptionAnalytics(businessId) {
    try {
      const business = await firestoreDb.business.findById(businessId);

      if (!business) {
        throw new Error('Business not found');
      }

      const subscription = await firestoreDb.subscription.findByBusinessId(businessId);
      const currentPlan = subscription ? 
        this.getPlan(subscription.plan) : 
        this.plans.FREE;

      // Get current month usage
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      
      const [aiGenerations, reviews] = await Promise.all([
        firestoreDb.aiGeneration.findMany({
          where: {
            businessId,
            createdAt: { gte: startOfMonth }
          }
        }),
        firestoreDb.review.findMany({
          where: {
            businessId,
            createdAt: { gte: startOfMonth }
          }
        })
      ]);

      const aiEnhancements = aiGenerations.length;
      const reviewsCount = reviews.length;

      return {
        subscription,
        currentPlan,
        usage: {
          aiEnhancements: {
            used: aiEnhancements,
            limit: currentPlan.features.aiEnhancementsPerMonth,
            percentage: currentPlan.features.aiEnhancementsPerMonth === -1 ? 0 : 
              Math.round((aiEnhancements / currentPlan.features.aiEnhancementsPerMonth) * 100)
          },
          reviews: {
            used: reviewsCount,
            limit: currentPlan.features.reviewsPerMonth,
            percentage: currentPlan.features.reviewsPerMonth === -1 ? 0 : 
              Math.round((reviewsCount / currentPlan.features.reviewsPerMonth) * 100)
          }
        }
      };
    } catch (error) {
      console.error('Error getting subscription analytics:', error);
      throw error;
    }
  }

  /**
   * Check if subscription is expired and handle accordingly
   */
  async checkAndUpdateExpiredSubscriptions() {
    try {
      const now = new Date();
      
      // Find all subscriptions
      const allSubscriptions = await firestoreDb.subscription.findAll();

      let expiredCount = 0;
      for (const subscription of allSubscriptions) {
        if (subscription.currentPeriodEnd < now && 
            ['active', 'cancelled'].includes(subscription.status)) {
          await firestoreDb.subscription.update(
            { id: subscription.id },
            { status: 'expired' }
          );
          expiredCount++;
        }
      }

      return expiredCount;
    } catch (error) {
      console.error('Error checking expired subscriptions:', error);
      return 0;
    }
  }
}

module.exports = new SubscriptionService();
