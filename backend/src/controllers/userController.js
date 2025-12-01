const firestoreDb = require('../services/firestoreService')
const { generateUserResponse } = require('../utils/auth')

// Get user dashboard metrics
const getDashboardMetrics = async (req, res) => {
  try {
    const userId = req.user.id

    // Get user's businesses
    const businesses = await firestoreDb.business.findMany({ userId })

    // Get all customers and reviews for each business
    let allCustomers = []
    let allReviews = []
    let allQRCodes = []

    for (const business of businesses) {
      const customers = await firestoreDb.customer.findMany({ businessId: business.id })
      const reviews = await firestoreDb.review.findMany({ businessId: business.id })
      const qrCodes = await firestoreDb.qrCode.findMany({ businessId: business.id })
      
      allCustomers = [...allCustomers, ...customers]
      allReviews = [...allReviews, ...reviews]
      allQRCodes = [...allQRCodes, ...qrCodes]
    }

    // Calculate metrics
    const totalBusinesses = businesses.length
    const totalCustomers = allCustomers.length
    const totalReviews = allReviews.length
    const totalQRCodes = allQRCodes.length

    // Calculate average rating
    const avgRating = allReviews.length > 0 
      ? allReviews.reduce((sum, review) => sum + review.rating, 0) / allReviews.length
      : 0

    // Get recent activity (last 10 customers)
    const recentCustomers = allCustomers
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10)
      .map(customer => {
        const business = businesses.find(b => b.id === customer.businessId)
        return {
          ...customer,
          business: { name: business?.name }
        }
      })

    // Get recent reviews (last 10)
    const recentReviews = allReviews
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10)
      .map(review => {
        const business = businesses.find(b => b.id === review.businessId)
        const customer = allCustomers.find(c => c.id === review.customerId)
        return {
          ...review,
          customer: { name: customer?.name },
          business: { name: business?.name }
        }
      })

    res.json({
      success: true,
      metrics: {
        totalBusinesses,
        totalCustomers,
        totalReviews,
        totalQRCodes,
        avgRating: Math.round(avgRating * 10) / 10, // Round to 1 decimal
        conversionRate: totalCustomers > 0 ? Math.round((totalReviews / totalCustomers) * 100) : 0
      },
      recentActivity: {
        customers: recentCustomers,
        reviews: recentReviews
      }
    })

  } catch (error) {
    console.error('Dashboard metrics error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to get dashboard metrics'
    })
  }
}

// Get user's businesses
const getUserBusinesses = async (req, res) => {
  try {
    const userId = req.user.id

    const businesses = await firestoreDb.business.findMany({ userId })

    // Add counts for each business
    const businessesWithCounts = await Promise.all(businesses.map(async (business) => {
      const customers = await firestoreDb.customer.findMany({ businessId: business.id })
      const reviews = await firestoreDb.review.findMany({ businessId: business.id })
      const qrCodes = await firestoreDb.qrCode.findMany({ businessId: business.id })
      
      return {
        ...business,
        _count: {
          customers: customers.length,
          reviews: reviews.length,
          qrCodes: qrCodes.length
        }
      }
    }))

    // Sort by created date descending
    businessesWithCounts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    res.json({
      success: true,
      businesses: businessesWithCounts
    })

  } catch (error) {
    console.error('Get businesses error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to get businesses'
    })
  }
}

// Get user analytics
const getUserAnalytics = async (req, res) => {
  try {
    const userId = req.user.id
    const { dateRange = '30d' } = req.query

    // Calculate date range
    const now = new Date()
    let startDate
    
    switch (dateRange) {
      case '7d':
        startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000))
        break
      case '30d':
        startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000))
        break
      case '90d':
        startDate = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000))
        break
      case '1y':
        startDate = new Date(now.getTime() - (365 * 24 * 60 * 60 * 1000))
        break
      default:
        startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000))
    }

    // Get user's businesses
    const businesses = await firestoreDb.business.findMany({ userId })
    const businessIds = businesses.map(b => b.id)

    // Get all reviews and customers for these businesses
    let allReviews = []
    let allCustomers = []

    for (const businessId of businessIds) {
      const reviews = await firestoreDb.review.findMany({ businessId })
      const customers = await firestoreDb.customer.findMany({ businessId })
      allReviews = [...allReviews, ...reviews]
      allCustomers = [...allCustomers, ...customers]
    }

    // Filter by date range
    const filteredReviews = allReviews.filter(r => new Date(r.createdAt) >= startDate)
    const filteredCustomers = allCustomers.filter(c => new Date(c.createdAt) >= startDate)

    // Group reviews by date
    const reviewsByDate = {}
    filteredReviews.forEach(review => {
      const dateStr = new Date(review.createdAt).toISOString().split('T')[0]
      reviewsByDate[dateStr] = (reviewsByDate[dateStr] || 0) + 1
    })

    // Group customers by date
    const customersByDate = {}
    filteredCustomers.forEach(customer => {
      const dateStr = new Date(customer.createdAt).toISOString().split('T')[0]
      customersByDate[dateStr] = (customersByDate[dateStr] || 0) + 1
    })

    // Calculate rating distribution
    const ratingDistribution = {}
    filteredReviews.forEach(review => {
      ratingDistribution[review.rating] = (ratingDistribution[review.rating] || 0) + 1
    })

    res.json({
      success: true,
      analytics: {
        dateRange,
        reviewsByDate: Object.entries(reviewsByDate).map(([date, count]) => ({
          createdAt: date,
          _count: { id: count }
        })).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
        customersByDate: Object.entries(customersByDate).map(([date, count]) => ({
          createdAt: date,
          _count: { id: count }
        })).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
        ratingDistribution: Object.entries(ratingDistribution).map(([rating, count]) => ({
          rating: parseInt(rating),
          _count: { rating: count }
        })).sort((a, b) => a.rating - b.rating)
      }
    })

  } catch (error) {
    console.error('User analytics error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to get user analytics'
    })
  }
}

module.exports = {
  getDashboardMetrics,
  getUserBusinesses,
  getUserAnalytics
}
