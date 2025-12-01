const express = require('express');
const router = express.Router();
const { body, validationResult, param, query } = require('express-validator');
const aiService = require('../services/aiService');
const { verifyFirebaseToken } = require('../middleware/firebaseAuth');
const firestoreDb = require('../services/firestoreService');
const { validateReviewText, getTextImprovementSuggestions } = require('../utils/textValidation');
const { improveTextFormatting, enhanceWithFormatting } = require('../utils/textFormatting');
const { checkSubscriptionLimit, recordUsage } = require('../middleware/subscriptionAuth');

/**
 * @route GET /api/ai/health
 * @description Health check for AI service
 * @access Public
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'AI service is running',
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    claudeConfigured: !!process.env.ANTHROPIC_API_KEY,
    defaultModel: process.env.DEFAULT_AI_MODEL || 'gemini'
  });
});

/**
 * @route GET /api/ai/models
 * @description Get available AI models
 * @access Protected
 */
router.get('/models', verifyFirebaseToken, (req, res) => {
  try {
    const models = aiService.getAvailableModels();
    
    res.json({
      success: true,
      models,
      defaultModel: process.env.DEFAULT_AI_MODEL || 'gemini'
    });
  } catch (error) {
    console.error('Error getting AI models:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get AI models',
      error: error.message
    });
  }
});

/**
 * @route POST /api/ai/models/default
 * @description Set default AI model for all clients (Super Admin only)
 * @access Super Admin
 */
router.post('/models/default',
  verifyFirebaseToken,
  [
    body('modelId')
      .notEmpty()
      .withMessage('Model ID is required')
      .isIn(['claude', 'gemini'])
      .withMessage('Model ID must be claude or gemini')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      // Check if user is super admin
      const superAdminEmails = process.env.SUPER_ADMIN_EMAILS?.split(',') || [];
      if (!superAdminEmails.includes(req.user.email)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Super admin privileges required.'
        });
      }

      const { modelId } = req.body;
      const model = await aiService.setDefaultModel(modelId);
      
      res.json({
        success: true,
        message: `Default AI model set to ${model.name}`,
        model,
        enabledFor: 'all clients'
      });
    } catch (error) {
      console.error('Error setting default AI model:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to set default AI model',
        error: error.message
      });
    }
  }
);

/**
 * @route POST /api/ai/enhance-text
 * @description Enhance text in real-time (public endpoint for review forms)
 * @access Public
 */
router.post('/enhance-text',
  [
    body('originalText')
      .notEmpty()
      .withMessage('Original text is required')
      .isLength({ min: 5 })
      .withMessage('Text must be at least 5 characters long'),
    body('businessContext')
      .optional()
      .isObject()
      .withMessage('Business context must be an object'),
    body('style')
      .optional()
      .isIn(['default', 'rewrite', 'detailed', 'concise', 'creative', 'creative_rewrite', 'professional_rewrite'])
      .withMessage('Style must be one of valid styles'),
    body('preferredModel')
      .optional()
      .isIn(['claude', 'gemini'])
      .withMessage('Preferred model must be claude or gemini')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { 
        originalText, 
        businessContext = {}, 
        style = 'default',
        variationLevel = 'medium',
        uniqueApproach = 'balanced',
        tone = 'friendly',
        timestamp,
        rewriteIteration,
        creativityBoost = false
      } = req.body;

      // For very short text (auto-generated templates), skip strict validation
      let textValidation = { isValid: true, errors: [] };
      if (originalText.length >= 10) {
        textValidation = validateReviewText(originalText);
        if (!textValidation.isValid) {
          return res.status(400).json({
            success: false,
            message: 'Invalid review content',
            errors: textValidation.errors,
            suggestions: getTextImprovementSuggestions(originalText)
          });
        }
      }

      // Improve the original text formatting
      const improvedOriginalText = improveTextFormatting(originalText);

      // Build the enhancement prompt based on style and variation parameters
      let enhancementPrompt;
      
      // Generate unique variation elements based on parameters
      const uniqueElements = {
        timestamp: timestamp || Date.now(),
        seed: businessContext.uniqueSeed || Math.random().toString(36).substring(7),
        variationId: rewriteIteration || Math.floor(Math.random() * 10000)
      };
      
      if (style === 'rewrite' || style === 'creative_rewrite' || style === 'professional_rewrite') {
        enhancementPrompt = `
          You are an expert content writer specializing in creating authentic, unique customer reviews that never repeat patterns.
          
          UNIQUENESS REQUIREMENTS (Variation ID: ${uniqueElements.variationId}):
          - Generate completely unique content using seed: ${uniqueElements.seed}
          - Approach: ${uniqueApproach} | Tone: ${tone} | Variation Level: ${variationLevel}
          - Never use predictable patterns or common phrases
          - Create fresh perspectives and unique expressions every time
          - Use different sentence structures, vocabulary, and emotional expressions
          
          AUTHENTICITY GUIDELINES:
          - Write like a real person sharing their genuine experience
          - Use ${tone} tone with ${uniqueApproach} approach
          - Include personal elements: "I", "my experience", "I felt", "I noticed"  
          - Vary sentence lengths naturally - mix short punchy sentences with detailed descriptions
          - Use everyday conversational language with natural contractions
          
          CREATIVE VARIATION TECHNIQUES:
          - Start differently each time: vary openings, perspectives, and contexts
          - Use unique transitions and connecting phrases
          - Incorporate different emotional expressions and personal insights
          - End with varied recommendations and future intentions
          - Add specific but believable details that enhance authenticity
          
          Business Context:
          - Business Name: ${businessContext.businessName || 'the business'}
          - Business Type: ${businessContext.businessType || 'service provider'}
          ${creativityBoost ? `- CREATIVITY BOOST: Use maximum creative variation and unique expressions` : ''}
          
          Original Content: "${improvedOriginalText}"
          
          Generate a completely unique, ${variationLevel}-variation review that sounds authentically human and never repeats previous patterns:
        `;
      } else {
        enhancementPrompt = `
          You are an expert content writer who creates authentic, unique customer reviews with unlimited variation potential.
          
          UNIQUENESS PARAMETERS (ID: ${uniqueElements.variationId}):
          - Unique Seed: ${uniqueElements.seed}
          - Style: ${style} | Approach: ${uniqueApproach} | Tone: ${tone}
          - Variation Level: ${variationLevel}
          - Generate completely unique content that never repeats patterns
          
          HUMAN AUTHENTICITY REQUIREMENTS:
          - Build upon the user's foundation: "${improvedOriginalText}"
          - Write with genuine ${tone} tone using ${uniqueApproach} approach
          - Sound like a real person sharing their authentic experience
          - Use natural conversational patterns and personal expressions
          - Include relatable details and specific but believable experiences
          
          CREATIVE VARIATION STRATEGY:
          - Use unique opening approaches and perspectives each time
          - Vary emotional expressions and personal insights
          - Employ different sentence structures and vocabulary
          - Create fresh transitions and connecting phrases  
          - End with varied recommendations and future intentions
          - Never use predictable or repetitive language patterns
          
          Business Details:
          - Business Name: ${businessContext.businessName || 'the business'}
          - Business Type: ${businessContext.businessType || 'service provider'}
          ${creativityBoost ? `- MAXIMUM CREATIVITY: Use bold, unique expressions and varied perspectives` : ''}
          
          Foundation Text: "${improvedOriginalText}"
          
          Create a completely unique, ${variationLevel}-variation review that authentically represents a real customer's genuine experience:
        `;
      }

      // Generate enhanced text with Gemini (with comprehensive error handling)
      let enhancedText;
      
      try {
        console.log('🤖 Generating AI content with Gemini...');
        
        // Use the preferred model or default model
        const selectedModel = req.body.preferredModel || process.env.DEFAULT_AI_MODEL || 'gemini';
        
        console.log(`📝 Sending prompt to ${selectedModel.toUpperCase()}...`);
        enhancedText = await aiService.generateContent(enhancementPrompt, selectedModel);
        
        if (!enhancedText || enhancedText.trim().length === 0) {
          throw new Error(`Empty response from ${selectedModel.toUpperCase()} API`);
        }
        
        console.log(`✅ ${selectedModel.toUpperCase()} response received successfully`);
        
        // Ensure the enhanced text properly incorporates the improved original
        enhancedText = enhanceWithFormatting(improvedOriginalText, enhancedText);
        
      } catch (aiError) {
        console.log('⚠️ AI service issue, using enhanced fallback:', aiError.message);
        
        // Enhanced fallback with variation parameters
        enhancedText = generateSmartFallbackEnhancement(
          improvedOriginalText, 
          businessContext,
          {
            style,
            tone,
            uniqueApproach,
            variationLevel,
            uniqueElements
          }
        );
      }

      res.json({
        success: true,
        originalText: improvedOriginalText, // Return the improved version
        enhancedText,
        message: 'Text enhanced successfully'
      });

    } catch (error) {
      console.error('Error enhancing text:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to enhance text',
        error: error.message
      });
    }
  }
);

/**
 * @route POST /api/ai/enhance-review
 * @description Enhance a review using AI
 * @access Private (Business Owner)
 */
router.post('/enhance-review',
  verifyFirebaseToken,
  checkSubscriptionLimit('ai_enhancement'),
  [
    body('reviewId')
      .notEmpty()
      .withMessage('Review ID is required'),
    body('businessContext')
      .optional()
      .isObject()
      .withMessage('Business context must be an object')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { reviewId, businessContext = {} } = req.body;

      // Find user
      const user = await firestoreDb.user.findByEmail(req.user.email);
      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'User not found'
        });
      }

      // Verify review exists and belongs to user's business
      const business = await firestoreDb.business.findFirst({ userId: user.id });
      if (!business) {
        return res.status(404).json({
          success: false,
          message: 'Business not found'
        });
      }

      const review = await firestoreDb.review.findById(reviewId);
      if (!review || review.businessId !== business.id) {
        return res.status(404).json({
          success: false,
          message: 'Review not found or access denied'
        });
      }

      // Check if already has AI generation
      const existingGeneration = await firestoreDb.aiGeneration.findByReviewId(reviewId);
      if (existingGeneration && existingGeneration.status !== 'REJECTED') {
        return res.status(400).json({
          success: false,
          message: 'Review already has AI enhancement',
          data: existingGeneration
        });
      }

      // Build business context
      const fullBusinessContext = {
        businessId: business.id,
        businessName: business.name,
        businessType: business.type,
        ...businessContext
      };

      // Generate AI enhancement with preferred model
      const aiGeneration = await aiService.enhanceReview(
        reviewId,
        review.feedbackText,
        fullBusinessContext,
        req.body.preferredModel
      );

      // Record usage for subscription tracking
      if (business.id) {
        await recordUsage(business.id, 'ai_enhancement', {
          reviewId,
          enhancementType: 'review_enhancement',
          businessName: business.name
        });
      }

      res.status(201).json({
        success: true,
        message: 'Review enhanced successfully',
        data: aiGeneration
      });

    } catch (error) {
      console.error('Error enhancing review:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to enhance review',
        error: error.message
      });
    }
  }
);

/**
 * @route POST /api/ai/approve-review/:reviewId
 * @description Approve AI generated review
 * @access Private (Business Owner)
 */
router.post('/approve-review/:reviewId',
  verifyFirebaseToken,
  [
    param('reviewId')
      .notEmpty()
      .withMessage('Review ID is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { reviewId } = req.params;

      // Find user
      const user = await firestoreDb.user.findByEmail(req.user.email);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Verify review belongs to user's business
      const business = await firestoreDb.business.findFirst({ userId: user.id });
      if (!business) {
        return res.status(404).json({
          success: false,
          message: 'Business not found'
        });
      }

      const review = await firestoreDb.review.findById(reviewId);
      if (!review || review.businessId !== business.id) {
        return res.status(404).json({
          success: false,
          message: 'Review not found or access denied'
        });
      }

      const aiGeneration = await firestoreDb.aiGeneration.findByReviewId(reviewId);
      if (!aiGeneration) {
        return res.status(400).json({
          success: false,
          message: 'No AI generation found for this review'
        });
      }

      const updatedGeneration = await aiService.approveReview(reviewId, req.user.email);

      res.json({
        success: true,
        message: 'Review approved successfully',
        data: updatedGeneration
      });

    } catch (error) {
      console.error('Error approving review:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to approve review',
        error: error.message
      });
    }
  }
);

/**
 * @route POST /api/ai/reject-review/:reviewId
 * @description Reject AI generated review
 * @access Private (Business Owner)
 */
router.post('/reject-review/:reviewId',
  verifyFirebaseToken,
  [
    param('reviewId')
      .notEmpty()
      .withMessage('Review ID is required'),
    body('rejectionNote')
      .optional()
      .isString()
      .withMessage('Rejection note must be a string')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { reviewId } = req.params;
      const { rejectionNote } = req.body;

      // Find user
      const user = await firestoreDb.user.findByEmail(req.user.email);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Verify review belongs to user's business
      const business = await firestoreDb.business.findFirst({ userId: user.id });
      if (!business) {
        return res.status(404).json({
          success: false,
          message: 'Business not found'
        });
      }

      const review = await firestoreDb.review.findById(reviewId);
      if (!review || review.businessId !== business.id) {
        return res.status(404).json({
          success: false,
          message: 'Review not found or access denied'
        });
      }

      const aiGeneration = await firestoreDb.aiGeneration.findByReviewId(reviewId);
      if (!aiGeneration) {
        return res.status(400).json({
          success: false,
          message: 'No AI generation found for this review'
        });
      }

      const updatedGeneration = await aiService.rejectReview(reviewId, rejectionNote);

      res.json({
        success: true,
        message: 'Review rejected successfully',
        data: updatedGeneration
      });

    } catch (error) {
      console.error('Error rejecting review:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reject review',
        error: error.message
      });
    }
  }
);

/**
 * @route POST /api/ai/regenerate-review/:reviewId
 * @description Regenerate AI enhanced review
 * @access Private (Business Owner)
 */
router.post('/regenerate-review/:reviewId',
  verifyFirebaseToken,
  checkSubscriptionLimit('ai_enhancement'),
  [
    param('reviewId')
      .notEmpty()
      .withMessage('Review ID is required'),
    body('customPrompt')
      .optional()
      .isString()
      .withMessage('Custom prompt must be a string')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { reviewId } = req.params;
      const { customPrompt } = req.body;

      // Find user
      const user = await firestoreDb.user.findByEmail(req.user.email);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Verify review belongs to user's business
      const business = await firestoreDb.business.findFirst({ userId: user.id });
      if (!business) {
        return res.status(404).json({
          success: false,
          message: 'Business not found'
        });
      }

      const review = await firestoreDb.review.findById(reviewId);
      if (!review || review.businessId !== business.id) {
        return res.status(404).json({
          success: false,
          message: 'Review not found or access denied'
        });
      }

      const aiGeneration = await aiService.regenerateReview(reviewId, customPrompt);

      // Record usage for subscription tracking
      if (business.id) {
        await recordUsage(business.id, 'ai_enhancement', {
          reviewId,
          enhancementType: 'review_regeneration',
          customPrompt: !!customPrompt
        });
      }

      res.json({
        success: true,
        message: 'Review regenerated successfully',
        data: aiGeneration
      });

    } catch (error) {
      console.error('Error regenerating review:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to regenerate review',
        error: error.message
      });
    }
  }
);

/**
 * @route GET /api/ai/reviews/:businessId
 * @description Get all AI enhanced reviews for a business
 * @access Private (Business Owner)
 */
router.get('/reviews/:businessId',
  verifyFirebaseToken,
  [
    param('businessId')
      .notEmpty()
      .withMessage('Business ID is required'),
    query('status')
      .optional()
      .isIn(['PENDING', 'APPROVED', 'REJECTED', 'REGENERATED'])
      .withMessage('Invalid status filter'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { businessId } = req.params;
      const { status, page = 1, limit = 20 } = req.query;

      // Find user
      const user = await firestoreDb.user.findByEmail(req.user.email);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Verify business belongs to user
      const business = await firestoreDb.business.findById(businessId);
      if (!business || business.userId !== user.id) {
        return res.status(404).json({
          success: false,
          message: 'Business not found or access denied'
        });
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      // Get AI generations for this business
      let aiGenerations = await firestoreDb.aiGeneration.findMany({
        where: { businessId }
      });

      // Filter by status if provided
      if (status) {
        aiGenerations = aiGenerations.filter(gen => gen.status === status);
      }

      // Sort by generatedAt descending
      aiGenerations.sort((a, b) => b.generatedAt - a.generatedAt);

      // Get total before pagination
      const total = aiGenerations.length;

      // Apply pagination
      const paginatedGenerations = aiGenerations.slice(skip, skip + parseInt(limit));

      // Enrich with review and customer data
      const enrichedGenerations = await Promise.all(paginatedGenerations.map(async (gen) => {
        const review = gen.reviewId ? await firestoreDb.review.findById(gen.reviewId) : null;
        const customer = review?.customerId ? await firestoreDb.customer.findById(review.customerId) : null;
        return {
          ...gen,
          review: review ? {
            ...review,
            customer: customer ? { id: customer.id, name: customer.name, email: customer.email } : null
          } : null
        };
      }));

      res.json({
        success: true,
        data: {
          aiGenerations: enrichedGenerations,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
          }
        }
      });

    } catch (error) {
      console.error('Error getting AI reviews:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get AI reviews',
        error: error.message
      });
    }
  }
);

/**
 * @route GET /api/ai/analytics/:businessId
 * @description Get AI usage analytics for a business
 * @access Private (Business Owner)
 */
router.get('/analytics/:businessId',
  verifyFirebaseToken,
  [
    param('businessId')
      .notEmpty()
      .withMessage('Business ID is required'),
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Start date must be a valid ISO 8601 date'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('End date must be a valid ISO 8601 date')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { businessId } = req.params;
      const { startDate, endDate } = req.query;

      // Find user
      const user = await firestoreDb.user.findByEmail(req.user.email);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Verify business belongs to user
      const business = await firestoreDb.business.findById(businessId);
      if (!business || business.userId !== user.id) {
        return res.status(404).json({
          success: false,
          message: 'Business not found or access denied'
        });
      }

      // Default to last 30 days if no dates provided
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      const analytics = await aiService.getAIAnalytics(businessId, start, end);

      res.json({
        success: true,
        data: analytics
      });

    } catch (error) {
      console.error('Error getting AI analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get AI analytics',
        error: error.message
      });
    }
  }
);

/**
 * Smart fallback enhancement when AI service is unavailable - with unlimited variation
 */
function generateSmartFallbackEnhancement(improvedText, businessContext = {}, variationParams = {}) {
  const businessName = businessContext.businessName || 'this business';
  const businessType = businessContext.businessType || 'establishment';
  
  // Extract variation parameters
  const { style = 'default', tone = 'friendly', uniqueApproach = 'balanced', variationLevel = 'medium', uniqueElements = {} } = variationParams;
  
  // Massive template variations for unlimited combinations
  const enhancementTemplates = {
    positive: {
      openings: [
        `I recently had the pleasure of visiting ${businessName}`, `Just finished an incredible experience at ${businessName}`,
        `I'm absolutely thrilled to share my visit to ${businessName}`, `Had the most wonderful time at ${businessName}`,
        `I was completely blown away by my experience at ${businessName}`, `Exceptional service at ${businessName}`,
        `I couldn't be more satisfied with ${businessName}`, `Outstanding experience from start to finish at ${businessName}`,
        `I'm delighted to write about my fantastic visit to ${businessName}`, `Genuinely impressed with ${businessName}`,
        `I had such a positive experience at ${businessName}`, `Really want to highlight the amazing service at ${businessName}`,
        `My visit to ${businessName} exceeded all expectations`, `I'm so grateful for the excellent experience at ${businessName}`
      ],
      middles: [
        `${improvedText} What really stood out was their genuine commitment to excellence`,
        `${improvedText} I was particularly impressed by their attention to detail`,
        `${improvedText} The level of professionalism here is truly remarkable`,
        `${improvedText} What I loved most was how they made everything feel personal`,
        `${improvedText} The quality of service really sets them apart from others`,
        `${improvedText} I was amazed by how they went above and beyond`,
        `${improvedText} The entire experience felt seamless and well-organized`,
        `${improvedText} What struck me was their genuine care for customer satisfaction`
      ],
      endings: [
        `I'll definitely be returning and highly recommend to everyone!`,
        `Five stars without hesitation - they've earned a loyal customer!`,
        `Already planning my next visit - absolutely worth it!`,
        `This is exactly what quality service looks like!`,
        `They've set the bar incredibly high for other businesses!`,
        `If you're looking for excellence, this is your place!`
      ]
    },
    neutral: [
      `I visited ${businessName} recently and wanted to share my thoughts. ${improvedText} The ${businessType.toLowerCase()} provides reliable service that meets expectations. Staff was professional and handled everything adequately. It's a solid, dependable choice for the area.`,
      `Had a decent experience at ${businessName}. ${improvedText} The service was consistent and the team was courteous. For a ${businessType.toLowerCase()}, it delivers what you'd expect. Good value and reliable option.`
    ],
    negative: [
      `I feel compelled to share my recent experience at ${businessName}. ${improvedText} Unfortunately, there are several areas that need attention. I hope the management considers this feedback constructively, as there's definitely potential for improvement.`,
      `My visit to ${businessName} left room for improvement. ${improvedText} While I don't enjoy writing critical reviews, I think honest feedback is important. With some adjustments, this ${businessType.toLowerCase()} could significantly enhance their service.`
    ]
  };
  
  // Generate unique combination using variation parameters
  const variationSeed = uniqueElements.variationId || Math.floor(Math.random() * 10000);
  const timeBasedSeed = Date.now() % 1000;
  
  // Enhanced sentiment detection
  const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'perfect', 'awesome', 'outstanding', 'nice', 'pleasant', 'satisfied', 'happy', 'impressed', 'recommend'];
  const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'disappointing', 'poor', 'worst', 'hate', 'disgusting', 'rude', 'slow', 'dirty', 'expensive', 'unsatisfied', 'frustrated'];
  
  const lowerText = improvedText.toLowerCase();
  const positiveCount = positiveWords.filter(word => lowerText.includes(word)).length;
  const negativeCount = negativeWords.filter(word => lowerText.includes(word)).length;
  
  let sentiment = 'neutral';
  if (positiveCount > negativeCount && positiveCount > 0) sentiment = 'positive';
  else if (negativeCount > positiveCount && negativeCount > 0) sentiment = 'negative';
  
  // Generate unique combination for positive reviews
  if (sentiment === 'positive' && enhancementTemplates.positive) {
    const templates = enhancementTemplates.positive;
    const openingIndex = (variationSeed + timeBasedSeed) % templates.openings.length;
    const middleIndex = (variationSeed * 2 + timeBasedSeed) % templates.middles.length;
    const endingIndex = (variationSeed * 3 + timeBasedSeed) % templates.endings.length;
    
    return `${templates.openings[openingIndex]}. ${templates.middles[middleIndex]}. ${templates.endings[endingIndex]}`;
  }
  
  // For neutral and negative, use existing templates with variation
  const templates = enhancementTemplates[sentiment] || enhancementTemplates.neutral;
  const selectedTemplate = templates[(variationSeed + timeBasedSeed) % templates.length];
  
  return selectedTemplate;
}

module.exports = router;