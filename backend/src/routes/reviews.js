const express = require('express');
const { verifyFirebaseToken } = require('../middleware/firebaseAuth');
const firestoreDb = require('../services/firestoreService');

const router = express.Router();

// Get all reviews for a business
router.get('/', verifyFirebaseToken, async (req, res) => {
  try {
    // Find user's businesses
    const user = await firestoreDb.user.findByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const businesses = await firestoreDb.business.findMany({
      where: { userId: user.id }
    });

    if (businesses.length === 0) {
      return res.json([]);
    }

    // Get reviews for all businesses
    let allReviews = [];
    for (const business of businesses) {
      const reviews = await firestoreDb.review.findMany({
        where: { businessId: business.id },
        orderBy: { createdAt: 'desc' }
      });
      
      // Add customer info to each review
      for (const review of reviews) {
        const customer = await firestoreDb.customer.findById(review.customerId);
        review.customer = customer;
      }
      
      allReviews = [...allReviews, ...reviews];
    }

    res.json(allReviews);
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Get specific review
router.get('/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const review = await firestoreDb.review.findById(req.params.id);
    
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    // Verify ownership
    const user = await firestoreDb.user.findByEmail(req.user.email);
    const business = await firestoreDb.business.findById(review.businessId);
    
    if (!business || business.userId !== user.id) {
      return res.status(404).json({ error: 'Review not found' });
    }

    // Add customer info
    const customer = await firestoreDb.customer.findById(review.customerId);
    review.customer = customer;

    res.json(review);
  } catch (error) {
    console.error('Error fetching review:', error);
    res.status(500).json({ error: 'Failed to fetch review' });
  }
});

// Public review submission (for review forms)
router.post('/public', async (req, res) => {
  try {
    const { customerId, businessId, rating, feedback, formData } = req.body;

    if (!customerId || !businessId || !rating) {
      return res.status(400).json({ error: 'Customer ID, business ID, and rating are required' });
    }

    // Verify customer exists and belongs to the business
    const customer = await firestoreDb.customer.findById(customerId);

    if (!customer || customer.businessId !== businessId) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Verify business exists
    const business = await firestoreDb.business.findById(businessId);

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const review = await firestoreDb.review.create({
      customerId: customerId,
      businessId: businessId,
      rating: parseInt(rating),
      feedback: feedback || '',
      formData: typeof formData === 'string' ? formData : JSON.stringify(formData || {})
    });

    // Add customer to response
    review.customer = customer;

    res.status(201).json(review);
  } catch (error) {
    console.error('Error creating public review:', error);
    res.status(500).json({ error: 'Failed to create review' });
  }
});

// Create a new review
router.post('/', verifyFirebaseToken, async (req, res) => {
  try {
    const { customerId, businessId, rating, feedback, formData } = req.body;

    if (!customerId || !rating) {
      return res.status(400).json({ error: 'Customer ID and rating are required' });
    }

    // Find user and verify business ownership
    const user = await firestoreDb.user.findByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify customer belongs to user's business
    const customer = await firestoreDb.customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const business = await firestoreDb.business.findFirst({
      id: customer.businessId,
      userId: user.id
    });

    if (!business) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const review = await firestoreDb.review.create({
      customerId,
      businessId: customer.businessId,
      rating: parseInt(rating),
      feedback,
      formData: formData || {}
    });

    review.customer = customer;

    res.status(201).json(review);
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(500).json({ error: 'Failed to create review' });
  }
});

// Update review status
router.put('/:reviewId/status', verifyFirebaseToken, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { status, generatedReview } = req.body;

    // Validate status
    const validStatuses = ['PENDING', 'AI_GENERATED', 'APPROVED', 'PUBLISHED', 'REJECTED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status. Must be one of: ' + validStatuses.join(', ') 
      });
    }

    // Find user
    const user = await firestoreDb.user.findByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify review belongs to user's business
    const review = await firestoreDb.review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const business = await firestoreDb.business.findFirst({
      id: review.businessId,
      userId: user.id
    });

    if (!business) {
      return res.status(404).json({ error: 'Review not found' });
    }

    // Update review
    const updateData = { status };
    if (generatedReview && status === 'AI_GENERATED') {
      updateData.generatedReview = generatedReview;
      updateData.submissionStep = 'PROCESSING';
    }

    const updatedReview = await firestoreDb.review.update(
      { id: reviewId },
      updateData
    );

    // Add customer and business info
    const customer = await firestoreDb.customer.findById(review.customerId);
    updatedReview.customer = customer;
    updatedReview.business = business;

    res.json(updatedReview);

  } catch (error) {
    console.error('Error updating review status:', error);
    res.status(500).json({ error: 'Failed to update review status' });
  }
});

// Delete review
router.delete('/:reviewId', verifyFirebaseToken, async (req, res) => {
  try {
    const { reviewId } = req.params;

    // Find user
    const user = await firestoreDb.user.findByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify review belongs to user's business
    const review = await firestoreDb.review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const business = await firestoreDb.business.findFirst({
      id: review.businessId,
      userId: user.id
    });

    if (!business) {
      return res.status(404).json({ error: 'Review not found' });
    }

    // Delete AI generation if exists
    await firestoreDb.aiReviewGeneration.deleteMany({ reviewId });
    
    await firestoreDb.review.delete({ id: reviewId });

    res.json({ message: 'Review deleted successfully' });

  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// Get review analytics for business
router.get('/business/:businessId/analytics', verifyFirebaseToken, async (req, res) => {
  try {
    const { businessId } = req.params;

    // Find user
    const user = await firestoreDb.user.findByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify business ownership
    const business = await firestoreDb.business.findFirst({
      id: businessId,
      userId: user.id
    });

    if (!business) {
      return res.status(403).json({ error: 'Access denied to this business' });
    }

    // Get review statistics
    const reviews = await firestoreDb.review.findMany({
      where: { businessId }
    });

    const totalReviews = reviews.length;
    
    // Calculate average rating
    const ratings = reviews.map(r => r.rating).filter(r => r != null);
    const avgRating = ratings.length > 0 
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length 
      : 0;

    // Rating distribution
    const ratingDistribution = {};
    for (let i = 1; i <= 5; i++) {
      ratingDistribution[`rating_${i}`] = reviews.filter(r => r.rating === i).length;
    }

    // Status distribution
    const statusDistribution = {};
    reviews.forEach(review => {
      const status = (review.status || 'PENDING').toLowerCase();
      statusDistribution[status] = (statusDistribution[status] || 0) + 1;
    });

    // Recent reviews (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentReviews = reviews.filter(r => new Date(r.createdAt) >= thirtyDaysAgo).length;

    res.json({
      totalReviews,
      averageRating: avgRating,
      recentReviews,
      ratingDistribution,
      statusDistribution
    });

  } catch (error) {
    console.error('Error fetching review analytics:', error);
    res.status(500).json({ error: 'Failed to fetch review analytics' });
  }
});

module.exports = router;
