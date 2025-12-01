const express = require('express');
const { verifyFirebaseToken, checkUserRole } = require('../middleware/firebaseAuth');
const { body, param, validationResult } = require('express-validator');
const firestoreDb = require('../services/firestoreService');

const router = express.Router();

// Helper function to find or create user in Firestore database
const findOrCreateUser = async (firebaseUser) => {
  let user = await firestoreDb.user.findByEmail(firebaseUser.email);

  if (!user) {
    user = await firestoreDb.user.create({
      email: firebaseUser.email,
      firstName: firebaseUser.name?.split(' ')[0] || firebaseUser.email.split('@')[0],
      lastName: firebaseUser.name?.split(' ').slice(1).join(' ') || '',
      password: 'firebase_auth', // Placeholder since we use Firebase
      role: firebaseUser.userData?.role || 'BUSINESS_OWNER',
      isActive: true
    });
  }

  return user;
};

// Test route without authentication
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Business routes are working!',
    timestamp: new Date().toISOString()
  });
});

// Validation rules
const businessValidation = [
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Business name is required and must be less than 100 characters'),
  body('type').trim().isLength({ min: 1, max: 50 }).withMessage('Business type is required'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
  body('website').optional({ checkFalsy: true }).isURL().withMessage('Website must be a valid URL'),
  body('phone').optional({ checkFalsy: true }).trim().matches(/^[\+]?[1-9][\d]{0,15}$/).withMessage('Phone must be a valid phone number'),
  body('address').optional().trim().isLength({ max: 200 }).withMessage('Address must be less than 200 characters'),
  body('brandColor').optional().matches(/^#[0-9A-F]{6}$/i).withMessage('Brand color must be a valid hex color'),
  body('customMessage').optional().trim().isLength({ max: 300 }).withMessage('Custom message must be less than 300 characters'),
  body('logo').optional().isString().withMessage('Logo must be a valid string'),
  body('enableSmartFilter').optional().custom((value) => {
    if (value !== undefined && value !== null) {
      if (value === true || value === false || value === 'true' || value === 'false' || value === 1 || value === 0) {
        return true;
      }
      throw new Error('Smart filter must be a boolean value');
    }
    return true;
  }).withMessage('Smart filter must be a boolean value'),
  body('googleReviewUrl').optional().custom((value) => {
    if (value && value.trim()) {
      if (typeof value !== 'string' || (!value.startsWith('http://') && !value.startsWith('https://'))) {
        throw new Error('Google Review URL must start with http:// or https://');
      }
      const lowerValue = value.toLowerCase();
      if (!lowerValue.includes('google') && !lowerValue.includes('g.page')) {
        throw new Error('URL must be from a Google domain (google.com, g.page, share.google, etc.)');
      }
    }
    return true;
  }).withMessage('Google Review URL must be a valid Google URL')
];

// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('=== BUSINESS VALIDATION ERRORS ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Validation errors:', JSON.stringify(errors.array(), null, 2));
    console.log('=== END VALIDATION ERRORS ===');
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Get all businesses for the authenticated user
router.get('/', verifyFirebaseToken, checkUserRole(), async (req, res) => {
  try {
    const userRole = req.user.userData?.role;
    let businesses;

    if (userRole === 'SUPER_ADMIN') {
      // Super admin can see all businesses
      const allBusinesses = await firestoreDb.business.findMany({
        orderBy: { createdAt: 'desc' }
      });
      
      // Get counts and user info for each business
      businesses = await Promise.all(allBusinesses.map(async (business) => {
        const [user, customersCount, reviewsCount, qrCodesCount] = await Promise.all([
          firestoreDb.user.findById(business.userId),
          firestoreDb.customer.count({ businessId: business.id }),
          firestoreDb.review.count({ businessId: business.id }),
          firestoreDb.qrCode.count({ businessId: business.id })
        ]);
        
        return {
          ...business,
          user: user ? {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName
          } : null,
          _count: {
            customers: customersCount,
            reviews: reviewsCount,
            qrCodes: qrCodesCount
          }
        };
      }));
    } else {
      // Business owners can only see their own businesses
      const user = await findOrCreateUser(req.user);

      const userBusinesses = await firestoreDb.business.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' }
      });
      
      // Get counts for each business
      businesses = await Promise.all(userBusinesses.map(async (business) => {
        const [customersCount, reviewsCount, qrCodesCount] = await Promise.all([
          firestoreDb.customer.count({ businessId: business.id }),
          firestoreDb.review.count({ businessId: business.id }),
          firestoreDb.qrCode.count({ businessId: business.id })
        ]);
        
        return {
          ...business,
          _count: {
            customers: customersCount,
            reviews: reviewsCount,
            qrCodes: qrCodesCount
          }
        };
      }));
    }

    res.json({
      success: true,
      data: businesses
    });
  } catch (error) {
    console.error('Error fetching businesses:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching businesses',
      error: error.message
    });
  }
});

// Get a specific business by ID
router.get('/:id', verifyFirebaseToken, checkUserRole(), param('id').isString(), async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.user.userData?.role;

    let business;

    if (userRole === 'SUPER_ADMIN') {
      business = await firestoreDb.business.findById(id);
      if (business) {
        const [user, customersCount, reviewsCount, qrCodesCount] = await Promise.all([
          firestoreDb.user.findById(business.userId),
          firestoreDb.customer.count({ businessId: id }),
          firestoreDb.review.count({ businessId: id }),
          firestoreDb.qrCode.count({ businessId: id })
        ]);
        
        business = {
          ...business,
          user: user ? {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName
          } : null,
          _count: {
            customers: customersCount,
            reviews: reviewsCount,
            qrCodes: qrCodesCount
          }
        };
      }
    } else {
      const user = await findOrCreateUser(req.user);
      business = await firestoreDb.business.findFirst({
        id,
        userId: user.id
      });
      
      if (business) {
        const [customersCount, reviewsCount, qrCodesCount] = await Promise.all([
          firestoreDb.customer.count({ businessId: id }),
          firestoreDb.review.count({ businessId: id }),
          firestoreDb.qrCode.count({ businessId: id })
        ]);
        
        business = {
          ...business,
          _count: {
            customers: customersCount,
            reviews: reviewsCount,
            qrCodes: qrCodesCount
          }
        };
      }
    }

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    res.json({
      success: true,
      data: business
    });
  } catch (error) {
    console.error('Error fetching business:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching business'
    });
  }
});

// Create a new business
router.post('/', verifyFirebaseToken, checkUserRole(), businessValidation, handleValidationErrors, async (req, res) => {
  try {
    const {
      name,
      type,
      description,
      website,
      phone,
      address,
      brandColor,
      customMessage,
      googleReviewUrl,
      logo,
      enableSmartFilter = false
    } = req.body;

    // Find or create user in local database
    const user = await findOrCreateUser(req.user);

    const business = await firestoreDb.business.create({
      userId: user.id,
      name,
      type,
      description,
      website,
      phone,
      address,
      brandColor: brandColor || '#3B82F6',
      customMessage,
      googleReviewUrl,
      logo,
      enableSmartFilter: enableSmartFilter === true || enableSmartFilter === 'true',
      isPublished: true // Auto-publish new businesses
    });

    res.status(201).json({
      success: true,
      message: 'Business created successfully',
      data: {
        ...business,
        _count: {
          customers: 0,
          reviews: 0,
          qrCodes: 0
        }
      }
    });
  } catch (error) {
    console.error('Error creating business:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating business'
    });
  }
});

// Update a business
router.put('/:id', verifyFirebaseToken, checkUserRole(), param('id').isString(), businessValidation, handleValidationErrors, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      type,
      description,
      website,
      phone,
      address,
      brandColor,
      customMessage,
      googleReviewUrl,
      logo,
      isPublished,
      enableSmartFilter
    } = req.body;

    const userRole = req.user.userData?.role;

    // Check ownership for business owners
    if (userRole !== 'SUPER_ADMIN') {
      const user = await firestoreDb.user.findByEmail(req.user.email);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const existingBusiness = await firestoreDb.business.findFirst({
        id,
        userId: user.id
      });

      if (!existingBusiness) {
        return res.status(404).json({
          success: false,
          message: 'Business not found or access denied'
        });
      }
    }

    // Convert enableSmartFilter to proper boolean
    const smartFilterValue = enableSmartFilter === true || enableSmartFilter === 'true' || enableSmartFilter === 1;
    
    const updatedBusiness = await firestoreDb.business.update(
      { id },
      {
        name,
        type,
        description,
        website,
        phone,
        address,
        brandColor,
        customMessage,
        googleReviewUrl,
        logo,
        enableSmartFilter: smartFilterValue,
        isPublished
      }
    );

    const [customersCount, reviewsCount, qrCodesCount] = await Promise.all([
      firestoreDb.customer.count({ businessId: id }),
      firestoreDb.review.count({ businessId: id }),
      firestoreDb.qrCode.count({ businessId: id })
    ]);

    res.json({
      success: true,
      message: 'Business updated successfully',
      data: {
        ...updatedBusiness,
        _count: {
          customers: customersCount,
          reviews: reviewsCount,
          qrCodes: qrCodesCount
        }
      }
    });
  } catch (error) {
    console.error('Error updating business:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating business'
    });
  }
});

// Delete a business
router.delete('/:id', verifyFirebaseToken, checkUserRole(), param('id').isString(), async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.user.userData?.role;

    // Check ownership for business owners
    if (userRole !== 'SUPER_ADMIN') {
      const user = await firestoreDb.user.findByEmail(req.user.email);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const existingBusiness = await firestoreDb.business.findFirst({
        id,
        userId: user.id
      });

      if (!existingBusiness) {
        return res.status(404).json({
          success: false,
          message: 'Business not found or access denied'
        });
      }
    }

    // Delete related data first
    await firestoreDb.review.deleteMany({ businessId: id });
    await firestoreDb.customer.deleteMany({ businessId: id });
    
    // Delete QR scans first, then QR codes
    const qrCodes = await firestoreDb.qrCode.findMany({ where: { businessId: id } });
    for (const qrCode of qrCodes) {
      await firestoreDb.qrScan.deleteMany({ qrCodeId: qrCode.id });
    }
    await firestoreDb.qrCode.deleteMany({ businessId: id });
    
    await firestoreDb.formTemplate.deleteMany({ businessId: id });
    await firestoreDb.aiPromptTemplate.deleteMany({ businessId: id });
    await firestoreDb.aiUsageAnalytics.deleteMany({ businessId: id });

    // Finally delete the business
    await firestoreDb.business.delete({ id });

    res.json({
      success: true,
      message: 'Business deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting business:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting business'
    });
  }
});

// Toggle business publication status
router.patch('/:id/publish', verifyFirebaseToken, checkUserRole(), param('id').isString(), async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.user.userData?.role;

    // Check ownership for business owners
    if (userRole !== 'SUPER_ADMIN') {
      const user = await firestoreDb.user.findByEmail(req.user.email);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const existingBusiness = await firestoreDb.business.findFirst({
        id,
        userId: user.id
      });

      if (!existingBusiness) {
        return res.status(404).json({
          success: false,
          message: 'Business not found or access denied'
        });
      }
    }

    const business = await firestoreDb.business.findById(id);

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    const updatedBusiness = await firestoreDb.business.update(
      { id },
      { isPublished: !business.isPublished }
    );

    res.json({
      success: true,
      message: `Business ${updatedBusiness.isPublished ? 'published' : 'unpublished'} successfully`,
      data: { isPublished: updatedBusiness.isPublished }
    });
  } catch (error) {
    console.error('Error toggling business publication:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling business publication'
    });
  }
});

module.exports = router;
