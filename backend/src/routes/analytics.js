const express = require('express');
const { query, param, validationResult } = require('express-validator');
const { verifyFirebaseToken } = require('../middleware/firebaseAuth');
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

// Helper to get date ranges
const getDateRange = (period) => {
  const now = new Date();
  let startDate;

  switch (period) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case '1y':
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return { startDate, endDate: now };
};

// GET /api/analytics/overview - Get analytics overview for user's business
router.get('/overview', verifyFirebaseToken, async (req, res) => {
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

    const period = req.query.period || '30d';
    const { startDate, endDate } = getDateRange(period);

    // Get counts
    const [
      totalReviews,
      totalCustomers,
      totalQRCodes,
      totalQRScans
    ] = await Promise.all([
      firestoreDb.review.count({ businessId: business.id }),
      firestoreDb.customer.count({ businessId: business.id }),
      firestoreDb.qrCode.count({ businessId: business.id }),
      firestoreDb.qrScan.countByBusinessId(business.id)
    ]);

    // Get reviews in period
    const periodReviews = await firestoreDb.review.findMany({
      where: {
        businessId: business.id,
        createdAt: { gte: startDate, lte: endDate }
      }
    });

    // Calculate average rating
    const reviewsWithRating = periodReviews.filter(r => r.rating !== null && r.rating !== undefined);
    const averageRating = reviewsWithRating.length > 0
      ? reviewsWithRating.reduce((sum, r) => sum + r.rating, 0) / reviewsWithRating.length
      : 0;

    // Get rating distribution
    const allReviews = await firestoreDb.review.findMany({
      where: { businessId: business.id }
    });
    
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    allReviews.forEach(review => {
      if (review.rating >= 1 && review.rating <= 5) {
        ratingDistribution[Math.round(review.rating)]++;
      }
    });

    // Get recent reviews
    const recentReviews = await firestoreDb.review.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    // Get AI generation stats
    const aiGenerations = await firestoreDb.aiGeneration.count({ businessId: business.id });

    res.json({
      overview: {
        totalReviews,
        totalCustomers,
        totalQRCodes,
        totalQRScans,
        averageRating: Math.round(averageRating * 10) / 10,
        reviewsInPeriod: periodReviews.length,
        aiGenerations
      },
      ratingDistribution,
      recentReviews,
      period
    });
  } catch (error) {
    console.error('Error fetching analytics overview:', error);
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

// GET /api/analytics/reviews - Get review analytics
router.get('/reviews',
  verifyFirebaseToken,
  [
    query('period').optional().isIn(['7d', '30d', '90d', '1y']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601()
  ],
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

      let startDate, endDate;
      if (req.query.startDate && req.query.endDate) {
        startDate = new Date(req.query.startDate);
        endDate = new Date(req.query.endDate);
      } else {
        const range = getDateRange(req.query.period || '30d');
        startDate = range.startDate;
        endDate = range.endDate;
      }

      const reviews = await firestoreDb.review.findMany({
        where: {
          businessId: business.id,
          createdAt: { gte: startDate, lte: endDate }
        },
        orderBy: { createdAt: 'asc' }
      });

      // Group reviews by day
      const reviewsByDay = {};
      reviews.forEach(review => {
        const day = review.createdAt.toISOString().split('T')[0];
        if (!reviewsByDay[day]) {
          reviewsByDay[day] = { count: 0, totalRating: 0, ratings: [] };
        }
        reviewsByDay[day].count++;
        if (review.rating) {
          reviewsByDay[day].totalRating += review.rating;
          reviewsByDay[day].ratings.push(review.rating);
        }
      });

      // Calculate daily averages
      const dailyData = Object.entries(reviewsByDay).map(([date, data]) => ({
        date,
        count: data.count,
        averageRating: data.ratings.length > 0 
          ? Math.round((data.totalRating / data.ratings.length) * 10) / 10 
          : null
      }));

      // Status breakdown
      const statusBreakdown = {
        pending: reviews.filter(r => r.status === 'pending').length,
        approved: reviews.filter(r => r.status === 'approved').length,
        rejected: reviews.filter(r => r.status === 'rejected').length
      };

      // Source breakdown
      const sourceBreakdown = {};
      reviews.forEach(review => {
        const source = review.source || 'direct';
        sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
      });

      res.json({
        totalReviews: reviews.length,
        dailyData,
        statusBreakdown,
        sourceBreakdown,
        period: { startDate, endDate }
      });
    } catch (error) {
      console.error('Error fetching review analytics:', error);
      res.status(500).json({ error: 'Failed to fetch review analytics' });
    }
  }
);

// GET /api/analytics/qr-codes - Get QR code analytics
router.get('/qr-codes',
  verifyFirebaseToken,
  [query('period').optional().isIn(['7d', '30d', '90d', '1y'])],
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

      const { startDate, endDate } = getDateRange(req.query.period || '30d');

      // Get all QR codes for business
      const qrCodes = await firestoreDb.qrCode.findMany({
        where: { businessId: business.id }
      });

      // Get scan data for each QR code
      const qrCodeAnalytics = await Promise.all(qrCodes.map(async (qrCode) => {
        const totalScans = await firestoreDb.qrScan.count({ qrCodeId: qrCode.id });
        const periodScans = await firestoreDb.qrScan.findMany({
          where: {
            qrCodeId: qrCode.id,
            scannedAt: { gte: startDate, lte: endDate }
          }
        });

        return {
          id: qrCode.id,
          title: qrCode.title,
          totalScans,
          scansInPeriod: periodScans.length,
          isActive: qrCode.isActive,
          createdAt: qrCode.createdAt
        };
      }));

      // Get all scans in period grouped by day
      const allScans = await firestoreDb.qrScan.findMany({
        where: {
          scannedAt: { gte: startDate, lte: endDate }
        },
        orderBy: { scannedAt: 'asc' }
      });

      // Filter scans for this business's QR codes
      const qrCodeIds = new Set(qrCodes.map(qr => qr.id));
      const businessScans = allScans.filter(scan => qrCodeIds.has(scan.qrCodeId));

      const scansByDay = {};
      businessScans.forEach(scan => {
        const day = scan.scannedAt.toISOString().split('T')[0];
        scansByDay[day] = (scansByDay[day] || 0) + 1;
      });

      const dailyData = Object.entries(scansByDay).map(([date, count]) => ({
        date,
        scans: count
      }));

      res.json({
        totalQRCodes: qrCodes.length,
        totalScans: businessScans.length,
        qrCodeAnalytics,
        dailyData,
        period: { startDate, endDate }
      });
    } catch (error) {
      console.error('Error fetching QR code analytics:', error);
      res.status(500).json({ error: 'Failed to fetch QR code analytics' });
    }
  }
);

// GET /api/analytics/customers - Get customer analytics
router.get('/customers',
  verifyFirebaseToken,
  [query('period').optional().isIn(['7d', '30d', '90d', '1y'])],
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

      const { startDate, endDate } = getDateRange(req.query.period || '30d');

      // Get all customers
      const allCustomers = await firestoreDb.customer.findMany({
        where: { businessId: business.id }
      });

      // Get customers in period
      const newCustomers = allCustomers.filter(c => 
        c.createdAt >= startDate && c.createdAt <= endDate
      );

      // Group by day
      const customersByDay = {};
      newCustomers.forEach(customer => {
        const day = customer.createdAt.toISOString().split('T')[0];
        customersByDay[day] = (customersByDay[day] || 0) + 1;
      });

      const dailyData = Object.entries(customersByDay).map(([date, count]) => ({
        date,
        newCustomers: count
      }));

      // Get customer reviews count
      const customersWithReviews = await Promise.all(allCustomers.map(async (customer) => {
        const reviewCount = await firestoreDb.review.count({ customerId: customer.id });
        return {
          ...customer,
          reviewCount
        };
      }));

      // Top customers by reviews
      const topCustomers = customersWithReviews
        .sort((a, b) => b.reviewCount - a.reviewCount)
        .slice(0, 10)
        .map(c => ({
          id: c.id,
          name: c.name,
          email: c.email,
          reviewCount: c.reviewCount
        }));

      res.json({
        totalCustomers: allCustomers.length,
        newCustomersInPeriod: newCustomers.length,
        dailyData,
        topCustomers,
        period: { startDate, endDate }
      });
    } catch (error) {
      console.error('Error fetching customer analytics:', error);
      res.status(500).json({ error: 'Failed to fetch customer analytics' });
    }
  }
);

// GET /api/analytics/ai - Get AI usage analytics
router.get('/ai',
  verifyFirebaseToken,
  [query('period').optional().isIn(['7d', '30d', '90d', '1y'])],
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

      const { startDate, endDate } = getDateRange(req.query.period || '30d');

      // Get AI generations
      const allGenerations = await firestoreDb.aiGeneration.findMany({
        where: { businessId: business.id }
      });

      const periodGenerations = allGenerations.filter(g => 
        g.createdAt >= startDate && g.createdAt <= endDate
      );

      // Group by day
      const generationsByDay = {};
      periodGenerations.forEach(gen => {
        const day = gen.createdAt.toISOString().split('T')[0];
        generationsByDay[day] = (generationsByDay[day] || 0) + 1;
      });

      const dailyData = Object.entries(generationsByDay).map(([date, count]) => ({
        date,
        generations: count
      }));

      // Status breakdown
      const statusBreakdown = {
        success: periodGenerations.filter(g => g.status === 'success').length,
        failed: periodGenerations.filter(g => g.status === 'failed').length,
        pending: periodGenerations.filter(g => g.status === 'pending').length
      };

      // Calculate usage stats
      const successGenerations = periodGenerations.filter(g => g.status === 'success');
      const averageTokens = successGenerations.length > 0
        ? Math.round(successGenerations.reduce((sum, g) => sum + (g.tokensUsed || 0), 0) / successGenerations.length)
        : 0;

      res.json({
        totalGenerations: allGenerations.length,
        generationsInPeriod: periodGenerations.length,
        dailyData,
        statusBreakdown,
        averageTokensPerGeneration: averageTokens,
        period: { startDate, endDate }
      });
    } catch (error) {
      console.error('Error fetching AI analytics:', error);
      res.status(500).json({ error: 'Failed to fetch AI analytics' });
    }
  }
);

// GET /api/analytics/export - Export analytics data
router.get('/export',
  verifyFirebaseToken,
  [
    query('type').isIn(['reviews', 'customers', 'qr-codes', 'all']),
    query('format').optional().isIn(['json', 'csv'])
  ],
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

      const { type, format = 'json' } = req.query;
      let data = {};

      if (type === 'reviews' || type === 'all') {
        data.reviews = await firestoreDb.review.findMany({
          where: { businessId: business.id },
          orderBy: { createdAt: 'desc' }
        });
      }

      if (type === 'customers' || type === 'all') {
        data.customers = await firestoreDb.customer.findMany({
          where: { businessId: business.id },
          orderBy: { createdAt: 'desc' }
        });
      }

      if (type === 'qr-codes' || type === 'all') {
        const qrCodes = await firestoreDb.qrCode.findMany({
          where: { businessId: business.id },
          orderBy: { createdAt: 'desc' }
        });
        
        data.qrCodes = await Promise.all(qrCodes.map(async (qr) => {
          const scansCount = await firestoreDb.qrScan.count({ qrCodeId: qr.id });
          return { ...qr, scansCount };
        }));
      }

      if (format === 'csv') {
        // Convert to CSV format
        let csv = '';
        
        if (data.reviews) {
          csv += 'REVIEWS\n';
          csv += 'ID,Rating,Feedback,Status,Source,Created At\n';
          data.reviews.forEach(r => {
            csv += `${r.id},${r.rating || ''},"${(r.feedbackText || '').replace(/"/g, '""')}",${r.status},${r.source || 'direct'},${r.createdAt.toISOString()}\n`;
          });
          csv += '\n';
        }

        if (data.customers) {
          csv += 'CUSTOMERS\n';
          csv += 'ID,Name,Email,Phone,Created At\n';
          data.customers.forEach(c => {
            csv += `${c.id},"${c.name || ''}",${c.email || ''},${c.phone || ''},${c.createdAt.toISOString()}\n`;
          });
          csv += '\n';
        }

        if (data.qrCodes) {
          csv += 'QR CODES\n';
          csv += 'ID,Title,Scans,Active,Created At\n';
          data.qrCodes.forEach(qr => {
            csv += `${qr.id},"${qr.title}",${qr.scansCount},${qr.isActive},${qr.createdAt.toISOString()}\n`;
          });
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="analytics-export-${new Date().toISOString().split('T')[0]}.csv"`);
        return res.send(csv);
      }

      res.json({
        business: {
          id: business.id,
          name: business.name
        },
        exportDate: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      console.error('Error exporting analytics:', error);
      res.status(500).json({ error: 'Failed to export analytics' });
    }
  }
);

// GET /api/analytics/charts - Get data formatted for charts
router.get('/charts',
  verifyFirebaseToken,
  [query('period').optional().isIn(['7d', '30d', '90d', '1y'])],
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

      const { startDate, endDate } = getDateRange(req.query.period || '30d');

      // Get reviews for rating distribution pie chart
      const reviews = await firestoreDb.review.findMany({
        where: { businessId: business.id }
      });

      const ratingDistribution = [
        { name: '5 Stars', value: reviews.filter(r => r.rating === 5).length },
        { name: '4 Stars', value: reviews.filter(r => r.rating === 4).length },
        { name: '3 Stars', value: reviews.filter(r => r.rating === 3).length },
        { name: '2 Stars', value: reviews.filter(r => r.rating === 2).length },
        { name: '1 Star', value: reviews.filter(r => r.rating === 1).length }
      ];

      // Get reviews over time for line chart
      const periodReviews = reviews.filter(r => 
        r.createdAt >= startDate && r.createdAt <= endDate
      );

      const reviewsOverTime = {};
      periodReviews.forEach(review => {
        const day = review.createdAt.toISOString().split('T')[0];
        if (!reviewsOverTime[day]) {
          reviewsOverTime[day] = { reviews: 0, avgRating: 0, ratings: [] };
        }
        reviewsOverTime[day].reviews++;
        if (review.rating) {
          reviewsOverTime[day].ratings.push(review.rating);
        }
      });

      const reviewsLineData = Object.entries(reviewsOverTime).map(([date, data]) => ({
        date,
        reviews: data.reviews,
        avgRating: data.ratings.length > 0 
          ? Math.round((data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length) * 10) / 10
          : null
      })).sort((a, b) => new Date(a.date) - new Date(b.date));

      // Get QR scans for bar chart
      const qrCodes = await firestoreDb.qrCode.findMany({
        where: { businessId: business.id }
      });

      const qrScansData = await Promise.all(qrCodes.slice(0, 10).map(async (qr) => {
        const scans = await firestoreDb.qrScan.count({ qrCodeId: qr.id });
        return {
          name: qr.title.substring(0, 20),
          scans
        };
      }));

      res.json({
        ratingDistribution,
        reviewsOverTime: reviewsLineData,
        qrScansComparison: qrScansData.sort((a, b) => b.scans - a.scans),
        period: { startDate, endDate }
      });
    } catch (error) {
      console.error('Error fetching chart data:', error);
      res.status(500).json({ error: 'Failed to fetch chart data' });
    }
  }
);

// POST /api/analytics/create-demo-business - Create a demo business with sample data
router.post('/create-demo-business', verifyFirebaseToken, async (req, res) => {
  try {
    // Find user
    const user = await firestoreDb.user.findByEmail(req.user.email);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Create demo business
    const demoBusiness = await firestoreDb.business.create({
      name: 'Demo Coffee Shop',
      description: 'A cozy demo coffee shop to explore the review system features. This business comes with sample reviews and customers.',
      type: 'Restaurant & Cafe',
      userId: user.id,
      brandColor: '#8B4513',
      isPublished: true,
      settings: {
        enableQRCodes: true,
        enableCustomForms: true,
        enableAnalytics: true
      }
    });

    // Create sample customers
    const sampleCustomers = [
      { name: 'John Smith', email: 'john.demo@example.com', phone: '+1234567890' },
      { name: 'Sarah Johnson', email: 'sarah.demo@example.com', phone: '+1234567891' },
      { name: 'Mike Wilson', email: 'mike.demo@example.com', phone: '+1234567892' },
      { name: 'Emily Davis', email: 'emily.demo@example.com', phone: '+1234567893' },
      { name: 'Chris Brown', email: 'chris.demo@example.com', phone: '+1234567894' }
    ];

    const createdCustomers = [];
    for (const customerData of sampleCustomers) {
      const customer = await firestoreDb.customer.create({
        ...customerData,
        businessId: demoBusiness.id
      });
      createdCustomers.push(customer);
    }

    // Create sample reviews with varied dates
    const sampleReviews = [
      { rating: 5, feedback: 'Amazing coffee and wonderful atmosphere! The staff was incredibly friendly and the pastries were fresh. Will definitely come back!', sentiment: 'positive' },
      { rating: 4, feedback: 'Great place for a quick coffee break. The espresso was perfect and prices are reasonable. Seating could be better though.', sentiment: 'positive' },
      { rating: 5, feedback: 'Best latte in town! I love the cozy vibe and the free WiFi is a plus for remote workers like me.', sentiment: 'positive' },
      { rating: 3, feedback: 'Coffee is good but the service was a bit slow today. The place was crowded and had to wait 15 minutes.', sentiment: 'neutral' },
      { rating: 5, feedback: 'Absolutely love this place! The baristas know their craft and the seasonal specials are always a treat.', sentiment: 'positive' },
      { rating: 4, feedback: 'Nice spot for meetings. Good coffee selection and comfortable seating areas. Would recommend!', sentiment: 'positive' },
      { rating: 5, feedback: 'The cappuccino here is perfection! Great ambiance and lovely staff. My new favorite coffee shop.', sentiment: 'positive' },
      { rating: 4, feedback: 'Solid coffee shop with good variety. The pastries could be fresher but overall a pleasant experience.', sentiment: 'positive' }
    ];

    // Create reviews with dates spread over the last 30 days
    for (let i = 0; i < sampleReviews.length; i++) {
      const reviewData = sampleReviews[i];
      const daysAgo = Math.floor(i * 4); // Spread reviews over ~30 days
      const reviewDate = new Date();
      reviewDate.setDate(reviewDate.getDate() - daysAgo);
      
      await firestoreDb.review.create({
        ...reviewData,
        businessId: demoBusiness.id,
        customerId: createdCustomers[i % createdCustomers.length].id,
        status: 'approved',
        createdAt: reviewDate,
        updatedAt: reviewDate
      });
    }

    // Create a sample QR code
    await firestoreDb.qrCode.create({
      title: 'Table Feedback QR',
      description: 'Scan to leave a review',
      businessId: demoBusiness.id,
      type: 'review',
      isActive: true,
      scanCount: 15
    });

    res.json({
      success: true,
      message: 'Demo business created successfully',
      data: {
        business: demoBusiness,
        customersCount: createdCustomers.length,
        reviewsCount: sampleReviews.length
      }
    });
  } catch (error) {
    console.error('Error creating demo business:', error);
    res.status(500).json({ error: 'Failed to create demo business', details: error.message });
  }
});

module.exports = router;
