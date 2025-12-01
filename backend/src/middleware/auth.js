const jwt = require('jsonwebtoken')
const firestoreDb = require('../services/firestoreService')

// Verify JWT token middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required'
    })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    
    // Get user from Firestore database to ensure they still exist and are active
    const user = await firestoreDb.user.findUnique({ id: decoded.userId })

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      })
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: 'Account has been deactivated'
      })
    }

    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
      businessName: user.businessName,
      businessType: user.businessType,
      createdAt: user.createdAt
    }
    next()
  } catch (error) {
    console.error('Token verification error:', error)
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      })
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      })
    }

    return res.status(500).json({
      success: false,
      error: 'Token verification failed'
    })
  }
}

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    req.user = null
    return next()
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await firestoreDb.user.findUnique({ id: decoded.userId })

    if (user && user.isActive) {
      req.user = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isActive: user.isActive,
        businessName: user.businessName,
        businessType: user.businessType,
        createdAt: user.createdAt
      }
    } else {
      req.user = null
    }
  } catch (error) {
    req.user = null
  }

  next()
}

module.exports = {
  authenticateToken,
  optionalAuth
}
