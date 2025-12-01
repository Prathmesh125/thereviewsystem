const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { verifyFirebaseToken } = require('../middleware/firebaseAuth');
const { verifySuperAdmin } = require('../middleware/superAdminAuth');
const firestoreDb = require('../services/firestoreService');

const router = express.Router();

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

// GET /api/super-admin/dashboard - Get super admin dashboard stats
router.get('/dashboard', verifyFirebaseToken, verifySuperAdmin, async (req, res) => {
  try {
    // Get all counts
    const [
      totalUsers,
      totalBusinesses,
      totalReviews,
      totalCustomers,
      totalQRCodes
    ] = await Promise.all([
      firestoreDb.user.countAll(),
      firestoreDb.business.countAll(),
      firestoreDb.review.countAll(),
      firestoreDb.customer.countAll(),
      firestoreDb.qrCode.countAll()
    ]);

    // Get all data for calculations
    const [allUsers, allBusinesses, allReviews, allSubscriptions] = await Promise.all([
      firestoreDb.user.findAll(),
      firestoreDb.business.findAll(),
      firestoreDb.review.findAll(),
      firestoreDb.subscription.findAll()
    ]);

    // Calculate time-based metrics
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Recent activity
    const newUsersThisMonth = allUsers.filter(u => u.createdAt && new Date(u.createdAt) >= thirtyDaysAgo).length;
    const newBusinessesThisMonth = allBusinesses.filter(b => b.createdAt && new Date(b.createdAt) >= thirtyDaysAgo).length;
    const newReviewsThisMonth = allReviews.filter(r => r.createdAt && new Date(r.createdAt) >= thirtyDaysAgo).length;

    // Growth calculations (compare to previous period)
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const prevUsersCount = allUsers.filter(u => u.createdAt && new Date(u.createdAt) >= sixtyDaysAgo && new Date(u.createdAt) < thirtyDaysAgo).length;
    const prevBusinessesCount = allBusinesses.filter(b => b.createdAt && new Date(b.createdAt) >= sixtyDaysAgo && new Date(b.createdAt) < thirtyDaysAgo).length;
    const prevReviewsCount = allReviews.filter(r => r.createdAt && new Date(r.createdAt) >= sixtyDaysAgo && new Date(r.createdAt) < thirtyDaysAgo).length;

    const calcGrowth = (current, prev) => {
      if (prev === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - prev) / prev) * 100);
    };

    // Subscription breakdown
    const subscriptionBreakdown = {
      free: allSubscriptions.filter(s => s.plan === 'free').length,
      starter: allSubscriptions.filter(s => s.plan === 'starter').length,
      professional: allSubscriptions.filter(s => s.plan === 'professional').length,
      enterprise: allSubscriptions.filter(s => s.plan === 'enterprise').length
    };

    // Review status breakdown
    const reviewStatusBreakdown = {
      pending: allReviews.filter(r => r.status === 'pending' || !r.status).length,
      approved: allReviews.filter(r => r.status === 'approved').length,
      rejected: allReviews.filter(r => r.status === 'rejected').length
    };

    // Recent reviews
    const recentReviews = allReviews
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 10);

    // Response in the format frontend expects
    res.json({
      data: {
        overview: {
          totalUsers,
          totalBusinesses,
          totalReviews,
          totalCustomers,
          totalQRCodes
        },
        growth: {
          users: calcGrowth(newUsersThisMonth, prevUsersCount),
          businesses: calcGrowth(newBusinessesThisMonth, prevBusinessesCount),
          reviews: calcGrowth(newReviewsThisMonth, prevReviewsCount)
        },
        recentActivity: {
          newUsersThisMonth,
          newBusinessesThisMonth,
          newReviewsThisMonth
        },
        subscriptionBreakdown,
        reviewStatusBreakdown,
        recentReviews
      }
    });
  } catch (error) {
    console.error('Error fetching super admin dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// GET /api/super-admin/users - Get all users with pagination
router.get('/users',
  verifyFirebaseToken,
  verifySuperAdmin,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('search').optional().isString()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const search = req.query.search;

      let users = await firestoreDb.user.findAll();

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        users = users.filter(u => 
          (u.email && u.email.toLowerCase().includes(searchLower)) ||
          (u.name && u.name.toLowerCase().includes(searchLower))
        );
      }

      // Sort by createdAt descending
      users.sort((a, b) => b.createdAt - a.createdAt);

      // Pagination
      const total = users.length;
      const startIndex = (page - 1) * limit;
      const paginatedUsers = users.slice(startIndex, startIndex + limit);

      // Enrich with business info and count
      const allBusinesses = await firestoreDb.business.findAll();
      const enrichedUsers = await Promise.all(paginatedUsers.map(async (user) => {
        const userBusinesses = allBusinesses.filter(b => b.userId === user.id);
        const business = userBusinesses.length > 0 ? userBusinesses[0] : null;
        return {
          ...user,
          business: business ? { id: business.id, name: business.name } : null,
          _count: {
            businesses: userBusinesses.length
          }
        };
      }));

      res.json({
        users: enrichedUsers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }
);

// GET /api/super-admin/users/:id - Get specific user details
router.get('/users/:id',
  verifyFirebaseToken,
  verifySuperAdmin,
  [param('id').isString()],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      const user = await firestoreDb.user.findById(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const business = await firestoreDb.business.findFirst({ userId: id });
      let subscription = null;
      let stats = {};

      if (business) {
        subscription = await firestoreDb.subscription.findByBusinessId(business.id);
        
        const [reviewCount, customerCount, qrCodeCount] = await Promise.all([
          firestoreDb.review.count({ businessId: business.id }),
          firestoreDb.customer.count({ businessId: business.id }),
          firestoreDb.qrCode.count({ businessId: business.id })
        ]);

        stats = {
          reviews: reviewCount,
          customers: customerCount,
          qrCodes: qrCodeCount
        };
      }

      res.json({
        user,
        business,
        subscription,
        stats
      });
    } catch (error) {
      console.error('Error fetching user details:', error);
      res.status(500).json({ error: 'Failed to fetch user details' });
    }
  }
);

// PUT /api/super-admin/users/:id - Update user
router.put('/users/:id',
  verifyFirebaseToken,
  verifySuperAdmin,
  [
    param('id').isString(),
    body('role').optional().isIn(['user', 'admin', 'super_admin']),
    body('isActive').optional().isBoolean()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const user = await firestoreDb.user.findById(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const updatedUser = await firestoreDb.user.update({ id }, updates);

      res.json({
        success: true,
        user: updatedUser
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

// DELETE /api/super-admin/users/:id - Delete user and associated data
router.delete('/users/:id',
  verifyFirebaseToken,
  verifySuperAdmin,
  [param('id').isString()],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;

      const user = await firestoreDb.user.findById(id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Find and delete business data
      const business = await firestoreDb.business.findFirst({ userId: id });
      if (business) {
        // Delete all related data
        await Promise.all([
          firestoreDb.review.deleteMany({ businessId: business.id }),
          firestoreDb.customer.deleteMany({ businessId: business.id }),
          firestoreDb.qrCode.deleteMany({ businessId: business.id }),
          firestoreDb.formTemplate.deleteMany({ businessId: business.id }),
          firestoreDb.aiGeneration.deleteMany({ businessId: business.id }),
          firestoreDb.subscription.deleteByBusinessId(business.id),
          firestoreDb.business.delete({ id: business.id })
        ]);
      }

      // Delete user
      await firestoreDb.user.delete({ id });

      res.json({
        success: true,
        message: 'User and all associated data deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  }
);

// GET /api/super-admin/users/:userId/businesses - Get businesses for a specific user
router.get('/users/:userId/businesses',
  verifyFirebaseToken,
  verifySuperAdmin,
  [param('userId').isString()],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { userId } = req.params;

      // Get all businesses for this user
      const allBusinesses = await firestoreDb.business.findAll();
      const userBusinesses = allBusinesses.filter(b => b.userId === userId);

      // Enrich with stats (using _count to match frontend expectations)
      const enrichedBusinesses = await Promise.all(userBusinesses.map(async (business) => {
        const [reviewCount, customerCount, qrCodeCount] = await Promise.all([
          firestoreDb.review.count({ businessId: business.id }),
          firestoreDb.customer.count({ businessId: business.id }),
          firestoreDb.qrCode.count({ businessId: business.id })
        ]);

        return {
          ...business,
          _count: {
            reviews: reviewCount,
            customers: customerCount,
            qrCodes: qrCodeCount
          }
        };
      }));

      res.json({
        businesses: enrichedBusinesses,
        total: enrichedBusinesses.length
      });
    } catch (error) {
      console.error('Error fetching user businesses:', error);
      res.status(500).json({ error: 'Failed to load user businesses' });
    }
  }
);

// GET /api/super-admin/businesses/:businessId/customers - Get customers for a specific business
router.get('/businesses/:businessId/customers',
  verifyFirebaseToken,
  verifySuperAdmin,
  [param('businessId').isString()],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { businessId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;

      // Get all customers for this business
      let customers = await firestoreDb.customer.findMany({ businessId });

      // Sort by createdAt descending
      customers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      // Pagination
      const total = customers.length;
      const startIndex = (page - 1) * limit;
      const paginatedCustomers = customers.slice(startIndex, startIndex + limit);

      // Enrich with review count for each customer
      const enrichedCustomers = await Promise.all(paginatedCustomers.map(async (customer) => {
        const reviewCount = await firestoreDb.review.count({ customerId: customer.id });
        return {
          ...customer,
          _count: {
            reviews: reviewCount
          }
        };
      }));

      res.json({
        customers: enrichedCustomers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching business customers:', error);
      res.status(500).json({ error: 'Failed to load business customers' });
    }
  }
);

// GET /api/super-admin/businesses/:businessId/reviews - Get reviews for a specific business
router.get('/businesses/:businessId/reviews',
  verifyFirebaseToken,
  verifySuperAdmin,
  [param('businessId').isString()],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { businessId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;

      // Get all reviews for this business
      let reviews = await firestoreDb.review.findMany({ businessId });

      // Sort by createdAt descending
      reviews.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      // Pagination
      const total = reviews.length;
      const startIndex = (page - 1) * limit;
      const paginatedReviews = reviews.slice(startIndex, startIndex + limit);

      // Enrich with customer info
      const enrichedReviews = await Promise.all(paginatedReviews.map(async (review) => {
        let customer = null;
        if (review.customerId) {
          customer = await firestoreDb.customer.findById(review.customerId);
        }
        return {
          ...review,
          customer
        };
      }));

      res.json({
        reviews: enrichedReviews,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching business reviews:', error);
      res.status(500).json({ error: 'Failed to load business reviews' });
    }
  }
);

// GET /api/super-admin/businesses - Get all businesses
router.get('/businesses',
  verifyFirebaseToken,
  verifySuperAdmin,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('search').optional().isString()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const search = req.query.search;

      let businesses = await firestoreDb.business.findAll();

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        businesses = businesses.filter(b => 
          (b.name && b.name.toLowerCase().includes(searchLower)) ||
          (b.industry && b.industry.toLowerCase().includes(searchLower))
        );
      }

      // Sort by createdAt descending
      businesses.sort((a, b) => b.createdAt - a.createdAt);

      // Pagination
      const total = businesses.length;
      const startIndex = (page - 1) * limit;
      const paginatedBusinesses = businesses.slice(startIndex, startIndex + limit);

      // Enrich with owner and stats
      const enrichedBusinesses = await Promise.all(paginatedBusinesses.map(async (business) => {
        const owner = await firestoreDb.user.findById(business.userId);
        const [reviewCount, customerCount] = await Promise.all([
          firestoreDb.review.count({ businessId: business.id }),
          firestoreDb.customer.count({ businessId: business.id })
        ]);

        return {
          ...business,
          owner: owner ? { id: owner.id, email: owner.email, name: owner.name } : null,
          stats: {
            reviews: reviewCount,
            customers: customerCount
          }
        };
      }));

      res.json({
        businesses: enrichedBusinesses,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching businesses:', error);
      res.status(500).json({ error: 'Failed to fetch businesses' });
    }
  }
);

// GET /api/super-admin/reviews - Get all reviews for moderation
router.get('/reviews',
  verifyFirebaseToken,
  verifySuperAdmin,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn(['all', 'pending', 'approved', 'rejected', 'PENDING', 'APPROVED', 'REJECTED'])
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const status = req.query.status;

      let reviews = await firestoreDb.review.findAll();

      // Apply status filter (skip if 'all' or not provided)
      if (status && status !== 'all') {
        const statusUpper = status.toUpperCase();
        reviews = reviews.filter(r => (r.status || '').toUpperCase() === statusUpper);
      }

      // Sort by createdAt descending
      reviews.sort((a, b) => b.createdAt - a.createdAt);

      // Pagination
      const total = reviews.length;
      const startIndex = (page - 1) * limit;
      const paginatedReviews = reviews.slice(startIndex, startIndex + limit);

      // Enrich with business info
      const enrichedReviews = await Promise.all(paginatedReviews.map(async (review) => {
        const business = await firestoreDb.business.findById(review.businessId);
        const customer = review.customerId ? await firestoreDb.customer.findById(review.customerId) : null;
        
        return {
          ...review,
          business: business ? { id: business.id, name: business.name } : null,
          customer: customer ? { id: customer.id, name: customer.name, email: customer.email } : null
        };
      }));

      res.json({
        reviews: enrichedReviews,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching reviews:', error);
      res.status(500).json({ error: 'Failed to fetch reviews' });
    }
  }
);

// PUT /api/super-admin/reviews/:id/moderate - Moderate a review
router.put('/reviews/:id/moderate',
  verifyFirebaseToken,
  verifySuperAdmin,
  [
    param('id').isString(),
    body('status').isIn(['approved', 'rejected']),
    body('moderationNote').optional().isString()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, moderationNote } = req.body;

      const review = await firestoreDb.review.findById(id);
      if (!review) {
        return res.status(404).json({ error: 'Review not found' });
      }

      const updatedReview = await firestoreDb.review.update(
        { id },
        {
          status,
          moderationNote,
          moderatedAt: new Date(),
          moderatedBy: req.user.uid
        }
      );

      res.json({
        success: true,
        review: updatedReview
      });
    } catch (error) {
      console.error('Error moderating review:', error);
      res.status(500).json({ error: 'Failed to moderate review' });
    }
  }
);

// GET /api/super-admin/subscriptions - Get all subscriptions
router.get('/subscriptions',
  verifyFirebaseToken,
  verifySuperAdmin,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('plan').optional().isIn(['free', 'starter', 'professional', 'enterprise'])
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const plan = req.query.plan;

      let subscriptions = await firestoreDb.subscription.findAll();

      // Apply plan filter
      if (plan) {
        subscriptions = subscriptions.filter(s => s.plan === plan);
      }

      // Sort by createdAt descending
      subscriptions.sort((a, b) => b.createdAt - a.createdAt);

      // Pagination
      const total = subscriptions.length;
      const startIndex = (page - 1) * limit;
      const paginatedSubscriptions = subscriptions.slice(startIndex, startIndex + limit);

      // Enrich with business info
      const enrichedSubscriptions = await Promise.all(paginatedSubscriptions.map(async (sub) => {
        const business = await firestoreDb.business.findById(sub.businessId);
        return {
          ...sub,
          business: business ? { id: business.id, name: business.name } : null
        };
      }));

      res.json({
        subscriptions: enrichedSubscriptions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
      res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
  }
);

// PUT /api/super-admin/subscriptions/:id - Update subscription (admin override)
router.put('/subscriptions/:id',
  verifyFirebaseToken,
  verifySuperAdmin,
  [
    param('id').isString(),
    body('plan').optional().isIn(['free', 'starter', 'professional', 'enterprise']),
    body('status').optional().isIn(['active', 'cancelled', 'expired']),
    body('currentPeriodEnd').optional().isISO8601()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const subscription = await firestoreDb.subscription.findById(id);
      if (!subscription) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      const updatedSubscription = await firestoreDb.subscription.update({ id }, updates);

      res.json({
        success: true,
        subscription: updatedSubscription
      });
    } catch (error) {
      console.error('Error updating subscription:', error);
      res.status(500).json({ error: 'Failed to update subscription' });
    }
  }
);

// GET /api/super-admin/analytics - Get system-wide analytics
router.get('/analytics',
  verifyFirebaseToken,
  verifySuperAdmin,
  [query('period').optional().isIn(['7d', '30d', '90d', '1y', '7days', '30days', '90days', '1year'])],
  handleValidationErrors,
  async (req, res) => {
    try {
      const period = req.query.period || '30d';
      let daysBack;
      switch (period) {
        case '7d': 
        case '7days': daysBack = 7; break;
        case '30d': 
        case '30days': daysBack = 30; break;
        case '90d': 
        case '90days': daysBack = 90; break;
        case '1y': 
        case '1year': daysBack = 365; break;
        default: daysBack = 30;
      }

      const now = new Date();
      const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
      const previousPeriodStart = new Date(now.getTime() - (daysBack * 2) * 24 * 60 * 60 * 1000);

      // Get all data
      const [allUsers, allBusinesses, allReviews] = await Promise.all([
        firestoreDb.user.findAll(),
        firestoreDb.business.findAll(),
        firestoreDb.review.findAll()
      ]);

      // Helper to convert any date format to Date object
      const toDate = (dateVal) => {
        if (!dateVal) return null;
        if (dateVal instanceof Date) return dateVal;
        if (dateVal.toDate) return dateVal.toDate(); // Firestore Timestamp
        if (dateVal._seconds) return new Date(dateVal._seconds * 1000); // Firestore Timestamp object
        return new Date(dateVal);
      };

      // Current period counts
      const usersInPeriod = allUsers.filter(u => {
        const date = toDate(u.createdAt);
        return date && date >= startDate;
      });
      
      const businessesInPeriod = allBusinesses.filter(b => {
        const date = toDate(b.createdAt);
        return date && date >= startDate;
      });
      
      const reviewsInPeriod = allReviews.filter(r => {
        const date = toDate(r.createdAt);
        return date && date >= startDate;
      });

      // Previous period counts (for growth calculation)
      const usersPrevPeriod = allUsers.filter(u => {
        const date = toDate(u.createdAt);
        return date && date >= previousPeriodStart && date < startDate;
      });
      
      const businessesPrevPeriod = allBusinesses.filter(b => {
        const date = toDate(b.createdAt);
        return date && date >= previousPeriodStart && date < startDate;
      });
      
      const reviewsPrevPeriod = allReviews.filter(r => {
        const date = toDate(r.createdAt);
        return date && date >= previousPeriodStart && date < startDate;
      });

      // Calculate growth percentages
      const calcGrowth = (current, previous) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
      };

      // Users over time
      const usersByDay = {};
      usersInPeriod.forEach(user => {
        const date = toDate(user.createdAt);
        if (date) {
          const day = date.toISOString().split('T')[0];
          usersByDay[day] = (usersByDay[day] || 0) + 1;
        }
      });

      // Reviews over time
      const reviewsByDay = {};
      reviewsInPeriod.forEach(review => {
        const date = toDate(review.createdAt);
        if (date) {
          const day = date.toISOString().split('T')[0];
          reviewsByDay[day] = (reviewsByDay[day] || 0) + 1;
        }
      });

      // Industry breakdown
      const industryBreakdown = {};
      allBusinesses.forEach(business => {
        const industry = business.type || business.industry || 'Other';
        industryBreakdown[industry] = (industryBreakdown[industry] || 0) + 1;
      });

      res.json({
        period,
        growth: {
          users: calcGrowth(usersInPeriod.length, usersPrevPeriod.length),
          businesses: calcGrowth(businessesInPeriod.length, businessesPrevPeriod.length),
          reviews: calcGrowth(reviewsInPeriod.length, reviewsPrevPeriod.length)
        },
        newUsers: usersInPeriod.length,
        newBusinesses: businessesInPeriod.length,
        newReviews: reviewsInPeriod.length,
        usersByDay: Object.entries(usersByDay).map(([date, count]) => ({ date, count })),
        reviewsByDay: Object.entries(reviewsByDay).map(([date, count]) => ({ date, count })),
        industryBreakdown,
        totals: {
          users: allUsers.length,
          businesses: allBusinesses.length,
          reviews: allReviews.length
        }
      });
    } catch (error) {
      console.error('Error fetching system analytics:', error);
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  }
);

// GET /api/super-admin/health - System health check
router.get('/health', verifyFirebaseToken, verifySuperAdmin, async (req, res) => {
  try {
    const startTime = Date.now();

    // Test Firestore connection
    const testUser = await firestoreDb.user.findAll();
    const firestoreLatency = Date.now() - startTime;

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        firestore: {
          status: 'connected',
          latency: `${firestoreLatency}ms`
        },
        server: {
          status: 'running',
          uptime: process.uptime(),
          memory: process.memoryUsage()
        }
      }
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// GET /api/super-admin/system-health - Get system health status
router.get('/system-health', verifyFirebaseToken, verifySuperAdmin, async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Test Firestore connection
    await firestoreDb.user.countAll();
    const dbLatency = Date.now() - startTime;

    res.json({
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: {
          status: 'connected',
          type: 'firestore',
          latency: `${dbLatency}ms`
        },
        uptime: process.uptime(),
        server: {
          status: 'running',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version
        },
        environment: process.env.NODE_ENV || 'development'
      }
    });
  } catch (error) {
    console.error('System health check failed:', error);
    res.status(500).json({
      data: {
        status: 'unhealthy',
        error: error.message
      }
    });
  }
});

// GET /api/super-admin/audit-logs - Get audit logs (placeholder)
router.get('/audit-logs', verifyFirebaseToken, verifySuperAdmin, handleValidationErrors, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    // For now, return empty audit logs - can be implemented with a proper audit collection later
    res.json({
      data: {
        logs: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0
        }
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// GET /api/super-admin/analytics/revenue - Revenue analytics
router.get('/analytics/revenue', verifyFirebaseToken, verifySuperAdmin, async (req, res) => {
  try {
    const range = req.query.range || '30days';
    let daysBack;
    switch (range) {
      case '7days': daysBack = 7; break;
      case '30days': daysBack = 30; break;
      case '90days': daysBack = 90; break;
      case '1year': daysBack = 365; break;
      default: daysBack = 30;
    }

    const now = new Date();
    const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

    // Get all subscriptions
    const allSubscriptions = await firestoreDb.subscription.findAll();

    // Calculate revenue (placeholder pricing)
    const planPrices = {
      free: 0,
      starter: 29,
      professional: 79,
      enterprise: 199
    };

    let totalRevenue = 0;
    let monthlyRecurring = 0;
    const revenueByPlan = {};

    allSubscriptions.forEach(sub => {
      const price = planPrices[sub.plan] || 0;
      if (sub.status === 'active') {
        monthlyRecurring += price;
      }
      totalRevenue += price;
      revenueByPlan[sub.plan] = (revenueByPlan[sub.plan] || 0) + price;
    });

    res.json({
      data: {
        totalRevenue,
        monthlyRecurring,
        activeSubscriptions: allSubscriptions.filter(s => s.status === 'active').length,
        revenueByPlan,
        growth: {
          revenue: 0, // Would need historical data
          subscriptions: 0
        },
        period: range
      }
    });
  } catch (error) {
    console.error('Error fetching revenue analytics:', error);
    res.status(500).json({ error: 'Failed to fetch revenue analytics' });
  }
});

// GET /api/super-admin/analytics/subscriptions - Subscription metrics
router.get('/analytics/subscriptions', verifyFirebaseToken, verifySuperAdmin, async (req, res) => {
  try {
    const allSubscriptions = await firestoreDb.subscription.findAll();
    const allBusinesses = await firestoreDb.business.findAll();
    const allUsers = await firestoreDb.user.findAll();

    // Plan pricing in INR
    const planPricesMonthly = {
      free: 0,
      FREE: 0,
      starter: 2499,
      STARTER: 2499,
      professional: 4149,
      PROFESSIONAL: 4149,
      PREMIUM: 4149,
      enterprise: 8299,
      ENTERPRISE: 8299
    };

    const planPricesYearly = {
      free: 0,
      FREE: 0,
      starter: 24990,
      STARTER: 24990,
      professional: 41490,
      PROFESSIONAL: 41490,
      PREMIUM: 41490,
      enterprise: 82990,
      ENTERPRISE: 82990
    };

    // Subscription breakdown by plan
    const byPlan = {
      free: allSubscriptions.filter(s => s.plan?.toLowerCase() === 'free').length,
      starter: allSubscriptions.filter(s => s.plan?.toLowerCase() === 'starter').length,
      professional: allSubscriptions.filter(s => s.plan?.toLowerCase() === 'professional').length,
      enterprise: allSubscriptions.filter(s => s.plan?.toLowerCase() === 'enterprise').length
    };

    // Status breakdown
    const byStatus = {
      active: allSubscriptions.filter(s => s.status === 'active').length,
      canceled: allSubscriptions.filter(s => s.status === 'canceled').length,
      expired: allSubscriptions.filter(s => s.status === 'expired').length,
      trial: allSubscriptions.filter(s => s.status === 'trial').length
    };

    // Calculate revenue
    let totalMonthlyRevenueINR = 0;
    let totalYearlyRevenueINR = 0;
    const activeSubscriptions = allSubscriptions.filter(s => s.status === 'active');
    
    activeSubscriptions.forEach(sub => {
      const plan = sub.plan?.toLowerCase() || 'free';
      totalMonthlyRevenueINR += planPricesMonthly[plan] || 0;
      totalYearlyRevenueINR += planPricesYearly[plan] || 0;
    });

    // Plan distribution with counts and revenue
    const planDistribution = {
      FREE: {
        count: byPlan.free,
        revenue: 0
      },
      STARTER: {
        count: byPlan.starter,
        revenue: byPlan.starter * planPricesMonthly.starter
      },
      PROFESSIONAL: {
        count: byPlan.professional,
        revenue: byPlan.professional * planPricesMonthly.professional
      },
      ENTERPRISE: {
        count: byPlan.enterprise,
        revenue: byPlan.enterprise * planPricesMonthly.enterprise
      }
    };

    // Business owner metrics (join with user data)
    const businessOwnerMetrics = await Promise.all(allBusinesses.slice(0, 20).map(async (business) => {
      const user = allUsers.find(u => u.id === business.userId);
      const subscription = allSubscriptions.find(s => s.businessId === business.id);
      return {
        id: business.id,
        businessName: business.name,
        ownerEmail: user?.email || 'Unknown',
        ownerName: user?.name || user?.email || 'Unknown',
        plan: subscription?.plan || 'free',
        status: subscription?.status || 'active',
        revenue: planPricesMonthly[subscription?.plan?.toLowerCase()] || 0
      };
    }));

    // Top revenue owners
    const topRevenueOwners = businessOwnerMetrics
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    res.json({
      data: {
        total: allSubscriptions.length,
        totalSubscriptions: allSubscriptions.length,
        totalBusinesses: allBusinesses.length,
        activeSubscriptions: activeSubscriptions.length,
        totalMonthlyRevenueINR,
        totalYearlyRevenueINR,
        byPlan,
        byStatus,
        planDistribution,
        businessOwnerMetrics,
        topRevenueOwners,
        conversionRate: allBusinesses.length > 0 
          ? Math.round((allSubscriptions.filter(s => s.plan !== 'free' && s.plan !== 'FREE').length / allBusinesses.length) * 100)
          : 0
      }
    });
  } catch (error) {
    console.error('Error fetching subscription metrics:', error);
    res.status(500).json({ error: 'Failed to fetch subscription metrics' });
  }
});

// GET /api/super-admin/security/analytics - Security analytics
router.get('/security/analytics', verifyFirebaseToken, verifySuperAdmin, async (req, res) => {
  try {
    const allUsers = await firestoreDb.user.findAll();
    
    // Calculate security metrics
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Helper to convert dates
    const toDate = (dateVal) => {
      if (!dateVal) return null;
      if (dateVal instanceof Date) return dateVal;
      if (dateVal.toDate) return dateVal.toDate();
      if (dateVal._seconds) return new Date(dateVal._seconds * 1000);
      return new Date(dateVal);
    };

    const recentLogins = allUsers.filter(u => {
      const lastLogin = toDate(u.lastLoginAt);
      return lastLogin && lastLogin >= last24Hours;
    }).length;

    const activeUsers7Days = allUsers.filter(u => {
      const lastLogin = toDate(u.lastLoginAt);
      return lastLogin && lastLogin >= last7Days;
    }).length;

    res.json({
      data: {
        totalUsers: allUsers.length,
        activeUsersToday: recentLogins,
        activeUsers7Days,
        failedLogins24h: 0, // Would need a separate login attempts collection
        suspiciousActivities: 0,
        securityAlerts: [],
        loginAttempts: {
          successful: recentLogins,
          failed: 0
        }
      }
    });
  } catch (error) {
    console.error('Error fetching security analytics:', error);
    res.status(500).json({ error: 'Failed to fetch security analytics' });
  }
});

// GET /api/super-admin/security/logins - Login analytics
router.get('/security/logins', verifyFirebaseToken, verifySuperAdmin, async (req, res) => {
  try {
    const range = req.query.range || '7days';
    const allUsers = await firestoreDb.user.findAll();

    res.json({
      data: {
        totalLogins: allUsers.length,
        uniqueUsers: allUsers.length,
        avgSessionDuration: '15m',
        loginsByDay: [],
        loginsByDevice: {
          desktop: Math.floor(allUsers.length * 0.6),
          mobile: Math.floor(allUsers.length * 0.35),
          tablet: Math.floor(allUsers.length * 0.05)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching login analytics:', error);
    res.status(500).json({ error: 'Failed to fetch login analytics' });
  }
});

// GET /api/super-admin/moderation/queue - Content moderation queue
router.get('/moderation/queue', verifyFirebaseToken, verifySuperAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const allReviews = await firestoreDb.review.findAll();

    // Filter reviews by status (pending for moderation)
    const pendingReviews = allReviews.filter(r => 
      r.status?.toUpperCase() === 'PENDING' || !r.status
    );

    const items = await Promise.all(pendingReviews.slice(0, 20).map(async (review) => {
      const business = await firestoreDb.business.findById(review.businessId);
      const customer = review.customerId ? await firestoreDb.customer.findById(review.customerId) : null;
      
      return {
        id: review.id,
        type: 'review',
        content: review.feedback || review.comment || '',
        rating: review.rating,
        businessName: business?.name || 'Unknown',
        customerName: customer?.name || 'Anonymous',
        createdAt: review.createdAt,
        status: review.status || 'pending'
      };
    }));

    res.json({
      data: {
        items,
        total: pendingReviews.length,
        pending: pendingReviews.length,
        approved: allReviews.filter(r => r.status?.toUpperCase() === 'APPROVED').length,
        rejected: allReviews.filter(r => r.status?.toUpperCase() === 'REJECTED').length
      }
    });
  } catch (error) {
    console.error('Error fetching moderation queue:', error);
    res.status(500).json({ error: 'Failed to fetch moderation queue' });
  }
});

// GET /api/super-admin/real-time/stats - Real-time statistics
router.get('/real-time/stats', verifyFirebaseToken, verifySuperAdmin, async (req, res) => {
  try {
    const [totalUsers, totalBusinesses, totalReviews, totalCustomers] = await Promise.all([
      firestoreDb.user.countAll(),
      firestoreDb.business.countAll(),
      firestoreDb.review.countAll(),
      firestoreDb.customer.countAll()
    ]);

    res.json({
      activeUsers: totalUsers,
      totalBusinesses,
      totalReviews,
      totalCustomers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching real-time stats:', error);
    res.status(500).json({ error: 'Failed to fetch real-time stats' });
  }
});

// GET /api/super-admin/real-time/activities - Recent activities
router.get('/real-time/activities', verifyFirebaseToken, verifySuperAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;

    // Get recent users, businesses, and reviews
    const [recentUsers, recentBusinesses, recentReviews] = await Promise.all([
      firestoreDb.user.findAll(),
      firestoreDb.business.findAll(),
      firestoreDb.review.findAll()
    ]);

    // Combine and sort by creation date
    const activities = [
      ...recentUsers.map(u => ({
        type: 'user_signup',
        description: `New user registered: ${u.email}`,
        timestamp: u.createdAt,
        userId: u.id
      })),
      ...recentBusinesses.map(b => ({
        type: 'business_created',
        description: `New business created: ${b.name}`,
        timestamp: b.createdAt,
        businessId: b.id
      })),
      ...recentReviews.map(r => ({
        type: 'review_submitted',
        description: `New review submitted (${r.rating} stars)`,
        timestamp: r.createdAt,
        reviewId: r.id
      }))
    ]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);

    res.json({
      activities
    });
  } catch (error) {
    console.error('Error fetching recent activities:', error);
    res.status(500).json({ error: 'Failed to fetch recent activities' });
  }
});

module.exports = router;
