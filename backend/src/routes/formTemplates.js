const express = require('express');
const { body, param, validationResult } = require('express-validator');
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

// GET /api/form-templates - Get all form templates for user's business
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

    const templates = await firestoreDb.formTemplate.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' }
    });

    // Get fields for each template
    const templatesWithFields = await Promise.all(templates.map(async (template) => {
      const fields = await firestoreDb.formField.findByTemplateId(template.id);
      return {
        ...template,
        fields,
        business: {
          id: business.id,
          name: business.name,
          brandColor: business.brandColor
        }
      };
    }));

    res.json(templatesWithFields);
  } catch (error) {
    console.error('Error fetching form templates:', error);
    res.status(500).json({ error: 'Failed to fetch form templates' });
  }
});

// GET /api/form-templates/public/:businessId - Get active form template for business (public)
router.get('/public/:businessId',
  [param('businessId').isString().isLength({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { businessId } = req.params;

      const business = await firestoreDb.business.findById(businessId);
      if (!business) {
        return res.status(404).json({ error: 'Business not found' });
      }

      // Find active template for this business
      const template = await firestoreDb.formTemplate.findFirst({
        businessId,
        isActive: true
      });

      if (!template) {
        // Return default template structure if no custom template exists
        return res.json({
          id: null,
          name: 'Default Review Form',
          isActive: true,
          fields: [
            {
              id: 'default-rating',
              fieldType: 'rating',
              label: 'Overall Rating',
              isRequired: true,
              order: 0
            },
            {
              id: 'default-feedback',
              fieldType: 'textarea',
              label: 'Your Feedback',
              placeholder: 'Tell us about your experience...',
              isRequired: false,
              order: 1
            }
          ],
          business: {
            id: business.id,
            name: business.name,
            type: business.type,
            brandColor: business.brandColor,
            logo: business.logo,
            logoUrl: business.logoUrl,
            customMessage: business.customMessage,
            googleReviewUrl: business.googleReviewUrl,
            enableSmartFilter: business.enableSmartFilter
          }
        });
      }

      const fields = await firestoreDb.formField.findByTemplateId(template.id);

      res.json({
        ...template,
        fields: fields.sort((a, b) => a.order - b.order),
        business: {
          id: business.id,
          name: business.name,
          type: business.type,
          brandColor: business.brandColor,
          logo: business.logo,
          logoUrl: business.logoUrl,
          customMessage: business.customMessage,
          googleReviewUrl: business.googleReviewUrl,
          enableSmartFilter: business.enableSmartFilter
        }
      });
    } catch (error) {
      console.error('Error fetching public form template:', error);
      res.status(500).json({ error: 'Failed to fetch form template' });
    }
  }
);

// POST /api/form-templates - Create new form template
router.post('/',
  verifyFirebaseToken,
  [
    body('name').trim().isLength({ min: 1, max: 100 }),
    body('description').optional().trim().isLength({ max: 500 }),
    body('headerText').optional().trim(),
    body('submitButtonText').optional().trim(),
    body('thankYouMessage').optional().trim(),
    body('redirectUrl').optional().isURL(),
    body('fields').optional().isArray()
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
        name,
        description,
        headerText = 'We value your feedback!',
        submitButtonText = 'Submit Review',
        thankYouMessage = 'Thank you for your review!',
        redirectUrl,
        fields = []
      } = req.body;

      // Check if this is the first template for this business - auto-activate it
      const existingTemplates = await firestoreDb.formTemplate.findMany({
        where: { businessId: business.id }
      });
      const shouldAutoActivate = existingTemplates.length === 0;

      // Create template
      const template = await firestoreDb.formTemplate.create({
        businessId: business.id,
        name,
        description,
        headerText,
        submitButtonText,
        thankYouMessage,
        redirectUrl,
        isActive: shouldAutoActivate
      });

      // Create fields
      const createdFields = await Promise.all(fields.map(async (field, index) => {
        return await firestoreDb.formField.create({
          templateId: template.id,
          fieldType: field.fieldType,
          label: field.label,
          placeholder: field.placeholder,
          isRequired: field.isRequired || false,
          options: field.options ? JSON.stringify(field.options) : null,
          order: field.order ?? index,
          minRating: field.minRating,
          maxRating: field.maxRating,
          minLength: field.minLength,
          maxLength: field.maxLength
        });
      }));

      res.status(201).json({
        ...template,
        fields: createdFields,
        business: {
          id: business.id,
          name: business.name,
          brandColor: business.brandColor
        }
      });
    } catch (error) {
      console.error('Error creating form template:', error);
      res.status(500).json({ error: error.message || 'Failed to create form template' });
    }
  }
);

// GET /api/form-templates/:id - Get specific form template
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

      const template = await firestoreDb.formTemplate.findById(id);
      
      if (!template) {
        return res.status(404).json({ error: 'Form template not found' });
      }

      if (template.businessId !== business.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const fields = await firestoreDb.formField.findByTemplateId(id);

      res.json({
        ...template,
        fields: fields.sort((a, b) => a.order - b.order),
        business: {
          id: business.id,
          name: business.name,
          brandColor: business.brandColor
        }
      });
    } catch (error) {
      console.error('Error fetching form template:', error);
      res.status(500).json({ error: 'Failed to fetch form template' });
    }
  }
);

// PUT /api/form-templates/:id - Update form template
router.put('/:id',
  verifyFirebaseToken,
  [
    param('id').isString().isLength({ min: 1 }),
    body('name').optional().trim().isLength({ min: 1, max: 100 }),
    body('description').optional().trim().isLength({ max: 500 }),
    body('headerText').optional().trim(),
    body('submitButtonText').optional().trim(),
    body('thankYouMessage').optional().trim(),
    body('redirectUrl').optional(),
    body('isActive').optional().isBoolean(),
    body('fields').optional().isArray()
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

      const existingTemplate = await firestoreDb.formTemplate.findById(id);
      
      if (!existingTemplate) {
        return res.status(404).json({ error: 'Form template not found' });
      }

      if (existingTemplate.businessId !== business.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const { fields, ...templateUpdates } = req.body;

      // If activating this template, deactivate others
      if (templateUpdates.isActive === true) {
        const allTemplates = await firestoreDb.formTemplate.findMany({
          where: { businessId: business.id }
        });
        
        for (const t of allTemplates) {
          if (t.id !== id && t.isActive) {
            await firestoreDb.formTemplate.update({ id: t.id }, { isActive: false });
          }
        }
      }

      // Update template
      const updatedTemplate = await firestoreDb.formTemplate.update({ id }, templateUpdates);

      // Update fields if provided
      let updatedFields = [];
      if (fields && Array.isArray(fields)) {
        // Delete existing fields
        await firestoreDb.formField.deleteByTemplateId(id);

        // Create new fields
        updatedFields = await Promise.all(fields.map(async (field, index) => {
          return await firestoreDb.formField.create({
            templateId: id,
            fieldType: field.fieldType,
            label: field.label,
            placeholder: field.placeholder,
            isRequired: field.isRequired || false,
            options: field.options ? JSON.stringify(field.options) : null,
            order: field.order ?? index,
            minRating: field.minRating,
            maxRating: field.maxRating,
            minLength: field.minLength,
            maxLength: field.maxLength
          });
        }));
      } else {
        updatedFields = await firestoreDb.formField.findByTemplateId(id);
      }

      res.json({
        ...updatedTemplate,
        fields: updatedFields.sort((a, b) => a.order - b.order),
        business: {
          id: business.id,
          name: business.name,
          brandColor: business.brandColor
        }
      });
    } catch (error) {
      console.error('Error updating form template:', error);
      res.status(500).json({ error: error.message || 'Failed to update form template' });
    }
  }
);

// DELETE /api/form-templates/:id - Delete form template
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

      const existingTemplate = await firestoreDb.formTemplate.findById(id);
      
      if (!existingTemplate) {
        return res.status(404).json({ error: 'Form template not found' });
      }

      if (existingTemplate.businessId !== business.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Delete fields first
      await firestoreDb.formField.deleteByTemplateId(id);
      
      // Delete template
      await firestoreDb.formTemplate.delete({ id });

      res.json({ success: true, message: 'Form template deleted successfully' });
    } catch (error) {
      console.error('Error deleting form template:', error);
      res.status(500).json({ error: error.message || 'Failed to delete form template' });
    }
  }
);

// POST /api/form-templates/:id/duplicate - Duplicate form template
router.post('/:id/duplicate',
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

      const existingTemplate = await firestoreDb.formTemplate.findById(id);
      
      if (!existingTemplate) {
        return res.status(404).json({ error: 'Form template not found' });
      }

      if (existingTemplate.businessId !== business.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Create duplicate template
      const { id: _, createdAt, updatedAt, ...templateData } = existingTemplate;
      const newTemplate = await firestoreDb.formTemplate.create({
        ...templateData,
        name: `${existingTemplate.name} (Copy)`,
        isActive: false
      });

      // Duplicate fields
      const existingFields = await firestoreDb.formField.findByTemplateId(id);
      const newFields = await Promise.all(existingFields.map(async (field) => {
        const { id: fieldId, templateId, createdAt, updatedAt, ...fieldData } = field;
        return await firestoreDb.formField.create({
          ...fieldData,
          templateId: newTemplate.id
        });
      }));

      res.status(201).json({
        ...newTemplate,
        fields: newFields.sort((a, b) => a.order - b.order),
        business: {
          id: business.id,
          name: business.name,
          brandColor: business.brandColor
        }
      });
    } catch (error) {
      console.error('Error duplicating form template:', error);
      res.status(500).json({ error: error.message || 'Failed to duplicate form template' });
    }
  }
);

// POST /api/form-templates/:id/activate - Activate form template
router.post('/:id/activate',
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

      const existingTemplate = await firestoreDb.formTemplate.findById(id);
      
      if (!existingTemplate) {
        return res.status(404).json({ error: 'Form template not found' });
      }

      if (existingTemplate.businessId !== business.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Deactivate all other templates for this business
      const allTemplates = await firestoreDb.formTemplate.findMany({
        where: { businessId: business.id }
      });
      
      for (const t of allTemplates) {
        if (t.id !== id && t.isActive) {
          await firestoreDb.formTemplate.update({ id: t.id }, { isActive: false });
        }
      }

      // Activate this template
      const updatedTemplate = await firestoreDb.formTemplate.update({ id }, { isActive: true });

      const fields = await firestoreDb.formField.findByTemplateId(id);

      res.json({
        ...updatedTemplate,
        fields: fields.sort((a, b) => a.order - b.order),
        business: {
          id: business.id,
          name: business.name,
          brandColor: business.brandColor
        }
      });
    } catch (error) {
      console.error('Error activating form template:', error);
      res.status(500).json({ error: error.message || 'Failed to activate form template' });
    }
  }
);

module.exports = router;
