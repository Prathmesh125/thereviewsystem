const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const QRCode = require('qrcode');
const { verifyFirebaseToken } = require('../middleware/firebaseAuth');
const firestoreDb = require('../services/firestoreService');

const router = express.Router();

// Helper to generate QR code image
const generateQRCodeImage = async (url, options = {}) => {
  const defaultOptions = {
    width: options.size || 300,
    margin: 2,
    color: {
      dark: options.foregroundColor || '#000000',
      light: options.backgroundColor || '#FFFFFF'
    },
    errorCorrectionLevel: options.errorCorrection || 'M'
  };

  return await QRCode.toDataURL(url, defaultOptions);
};

const generateQRCodeBuffer = async (url, options = {}) => {
  const defaultOptions = {
    width: options.size || 300,
    margin: 2,
    color: {
      dark: options.foregroundColor || '#000000',
      light: options.backgroundColor || '#FFFFFF'
    },
    errorCorrectionLevel: options.errorCorrection || 'M'
  };

  return await QRCode.toBuffer(url, defaultOptions);
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

// GET /api/qr-codes - Get all QR codes for user's business
router.get('/', verifyFirebaseToken, async (req, res) => {
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

    const qrCodes = await firestoreDb.qrCode.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' }
    });

    // Add business info and scan counts
    const enrichedQRCodes = await Promise.all(qrCodes.map(async (qrCode) => {
      const scansCount = await firestoreDb.qrScan.count({ qrCodeId: qrCode.id });
      return {
        ...qrCode,
        business: {
          id: business.id,
          name: business.name,
          brandColor: business.brandColor
        },
        _count: { scans: scansCount }
      };
    }));

    res.json(enrichedQRCodes);
  } catch (error) {
    console.error('Error fetching QR codes:', error);
    res.status(500).json({ error: 'Failed to fetch QR codes' });
  }
});

// POST /api/qr-codes - Create new QR code
router.post('/', 
  verifyFirebaseToken,
  [
    body('title').optional().trim().isLength({ min: 1, max: 100 }),
    body('backgroundColor').optional().matches(/^#[0-9A-F]{6}$/i),
    body('foregroundColor').optional().matches(/^#[0-9A-F]{6}$/i),
    body('size').optional().isInt({ min: 100, max: 1000 }),
    body('errorCorrection').optional().isIn(['L', 'M', 'Q', 'H'])
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

      const {
        title = 'Leave us a review',
        backgroundColor = '#FFFFFF',
        foregroundColor = '#000000',
        size = 300,
        logoUrl = null,
        errorCorrection = 'M'
      } = req.body;

      // Generate the review form URL
      const qrCodeUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/review/${business.id}`;

      // Generate QR code image
      const qrImageUrl = await generateQRCodeImage(qrCodeUrl, {
        size,
        backgroundColor,
        foregroundColor,
        errorCorrection
      });

      const qrCode = await firestoreDb.qrCode.create({
        businessId: business.id,
        qrCodeUrl,
        qrImageUrl,
        title,
        backgroundColor,
        foregroundColor,
        size,
        logoUrl,
        errorCorrection
      });

      res.status(201).json({
        ...qrCode,
        business: {
          id: business.id,
          name: business.name,
          brandColor: business.brandColor
        }
      });
    } catch (error) {
      console.error('Error creating QR code:', error);
      res.status(500).json({ error: error.message || 'Failed to create QR code' });
    }
  }
);

// GET /api/qr-codes/:id - Get specific QR code
router.get('/:id',
  verifyFirebaseToken,
  [param('id').isString().isLength({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      
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

      const qrCode = await firestoreDb.qrCode.findById(id);
      
      if (!qrCode) {
        return res.status(404).json({ error: 'QR code not found' });
      }

      // Verify QR code belongs to user's business
      if (qrCode.businessId !== business.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get scan analytics
      const totalScans = await firestoreDb.qrScan.count({ qrCodeId: id });
      const recentScans = await firestoreDb.qrScan.findMany({
        where: { qrCodeId: id },
        orderBy: { scannedAt: 'desc' },
        take: 10
      });

      res.json({
        qrCode: {
          ...qrCode,
          business: {
            id: business.id,
            name: business.name,
            brandColor: business.brandColor
          }
        },
        analytics: {
          totalScans,
          recentScans
        }
      });
    } catch (error) {
      console.error('Error fetching QR code:', error);
      res.status(500).json({ error: 'Failed to fetch QR code' });
    }
  }
);

// PUT /api/qr-codes/:id - Update QR code
router.put('/:id',
  verifyFirebaseToken,
  [
    param('id').isString().isLength({ min: 1 }),
    body('title').optional().trim().isLength({ min: 1, max: 100 }),
    body('backgroundColor').optional().matches(/^#[0-9A-F]{6}$/i),
    body('foregroundColor').optional().matches(/^#[0-9A-F]{6}$/i),
    body('size').optional().isInt({ min: 100, max: 1000 }),
    body('errorCorrection').optional().isIn(['L', 'M', 'Q', 'H']),
    body('isActive').optional().isBoolean()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      
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

      const existingQRCode = await firestoreDb.qrCode.findById(id);
      
      if (!existingQRCode) {
        return res.status(404).json({ error: 'QR code not found' });
      }

      if (existingQRCode.businessId !== business.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const updates = req.body;

      // If visual options changed, regenerate QR code
      const visualOptionsChanged = [
        'backgroundColor',
        'foregroundColor',
        'size',
        'errorCorrection'
      ].some(field => updates[field] && updates[field] !== existingQRCode[field]);

      if (visualOptionsChanged) {
        updates.qrImageUrl = await generateQRCodeImage(existingQRCode.qrCodeUrl, {
          size: updates.size || existingQRCode.size,
          backgroundColor: updates.backgroundColor || existingQRCode.backgroundColor,
          foregroundColor: updates.foregroundColor || existingQRCode.foregroundColor,
          errorCorrection: updates.errorCorrection || existingQRCode.errorCorrection
        });
      }

      const updatedQRCode = await firestoreDb.qrCode.update({ id }, updates);

      res.json({
        ...updatedQRCode,
        business: {
          id: business.id,
          name: business.name,
          brandColor: business.brandColor
        }
      });
    } catch (error) {
      console.error('Error updating QR code:', error);
      res.status(500).json({ error: error.message || 'Failed to update QR code' });
    }
  }
);

// DELETE /api/qr-codes/:id - Delete QR code
router.delete('/:id',
  verifyFirebaseToken,
  [param('id').isString().isLength({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      
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

      const existingQRCode = await firestoreDb.qrCode.findById(id);
      
      if (!existingQRCode) {
        return res.status(404).json({ error: 'QR code not found' });
      }

      if (existingQRCode.businessId !== business.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Delete scans first
      await firestoreDb.qrScan.deleteMany({ qrCodeId: id });
      
      // Delete QR code
      await firestoreDb.qrCode.delete({ id });

      res.json({ success: true, message: 'QR code deleted successfully' });
    } catch (error) {
      console.error('Error deleting QR code:', error);
      res.status(500).json({ error: error.message || 'Failed to delete QR code' });
    }
  }
);

// POST /api/qr-codes/:id/track-scan - Track QR code scan (public endpoint)
router.post('/:id/track-scan',
  [param('id').isString().isLength({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const qrCode = await firestoreDb.qrCode.findById(id);
      if (!qrCode) {
        return res.status(404).json({ error: 'QR code not found' });
      }

      const scanData = {
        qrCodeId: id,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.get('User-Agent'),
        location: req.body.location ? JSON.stringify(req.body.location) : null
      };

      await firestoreDb.qrScan.create(scanData);
      await firestoreDb.qrCode.incrementScans(id);

      res.json({ success: true, message: 'Scan tracked successfully' });
    } catch (error) {
      console.error('Error tracking scan:', error);
      res.status(500).json({ error: 'Failed to track scan' });
    }
  }
);

// GET /api/qr-codes/:id/analytics - Get QR code analytics
router.get('/:id/analytics',
  verifyFirebaseToken,
  [
    param('id').isString().isLength({ min: 1 }),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601()
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { startDate, endDate } = req.query;
      
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

      const qrCode = await firestoreDb.qrCode.findById(id);
      
      if (!qrCode) {
        return res.status(404).json({ error: 'QR code not found' });
      }

      if (qrCode.businessId !== business.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Build query conditions
      let scanWhere = { qrCodeId: id };
      if (startDate && endDate) {
        scanWhere.scannedAt = {
          gte: new Date(startDate),
          lte: new Date(endDate)
        };
      }

      const [totalScans, recentScans] = await Promise.all([
        firestoreDb.qrScan.count(scanWhere),
        firestoreDb.qrScan.findMany({
          where: scanWhere,
          orderBy: { scannedAt: 'desc' },
          take: 10
        })
      ]);

      res.json({
        qrCode: {
          ...qrCode,
          business: {
            id: business.id,
            name: business.name,
            brandColor: business.brandColor
          }
        },
        analytics: {
          totalScans,
          recentScans
        }
      });
    } catch (error) {
      console.error('Error fetching QR code analytics:', error);
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  }
);

// GET /api/qr-codes/:id/download - Download QR code image
router.get('/:id/download',
  [param('id').isString().isLength({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { format = 'png' } = req.query;

      const qrCode = await firestoreDb.qrCode.findById(id);
      
      if (!qrCode) {
        return res.status(404).json({ error: 'QR code not found' });
      }

      // Generate QR code buffer for download
      const qrCodeBuffer = await generateQRCodeBuffer(qrCode.qrCodeUrl, {
        size: qrCode.size,
        backgroundColor: qrCode.backgroundColor,
        foregroundColor: qrCode.foregroundColor,
        errorCorrection: qrCode.errorCorrection
      });

      // Set appropriate headers for download
      res.set({
        'Content-Type': `image/${format}`,
        'Content-Disposition': `attachment; filename="qr-code-${qrCode.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.${format}"`,
        'Content-Length': qrCodeBuffer.length
      });

      res.send(qrCodeBuffer);
    } catch (error) {
      console.error('Error downloading QR code:', error);
      res.status(500).json({ error: 'Failed to download QR code' });
    }
  }
);

module.exports = router;
