const QRCode = require('qrcode');
const firestoreDb = require('./firestoreService');

class QRCodeService {
  /**
   * Generate QR code image data URL
   */
  static async generateQRCode(url, options = {}) {
    const defaultOptions = {
      width: options.size || 300,
      margin: 2,
      color: {
        dark: options.foregroundColor || '#000000',
        light: options.backgroundColor || '#FFFFFF'
      },
      errorCorrectionLevel: options.errorCorrection || 'M'
    };

    try {
      const qrCodeDataURL = await QRCode.toDataURL(url, defaultOptions);
      return qrCodeDataURL;
    } catch (error) {
      console.error('Error generating QR code:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Generate QR code as Buffer for file saving
   */
  static async generateQRCodeBuffer(url, options = {}) {
    const defaultOptions = {
      width: options.size || 300,
      margin: 2,
      color: {
        dark: options.foregroundColor || '#000000',
        light: options.backgroundColor || '#FFFFFF'
      },
      errorCorrectionLevel: options.errorCorrection || 'M'
    };

    try {
      const qrCodeBuffer = await QRCode.toBuffer(url, defaultOptions);
      return qrCodeBuffer;
    } catch (error) {
      console.error('Error generating QR code buffer:', error);
      throw new Error('Failed to generate QR code buffer');
    }
  }

  /**
   * Create QR code record in database
   */
  static async createQRCode(businessId, qrData) {
    try {
      console.log('Creating QR code for business:', businessId);
      console.log('QR data:', qrData);

      const {
        title = 'Leave us a review',
        backgroundColor = '#FFFFFF',
        foregroundColor = '#000000',
        size = 300,
        logoUrl = null,
        errorCorrection = 'M'
      } = qrData;

      // Generate the review form URL
      const qrCodeUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/review/${businessId}`;
      console.log('Generated QR code URL:', qrCodeUrl);

      // Generate QR code image
      console.log('Generating QR code image...');
      const qrImageDataURL = await this.generateQRCode(qrCodeUrl, {
        size,
        backgroundColor,
        foregroundColor,
        errorCorrection
      });
      console.log('QR code image generated successfully');

      // Create QR code record in Firestore
      console.log('Creating QR code record in database...');
      const qrCode = await firestoreDb.qrCode.create({
        businessId,
        qrCodeUrl,
        qrImageUrl: qrImageDataURL, // Store data URL for now, later we'll use Cloudinary
        title,
        backgroundColor,
        foregroundColor,
        size,
        logoUrl,
        errorCorrection,
        scansCount: 0
      });

      // Get business details
      const business = await firestoreDb.business.findUnique({ id: businessId });

      console.log('QR code created successfully:', qrCode.id);
      return {
        ...qrCode,
        business: business ? {
          id: business.id,
          name: business.name,
          brandColor: business.brandColor
        } : null
      };
    } catch (error) {
      console.error('Error creating QR code:', error);
      throw new Error('Failed to create QR code');
    }
  }

  /**
   * Get QR codes for a business
   */
  static async getBusinessQRCodes(businessId) {
    try {
      const qrCodes = await firestoreDb.qrCode.findMany({ businessId });

      // Get business details and scan counts
      const business = await firestoreDb.business.findUnique({ id: businessId });

      const qrCodesWithDetails = await Promise.all(qrCodes.map(async (qrCode) => {
        const scans = await firestoreDb.qrScan.findMany({ qrCodeId: qrCode.id });
        return {
          ...qrCode,
          business: business ? {
            id: business.id,
            name: business.name,
            brandColor: business.brandColor
          } : null,
          _count: {
            scans: scans.length
          }
        };
      }));

      // Sort by created date descending
      qrCodesWithDetails.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return qrCodesWithDetails;
    } catch (error) {
      console.error('Error fetching QR codes:', error);
      throw new Error('Failed to fetch QR codes');
    }
  }

  /**
   * Update QR code
   */
  static async updateQRCode(qrCodeId, updates) {
    try {
      const existingQRCode = await firestoreDb.qrCode.findUnique({ id: qrCodeId });

      if (!existingQRCode) {
        throw new Error('QR code not found');
      }

      // If visual options changed, regenerate QR code
      const visualOptionsChanged = [
        'backgroundColor',
        'foregroundColor',
        'size',
        'errorCorrection'
      ].some(field => updates[field] && updates[field] !== existingQRCode[field]);

      let qrImageUrl = existingQRCode.qrImageUrl;

      if (visualOptionsChanged) {
        qrImageUrl = await this.generateQRCode(existingQRCode.qrCodeUrl, {
          size: updates.size || existingQRCode.size,
          backgroundColor: updates.backgroundColor || existingQRCode.backgroundColor,
          foregroundColor: updates.foregroundColor || existingQRCode.foregroundColor,
          errorCorrection: updates.errorCorrection || existingQRCode.errorCorrection
        });
      }

      const updatedQRCode = await firestoreDb.qrCode.update(qrCodeId, {
        ...updates,
        qrImageUrl
      });

      // Get business details
      const business = await firestoreDb.business.findUnique({ id: existingQRCode.businessId });

      return {
        ...updatedQRCode,
        business: business ? {
          id: business.id,
          name: business.name,
          brandColor: business.brandColor
        } : null
      };
    } catch (error) {
      console.error('Error updating QR code:', error);
      throw new Error('Failed to update QR code');
    }
  }

  /**
   * Delete QR code
   */
  static async deleteQRCode(qrCodeId) {
    try {
      await firestoreDb.qrCode.delete(qrCodeId);
      return { success: true };
    } catch (error) {
      console.error('Error deleting QR code:', error);
      throw new Error('Failed to delete QR code');
    }
  }

  /**
   * Track QR code scan
   */
  static async trackScan(qrCodeId, scanData = {}) {
    try {
      const { ipAddress, userAgent, location } = scanData;

      // Create scan record
      await firestoreDb.qrScan.create({
        qrCodeId,
        ipAddress,
        userAgent,
        location: location ? JSON.stringify(location) : null
      });

      // Increment scan count on QR code
      const qrCode = await firestoreDb.qrCode.findUnique({ id: qrCodeId });
      if (qrCode) {
        await firestoreDb.qrCode.update(qrCodeId, {
          scansCount: (qrCode.scansCount || 0) + 1
        });
      }

      return { success: true };
    } catch (error) {
      console.error('Error tracking QR scan:', error);
      throw new Error('Failed to track scan');
    }
  }

  /**
   * Get QR code analytics
   */
  static async getQRCodeAnalytics(qrCodeId, dateRange = {}) {
    try {
      const { startDate, endDate } = dateRange;
      
      const qrCode = await firestoreDb.qrCode.findUnique({ id: qrCodeId });
      
      if (!qrCode) {
        throw new Error('QR code not found');
      }

      // Get business details
      const business = await firestoreDb.business.findUnique({ id: qrCode.businessId });

      // Get all scans
      let scans = await firestoreDb.qrScan.findMany({ qrCodeId });

      // Filter by date range if provided
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        scans = scans.filter(scan => {
          const scanDate = new Date(scan.scannedAt);
          return scanDate >= start && scanDate <= end;
        });
      }

      // Get recent scans (last 10)
      const recentScans = scans
        .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt))
        .slice(0, 10)
        .map(scan => ({
          id: scan.id,
          ipAddress: scan.ipAddress,
          location: scan.location,
          scannedAt: scan.scannedAt
        }));

      return {
        qrCode: {
          ...qrCode,
          business: business ? {
            id: business.id,
            name: business.name,
            brandColor: business.brandColor
          } : null
        },
        analytics: {
          totalScans: scans.length,
          recentScans
        }
      };
    } catch (error) {
      console.error('Error fetching QR code analytics:', error);
      throw new Error('Failed to fetch QR code analytics');
    }
  }
}

module.exports = QRCodeService;
