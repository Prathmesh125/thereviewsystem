const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');
const firestoreDb = require('./firestoreService');
const { validateReviewText } = require('../utils/textValidation');

class AIService {
  constructor() {
    // Initialize Google Gemini
    if (process.env.GEMINI_API_KEY) {
      this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.geminiModel = this.genAI.getGenerativeModel({ model: 'models/gemini-2.5-flash' });
    }
    
    // Initialize Anthropic Claude
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
    
    this.defaultModel = process.env.DEFAULT_AI_MODEL || 'gemini';
    this.claudeModel = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';
  }

  /**
   * Generate content using specified AI model
   */
  async generateContent(prompt, model = null) {
    const selectedModel = model || this.defaultModel;
    
    try {
      switch (selectedModel.toLowerCase()) {
        case 'claude':
        case 'anthropic':
          if (!this.anthropic) {
            throw new Error('Claude API key not configured');
          }
          
          const claudeResponse = await this.anthropic.messages.create({
            model: this.claudeModel,
            max_tokens: 1500,
            temperature: 0.7,
            messages: [
              {
                role: 'user',
                content: prompt
              }
            ]
          });
          
          return claudeResponse.content[0].text;
          
        case 'gemini':
        case 'google':
        default:
          if (!this.geminiModel) {
            throw new Error('Gemini API key not configured');
          }
          
          const geminiResult = await this.geminiModel.generateContent(prompt);
          return geminiResult.response.text();
      }
    } catch (error) {
      console.error(`Error generating content with ${selectedModel}:`, error);
      throw error;
    }
  }

  /**
   * Enhance a customer review using AI
   */
  async enhanceReview(reviewId, originalText, businessContext = {}, preferredModel = null) {
    const startTime = Date.now();
    let success = true;
    let errorMessage = null;
    
    try {
      console.log('🤖 Enhancing review with AI:', { reviewId, originalText });

      // Validate text quality before processing
      const textValidation = validateReviewText(originalText);
      if (!textValidation.isValid) {
        throw new Error(`Invalid review content: ${textValidation.errors.join(', ')}`);
      }

      // Get or create default prompt template
      const promptTemplate = await this.getPromptTemplate('REVIEW_ENHANCEMENT', businessContext.businessId);
      
      // Build the enhancement prompt
      const prompt = this.buildEnhancementPrompt(originalText, businessContext, promptTemplate);
      
      // Generate enhanced review using selected AI model
      const selectedModel = preferredModel || businessContext.preferredModel || this.defaultModel;
      const enhancedText = await this.generateContent(prompt, selectedModel);
      
      // Analyze sentiment and extract keywords
      const analysis = await this.analyzeReview(enhancedText);
      
      // Calculate confidence score
      const confidence = this.calculateConfidence(originalText, enhancedText);
      
      // Save AI generation record
      const aiGeneration = await firestoreDb.aiGeneration.create({
        reviewId,
        businessId: businessContext.businessId,
        originalText,
        enhancedText,
        confidence,
        sentiment: analysis.sentiment,
        keywords: JSON.stringify(analysis.keywords),
        improvements: JSON.stringify(analysis.improvements),
        status: 'PENDING',
        generatedAt: new Date()
      });

      // Update review status
      await firestoreDb.review.update(
        { id: reviewId },
        {
          generatedReview: enhancedText,
          status: 'AI_GENERATED'
        }
      );

      // Record usage analytics
      await this.recordUsage({
        businessId: businessContext.businessId,
        operation: 'REVIEW_ENHANCEMENT',
        tokensUsed: this.estimateTokens(prompt + enhancedText),
        responseTime: Date.now() - startTime,
        success: true
      });

      console.log('✅ Review enhanced successfully:', aiGeneration.id);
      return aiGeneration;

    } catch (error) {
      success = false;
      errorMessage = error.message;
      
      console.error('❌ Error enhancing review:', error);
      
      // Record failed usage
      await this.recordUsage({
        businessId: businessContext.businessId,
        operation: 'REVIEW_ENHANCEMENT',
        tokensUsed: 0,
        responseTime: Date.now() - startTime,
        success: false,
        errorMessage
      });

      throw new Error(`Failed to enhance review: ${error.message}`);
    }
  }

  /**
   * Analyze review sentiment and extract insights
   */
  async analyzeReview(reviewText) {
    try {
      const analysisPrompt = `
        Analyze the following review and provide:
        1. Sentiment (positive/negative/neutral)
        2. Key themes/keywords (max 5)
        3. Areas for improvement suggestions (max 3)
        
        Review: "${reviewText}"
        
        Respond in JSON format:
        {
          "sentiment": "positive|negative|neutral",
          "keywords": ["keyword1", "keyword2", ...],
          "improvements": ["improvement1", "improvement2", ...]
        }
      `;

      const response = await this.generateContent(analysisPrompt);
      
      // Parse JSON response
      const cleanedResponse = response.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleanedResponse);
      
    } catch (error) {
      console.error('Error analyzing review:', error);
      return {
        sentiment: 'neutral',
        keywords: [],
        improvements: []
      };
    }
  }

  /**
   * Build enhancement prompt with context
   */
  buildEnhancementPrompt(originalText, businessContext, template) {
    const basePrompt = template?.promptText || `
      You are a skilled content writer who helps customers express their experiences in a natural, human way that sounds authentic and genuine.
      
      CRITICAL REQUIREMENTS:
      - First, improve the user's original text: fix capitalization, grammar, and spelling naturally
      - Build the enhanced review around this improved text as the foundation
      - Make it sound like a real person wrote it - warm, personal, and conversational
      - Use natural speaking patterns that people actually use
      - Include personal elements: "I", "my experience", "I really", "I noticed"
      - Write like someone talking to a friend about their experience
      - Avoid corporate or overly polished language
      
      Human Writing Style:
      - Start personally: "I recently went to", "I had the chance to visit", "I stopped by"
      - Use natural expressions: "What struck me...", "I have to mention...", "The thing that stood out..."
      - Include genuine emotions: "I was really happy with...", "I was surprised by how...", "I felt like..."
      - Add relatable details that feel authentic and specific
      - Use everyday language and contractions (I'm, it's, they're, wasn't)
      - Vary sentence structure naturally - some short, some longer
      - End with honest recommendations from personal perspective
      
      Business Context:
      - Business Name: ${businessContext.businessName || 'the business'}
      - Business Type: ${businessContext.businessType || 'service provider'}
      - Industry: ${businessContext.industry || 'various services'}
      
      User's Original Words: "${originalText}"
      
      Transform this into a natural, human-sounding review that feels like a real customer sharing their genuine experience:
    `;

    return basePrompt;
  }

  /**
   * Get prompt template for specific category
   */
  async getPromptTemplate(category, businessId = null) {
    try {
      // First try to get business-specific template
      if (businessId) {
        const businessTemplate = await firestoreDb.promptTemplate.findFirst({
          businessId,
          category,
          isActive: true
        });
        if (businessTemplate) return businessTemplate;
      }

      // Fall back to default template
      const defaultTemplate = await firestoreDb.promptTemplate.findFirst({
        businessId: null,
        category,
        isDefault: true,
        isActive: true
      });

      return defaultTemplate;
    } catch (error) {
      console.error('Error getting prompt template:', error);
      return null;
    }
  }

  /**
   * Calculate confidence score for enhancement
   */
  calculateConfidence(original, enhanced) {
    // Simple confidence calculation based on:
    // - Length improvement
    // - Structural improvements
    // - Grammar corrections
    
    const originalWords = original.split(' ').length;
    const enhancedWords = enhanced.split(' ').length;
    
    let confidence = 0.7; // Base confidence
    
    // Bonus for reasonable length increase
    if (enhancedWords > originalWords && enhancedWords <= originalWords * 2) {
      confidence += 0.1;
    }
    
    // Bonus for capitalization and punctuation
    if (enhanced.includes('.') && enhanced[0] === enhanced[0].toUpperCase()) {
      confidence += 0.1;
    }
    
    // Cap confidence at 1.0
    return Math.min(confidence, 1.0);
  }

  /**
   * Estimate token usage for cost tracking
   */
  estimateTokens(text) {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Get available AI models
   */
  getAvailableModels() {
    const models = [];
    
    if (this.anthropic) {
      models.push({
        id: 'claude',
        name: 'Claude Sonnet 4.5',
        provider: 'Anthropic',
        description: 'Advanced language model with superior reasoning and creative writing',
        isDefault: this.defaultModel === 'claude'
      });
    }
    
    if (this.geminiModel) {
      models.push({
        id: 'gemini',
        name: 'Gemini 2.5 Flash',
        provider: 'Google',
        description: 'Fast and efficient language model for content generation',
        isDefault: this.defaultModel === 'gemini'
      });
    }
    
    return models;
  }

  /**
   * Set default AI model for all clients
   */
  async setDefaultModel(modelId) {
    const availableModels = this.getAvailableModels();
    const model = availableModels.find(m => m.id === modelId);
    
    if (!model) {
      throw new Error(`Model '${modelId}' is not available or configured`);
    }
    
    this.defaultModel = modelId;
    
    // Update environment variable (Note: This would require server restart in production)
    process.env.DEFAULT_AI_MODEL = modelId;
    
    console.log(`✅ Default AI model set to: ${model.name} (${model.provider})`);
    return model;
  }

  /**
   * Record AI usage analytics
   */
  async recordUsage(data) {
    try {
      await firestoreDb.aiUsageAnalytics.create(data);
    } catch (error) {
      console.error('Error recording AI usage:', error);
    }
  }

  /**
   * Approve AI generated review
   */
  async approveReview(reviewId, approvedBy) {
    try {
      const aiGeneration = await firestoreDb.aiGeneration.findByReviewId(reviewId);
      if (!aiGeneration) {
        throw new Error('AI generation not found');
      }

      const updatedGeneration = await firestoreDb.aiGeneration.update(
        { id: aiGeneration.id },
        {
          status: 'APPROVED',
          approvedBy,
          approvedAt: new Date()
        }
      );

      await firestoreDb.review.update(
        { id: reviewId },
        { status: 'APPROVED' }
      );

      return updatedGeneration;
    } catch (error) {
      console.error('Error approving review:', error);
      throw new Error('Failed to approve review');
    }
  }

  /**
   * Reject AI generated review
   */
  async rejectReview(reviewId, rejectionNote) {
    try {
      const aiGeneration = await firestoreDb.aiGeneration.findByReviewId(reviewId);
      if (!aiGeneration) {
        throw new Error('AI generation not found');
      }

      const updatedGeneration = await firestoreDb.aiGeneration.update(
        { id: aiGeneration.id },
        {
          status: 'REJECTED',
          rejectionNote
        }
      );

      await firestoreDb.review.update(
        { id: reviewId },
        { status: 'PENDING' }
      );

      return updatedGeneration;
    } catch (error) {
      console.error('Error rejecting review:', error);
      throw new Error('Failed to reject review');
    }
  }

  /**
   * Regenerate review with different approach
   */
  async regenerateReview(reviewId, customPrompt = null) {
    try {
      const review = await firestoreDb.review.findById(reviewId);
      if (!review) {
        throw new Error('Review not found');
      }

      const business = await firestoreDb.business.findById(review.businessId);
      if (!business) {
        throw new Error('Business not found');
      }

      // Mark previous generation as regenerated
      const existingGeneration = await firestoreDb.aiGeneration.findByReviewId(reviewId);
      if (existingGeneration) {
        await firestoreDb.aiGeneration.update(
          { id: existingGeneration.id },
          { status: 'REGENERATED' }
        );
      }

      // Generate new version
      const businessContext = {
        businessId: review.businessId,
        businessName: business.name,
        businessType: business.type
      };

      return await this.enhanceReview(reviewId, review.feedbackText, businessContext);
    } catch (error) {
      console.error('Error regenerating review:', error);
      throw new Error('Failed to regenerate review');
    }
  }

  /**
   * Get AI analytics for business
   */
  async getAIAnalytics(businessId, startDate, endDate) {
    try {
      // Get all usage analytics for the business in the date range
      const allUsage = await firestoreDb.aiUsageAnalytics.findMany({
        where: { businessId }
      });

      // Filter by date range
      const filteredUsage = allUsage.filter(usage => {
        const createdAt = usage.createdAt;
        return createdAt >= startDate && createdAt <= endDate;
      });

      // Group by operation
      const operationStats = {};
      filteredUsage.forEach(usage => {
        const op = usage.operation;
        if (!operationStats[op]) {
          operationStats[op] = {
            operation: op,
            count: 0,
            totalTokens: 0,
            totalResponseTime: 0
          };
        }
        operationStats[op].count++;
        operationStats[op].totalTokens += usage.tokensUsed || 0;
        operationStats[op].totalResponseTime += usage.responseTime || 0;
      });

      // Calculate success rate
      const successCount = filteredUsage.filter(u => u.success).length;
      const failureCount = filteredUsage.filter(u => !u.success).length;

      return {
        operationStats: Object.values(operationStats).map(stat => ({
          operation: stat.operation,
          _count: { id: stat.count },
          _sum: { tokensUsed: stat.totalTokens },
          _avg: { responseTime: stat.count > 0 ? stat.totalResponseTime / stat.count : 0 }
        })),
        successRate: [
          { success: true, _count: { id: successCount } },
          { success: false, _count: { id: failureCount } }
        ],
        totalUsage: filteredUsage.length,
        totalCost: 0 // Estimated cost - can be calculated based on token usage
      };
    } catch (error) {
      console.error('Error getting AI analytics:', error);
      throw new Error('Failed to get AI analytics');
    }
  }
}

module.exports = new AIService();
