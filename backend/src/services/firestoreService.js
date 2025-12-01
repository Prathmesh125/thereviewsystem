/**
 * Firestore Database Service
 * Replaces Prisma ORM with Firebase Firestore operations
 */

const { db, admin } = require('../config/firebase');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

// Collection names
const COLLECTIONS = {
  USERS: 'users',
  BUSINESSES: 'businesses',
  CUSTOMERS: 'customers',
  REVIEWS: 'reviews',
  QR_CODES: 'qrCodes',
  QR_SCANS: 'qrScans',
  FORM_TEMPLATES: 'formTemplates',
  FORM_FIELDS: 'formFields',
  AI_REVIEW_GENERATIONS: 'aiReviewGenerations',
  AI_PROMPT_TEMPLATES: 'aiPromptTemplates',
  AI_USAGE_ANALYTICS: 'aiUsageAnalytics',
  BUSINESS_GOALS: 'businessGoals',
  BUSINESS_MILESTONES: 'businessMilestones',
  BUSINESS_INSIGHTS: 'businessInsights',
  INDUSTRY_BENCHMARKS: 'industryBenchmarks',
  SUBSCRIPTIONS: 'subscriptions',
  SYSTEM_ANALYTICS: 'systemAnalytics'
};

// Helper function to generate unique IDs
const generateId = () => {
  return db.collection('_temp').doc().id;
};

// Helper to convert Firestore timestamp to Date
const toDate = (timestamp) => {
  if (!timestamp) return null;
  if (timestamp.toDate) return timestamp.toDate();
  if (timestamp instanceof Date) return timestamp;
  return new Date(timestamp);
};

// Helper to prepare data for Firestore (convert dates, etc.)
const prepareForFirestore = (data) => {
  const prepared = { ...data };
  // Remove undefined values
  Object.keys(prepared).forEach(key => {
    if (prepared[key] === undefined) {
      delete prepared[key];
    }
  });
  return prepared;
};

// Helper to format document with dates
const formatDoc = (doc) => {
  if (!doc.exists) return null;
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt)
  };
};

/**
 * Generic query executor that avoids composite index requirements
 * by sorting in-memory when both where and orderBy are used
 */
const executeQuery = async (collectionName, options = {}) => {
  let query = db.collection(collectionName);
  let hasWhereClause = false;
  let orderByField = null;
  let orderByDirection = 'asc';
  
  // Apply where conditions
  if (options.where) {
    Object.entries(options.where).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        hasWhereClause = true;
        if (typeof value === 'object') {
          if (value.in) {
            query = query.where(key, 'in', value.in);
          } else if (value.gte !== undefined) {
            query = query.where(key, '>=', value.gte);
          } else if (value.lte !== undefined) {
            query = query.where(key, '<=', value.lte);
          } else if (value.gt !== undefined) {
            query = query.where(key, '>', value.gt);
          } else if (value.lt !== undefined) {
            query = query.where(key, '<', value.lt);
          } else {
            query = query.where(key, '==', value);
          }
        } else {
          query = query.where(key, '==', value);
        }
      }
    });
  }
  
  // Store orderBy for later in-memory sorting if there's a where clause
  if (options.orderBy) {
    const entries = Object.entries(options.orderBy);
    if (entries.length > 0) {
      const [field, direction] = entries[0];
      orderByField = field;
      orderByDirection = direction === 'desc' ? 'desc' : 'asc';
      
      // Only use Firestore orderBy if there's no where clause (no composite index needed)
      if (!hasWhereClause) {
        query = query.orderBy(field, orderByDirection);
      }
    }
  }
  
  // Apply limit only if no in-memory sorting is needed
  if (options.take && !hasWhereClause) {
    query = query.limit(options.take);
  }
  
  const snapshot = await query.get();
  let results = snapshot.docs.map(formatDoc);
  
  // Sort in memory if we have both where and orderBy
  if (hasWhereClause && orderByField) {
    results.sort((a, b) => {
      const aVal = a[orderByField];
      const bVal = b[orderByField];
      
      if (aVal instanceof Date && bVal instanceof Date) {
        return orderByDirection === 'desc' ? bVal - aVal : aVal - bVal;
      }
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return orderByDirection === 'desc' 
          ? bVal.localeCompare(aVal) 
          : aVal.localeCompare(bVal);
      }
      
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return orderByDirection === 'desc' ? 1 : -1;
      if (bVal == null) return orderByDirection === 'desc' ? -1 : 1;
      
      if (orderByDirection === 'desc') {
        return bVal > aVal ? 1 : -1;
      }
      return aVal > bVal ? 1 : -1;
    });
  }
  
  // Apply limit after sorting if needed
  if (options.take && hasWhereClause && results.length > options.take) {
    results = results.slice(0, options.take);
  }
  
  // Apply skip
  if (options.skip && results.length > options.skip) {
    results = results.slice(options.skip);
  }
  
  return results;
};

// ==================== USER OPERATIONS ====================

const userService = {
  async findById(id) {
    const doc = await db.collection(COLLECTIONS.USERS).doc(id).get();
    return formatDoc(doc);
  },

  async findByEmail(email) {
    const snapshot = await db.collection(COLLECTIONS.USERS)
      .where('email', '==', email)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    return formatDoc(snapshot.docs[0]);
  },

  async findUnique(where) {
    if (where.id) return this.findById(where.id);
    if (where.email) return this.findByEmail(where.email);
    return null;
  },

  async create(data) {
    const id = data.id || generateId();
    const now = Timestamp.now();
    const userData = prepareForFirestore({
      ...data,
      id,
      role: data.role || 'BUSINESS_OWNER',
      isActive: data.isActive !== false,
      createdAt: now,
      updatedAt: now
    });
    await db.collection(COLLECTIONS.USERS).doc(id).set(userData);
    return { id, ...userData, createdAt: toDate(now), updatedAt: toDate(now) };
  },

  async update(whereOrId, data) {
    // Handle both update(id, data) and update({id: id}, data) formats
    let userId;
    if (typeof whereOrId === 'string') {
      userId = whereOrId;
    } else if (typeof whereOrId === 'object' && whereOrId.id) {
      userId = whereOrId.id;
    } else {
      const user = await this.findUnique(whereOrId);
      if (!user) throw new Error('User not found');
      userId = user.id;
    }
    
    const existingUser = await this.findById(userId);
    if (!existingUser) throw new Error('User not found');
    
    const updateData = prepareForFirestore({
      ...data,
      updatedAt: Timestamp.now()
    });
    await db.collection(COLLECTIONS.USERS).doc(userId).update(updateData);
    return { ...existingUser, ...updateData, updatedAt: new Date() };
  },

  async delete(where) {
    const user = await this.findUnique(where);
    if (!user) throw new Error('User not found');
    await db.collection(COLLECTIONS.USERS).doc(user.id).delete();
    return user;
  },

  async findMany(options = {}) {
    // Handle special case for 'contains' search (Firestore prefix search)
    if (options.where) {
      const containsKeys = Object.entries(options.where).filter(([_, v]) => 
        typeof v === 'object' && v?.contains
      );
      
      if (containsKeys.length > 0) {
        // For contains search, we need custom logic
        let query = db.collection(COLLECTIONS.USERS);
        const [key, value] = containsKeys[0];
        query = query.where(key, '>=', value.contains)
                     .where(key, '<=', value.contains + '\uf8ff');
        
        // Handle other where conditions manually
        const snapshot = await query.get();
        let results = snapshot.docs.map(formatDoc);
        
        // Apply other filters in memory
        Object.entries(options.where).forEach(([k, v]) => {
          if (k !== key && v !== undefined && !(typeof v === 'object' && v?.contains)) {
            results = results.filter(doc => doc[k] === v);
          }
        });
        
        return results;
      }
    }
    
    return executeQuery(COLLECTIONS.USERS, options);
  },

  async findAll() {
    const snapshot = await db.collection(COLLECTIONS.USERS).get();
    return snapshot.docs.map(formatDoc);
  },

  async count(where = {}) {
    let query = db.collection(COLLECTIONS.USERS);
    Object.entries(where).forEach(([key, value]) => {
      if (value !== undefined) {
        query = query.where(key, '==', value);
      }
    });
    const snapshot = await query.count().get();
    return snapshot.data().count;
  },

  async countAll() {
    const snapshot = await db.collection(COLLECTIONS.USERS).count().get();
    return snapshot.data().count;
  }
};

// ==================== BUSINESS OPERATIONS ====================

const businessService = {
  async findById(id) {
    const doc = await db.collection(COLLECTIONS.BUSINESSES).doc(id).get();
    return formatDoc(doc);
  },

  async findUnique(where) {
    if (where.id) return this.findById(where.id);
    return null;
  },

  async findFirst(where) {
    let query = db.collection(COLLECTIONS.BUSINESSES);
    
    Object.entries(where).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        query = query.where(key, '==', value);
      }
    });
    
    const snapshot = await query.limit(1).get();
    if (snapshot.empty) return null;
    return formatDoc(snapshot.docs[0]);
  },

  async create(data) {
    const id = generateId();
    const now = Timestamp.now();
    const businessData = prepareForFirestore({
      ...data,
      id,
      brandColor: data.brandColor || '#3B82F6',
      isPublished: data.isPublished !== false,
      enableSmartFilter: data.enableSmartFilter || false,
      createdAt: now,
      updatedAt: now
    });
    await db.collection(COLLECTIONS.BUSINESSES).doc(id).set(businessData);
    return { id, ...businessData, createdAt: toDate(now), updatedAt: toDate(now) };
  },

  async update(whereOrId, data) {
    // Handle both update(id, data) and update({id: id}, data) formats
    let businessId;
    if (typeof whereOrId === 'string') {
      businessId = whereOrId;
    } else if (typeof whereOrId === 'object' && whereOrId.id) {
      businessId = whereOrId.id;
    } else {
      throw new Error('Invalid business identifier');
    }
    
    const business = await this.findById(businessId);
    if (!business) throw new Error('Business not found');
    
    const updateData = prepareForFirestore({
      ...data,
      updatedAt: Timestamp.now()
    });
    await db.collection(COLLECTIONS.BUSINESSES).doc(businessId).update(updateData);
    return { ...business, ...updateData, updatedAt: new Date() };
  },

  async delete(whereOrId) {
    // Handle both delete(id) and delete({id: id}) formats
    let businessId;
    if (typeof whereOrId === 'string') {
      businessId = whereOrId;
    } else if (typeof whereOrId === 'object' && whereOrId.id) {
      businessId = whereOrId.id;
    } else {
      throw new Error('Invalid business identifier');
    }
    
    const business = await this.findById(businessId);
    if (!business) throw new Error('Business not found');
    await db.collection(COLLECTIONS.BUSINESSES).doc(businessId).delete();
    return business;
  },

  async findMany(options = {}) {
    return executeQuery(COLLECTIONS.BUSINESSES, options);
  },

  async count(where = {}) {
    let query = db.collection(COLLECTIONS.BUSINESSES);
    Object.entries(where).forEach(([key, value]) => {
      if (value !== undefined) {
        query = query.where(key, '==', value);
      }
    });
    const snapshot = await query.count().get();
    return snapshot.data().count;
  },

  async findAll() {
    const snapshot = await db.collection(COLLECTIONS.BUSINESSES).get();
    return snapshot.docs.map(formatDoc);
  },

  async countAll() {
    const snapshot = await db.collection(COLLECTIONS.BUSINESSES).count().get();
    return snapshot.data().count;
  },

  // Get business with related counts
  async findWithCounts(id) {
    const business = await this.findById(id);
    if (!business) return null;
    
    const [customersCount, reviewsCount, qrCodesCount] = await Promise.all([
      customerService.count({ businessId: id }),
      reviewService.count({ businessId: id }),
      qrCodeService.count({ businessId: id })
    ]);
    
    return {
      ...business,
      _count: {
        customers: customersCount,
        reviews: reviewsCount,
        qrCodes: qrCodesCount
      }
    };
  }
};

// ==================== CUSTOMER OPERATIONS ====================

const customerService = {
  async findById(id) {
    const doc = await db.collection(COLLECTIONS.CUSTOMERS).doc(id).get();
    return formatDoc(doc);
  },

  async findUnique(where) {
    if (where.id) return this.findById(where.id);
    return null;
  },

  async findFirst(where) {
    let query = db.collection(COLLECTIONS.CUSTOMERS);
    Object.entries(where).forEach(([key, value]) => {
      if (value !== undefined) {
        if (typeof value === 'object' && value.in) {
          query = query.where(key, 'in', value.in);
        } else {
          query = query.where(key, '==', value);
        }
      }
    });
    const snapshot = await query.limit(1).get();
    if (snapshot.empty) return null;
    return formatDoc(snapshot.docs[0]);
  },

  async create(data) {
    const id = generateId();
    const now = Timestamp.now();
    const customerData = prepareForFirestore({
      ...data,
      id,
      createdAt: now
    });
    await db.collection(COLLECTIONS.CUSTOMERS).doc(id).set(customerData);
    return { id, ...customerData, createdAt: toDate(now) };
  },

  async update(where, data) {
    const customer = await this.findUnique(where);
    if (!customer) throw new Error('Customer not found');
    
    const updateData = prepareForFirestore(data);
    await db.collection(COLLECTIONS.CUSTOMERS).doc(customer.id).update(updateData);
    return { ...customer, ...updateData };
  },

  async updateMany(where, data) {
    const customers = await this.findMany({ where });
    const batch = db.batch();
    
    customers.forEach(customer => {
      const ref = db.collection(COLLECTIONS.CUSTOMERS).doc(customer.id);
      batch.update(ref, prepareForFirestore(data));
    });
    
    await batch.commit();
    return { count: customers.length };
  },

  async delete(where) {
    const customer = await this.findUnique(where);
    if (!customer) throw new Error('Customer not found');
    await db.collection(COLLECTIONS.CUSTOMERS).doc(customer.id).delete();
    return customer;
  },

  async deleteMany(where) {
    const customers = await this.findMany({ where });
    const batch = db.batch();
    
    customers.forEach(customer => {
      const ref = db.collection(COLLECTIONS.CUSTOMERS).doc(customer.id);
      batch.delete(ref);
    });
    
    await batch.commit();
    return { count: customers.length };
  },

  async findMany(options = {}) {
    return executeQuery(COLLECTIONS.CUSTOMERS, options);
  },

  async count(where = {}) {
    let query = db.collection(COLLECTIONS.CUSTOMERS);
    Object.entries(where).forEach(([key, value]) => {
      if (value !== undefined) {
        query = query.where(key, '==', value);
      }
    });
    const snapshot = await query.count().get();
    return snapshot.data().count;
  },

  async findAll() {
    const snapshot = await db.collection(COLLECTIONS.CUSTOMERS).get();
    return snapshot.docs.map(formatDoc);
  },

  async countAll() {
    const snapshot = await db.collection(COLLECTIONS.CUSTOMERS).count().get();
    return snapshot.data().count;
  }
};

// ==================== REVIEW OPERATIONS ====================

const reviewService = {
  async findById(id) {
    const doc = await db.collection(COLLECTIONS.REVIEWS).doc(id).get();
    return formatDoc(doc);
  },

  async findUnique(where) {
    if (where.id) return this.findById(where.id);
    return null;
  },

  async findFirst(where) {
    let query = db.collection(COLLECTIONS.REVIEWS);
    Object.entries(where).forEach(([key, value]) => {
      if (value !== undefined) {
        query = query.where(key, '==', value);
      }
    });
    const snapshot = await query.limit(1).get();
    if (snapshot.empty) return null;
    return formatDoc(snapshot.docs[0]);
  },

  async create(data) {
    const id = generateId();
    const now = Timestamp.now();
    const reviewData = prepareForFirestore({
      ...data,
      id,
      status: data.status || 'PENDING',
      submissionStep: data.submissionStep || 'SUBMITTED',
      createdAt: now,
      updatedAt: now
    });
    await db.collection(COLLECTIONS.REVIEWS).doc(id).set(reviewData);
    return { id, ...reviewData, createdAt: toDate(now), updatedAt: toDate(now) };
  },

  async update(where, data) {
    const review = await this.findUnique(where);
    if (!review) throw new Error('Review not found');
    
    const updateData = prepareForFirestore({
      ...data,
      updatedAt: Timestamp.now()
    });
    await db.collection(COLLECTIONS.REVIEWS).doc(review.id).update(updateData);
    return { ...review, ...updateData, updatedAt: new Date() };
  },

  async delete(where) {
    const review = await this.findUnique(where);
    if (!review) throw new Error('Review not found');
    await db.collection(COLLECTIONS.REVIEWS).doc(review.id).delete();
    return review;
  },

  async deleteMany(where) {
    const reviews = await this.findMany({ where });
    const batch = db.batch();
    
    reviews.forEach(review => {
      const ref = db.collection(COLLECTIONS.REVIEWS).doc(review.id);
      batch.delete(ref);
    });
    
    await batch.commit();
    return { count: reviews.length };
  },

  async findMany(options = {}) {
    // Handle date range queries which are common for reviews
    if (options.where) {
      const whereKeys = Object.keys(options.where);
      const hasDateRange = whereKeys.some(k => {
        const v = options.where[k];
        return typeof v === 'object' && (v.gte || v.lte);
      });
      
      if (hasDateRange) {
        // Convert date values to Timestamp
        const convertedWhere = {};
        Object.entries(options.where).forEach(([key, value]) => {
          if (typeof value === 'object' && (value.gte || value.lte)) {
            convertedWhere[key] = {};
            if (value.gte) {
              convertedWhere[key].gte = value.gte instanceof Date ? Timestamp.fromDate(value.gte) : value.gte;
            }
            if (value.lte) {
              convertedWhere[key].lte = value.lte instanceof Date ? Timestamp.fromDate(value.lte) : value.lte;
            }
          } else {
            convertedWhere[key] = value;
          }
        });
        options = { ...options, where: convertedWhere };
      }
    }
    
    return executeQuery(COLLECTIONS.REVIEWS, options);
  },

  async count(where = {}) {
    let query = db.collection(COLLECTIONS.REVIEWS);
    Object.entries(where).forEach(([key, value]) => {
      if (value !== undefined) {
        if (typeof value === 'object' && value.gte) {
          query = query.where(key, '>=', value.gte instanceof Date ? Timestamp.fromDate(value.gte) : value.gte);
        } else if (typeof value === 'object' && value.lte) {
          query = query.where(key, '<=', value.lte instanceof Date ? Timestamp.fromDate(value.lte) : value.lte);
        } else {
          query = query.where(key, '==', value);
        }
      }
    });
    const snapshot = await query.count().get();
    return snapshot.data().count;
  },

  async findAll() {
    const snapshot = await db.collection(COLLECTIONS.REVIEWS).get();
    return snapshot.docs.map(formatDoc);
  },

  async countAll() {
    const snapshot = await db.collection(COLLECTIONS.REVIEWS).count().get();
    return snapshot.data().count;
  },

  async aggregate(where = {}) {
    const reviews = await this.findMany({ where });
    const ratings = reviews.map(r => r.rating).filter(r => r != null);
    return {
      _avg: {
        rating: ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null
      },
      _count: reviews.length
    };
  },

  async groupBy(options = {}) {
    const reviews = await this.findMany({ where: options.where });
    const groups = {};
    
    reviews.forEach(review => {
      const key = options.by.map(field => review[field]).join('_');
      if (!groups[key]) {
        groups[key] = { _count: 0 };
        options.by.forEach(field => {
          groups[key][field] = review[field];
        });
      }
      groups[key]._count++;
    });
    
    return Object.values(groups);
  }
};

// ==================== QR CODE OPERATIONS ====================

const qrCodeService = {
  async findById(id) {
    const doc = await db.collection(COLLECTIONS.QR_CODES).doc(id).get();
    return formatDoc(doc);
  },

  async findUnique(where) {
    if (where.id) return this.findById(where.id);
    return null;
  },

  async create(data) {
    const id = generateId();
    const now = Timestamp.now();
    const qrCodeData = prepareForFirestore({
      ...data,
      id,
      scansCount: data.scansCount || 0,
      isActive: data.isActive !== false,
      backgroundColor: data.backgroundColor || '#FFFFFF',
      foregroundColor: data.foregroundColor || '#000000',
      size: data.size || 300,
      errorCorrection: data.errorCorrection || 'M',
      createdAt: now,
      updatedAt: now
    });
    await db.collection(COLLECTIONS.QR_CODES).doc(id).set(qrCodeData);
    return { id, ...qrCodeData, createdAt: toDate(now), updatedAt: toDate(now) };
  },

  async update(where, data) {
    const qrCode = await this.findUnique(where);
    if (!qrCode) throw new Error('QR Code not found');
    
    const updateData = prepareForFirestore({
      ...data,
      updatedAt: Timestamp.now()
    });
    await db.collection(COLLECTIONS.QR_CODES).doc(qrCode.id).update(updateData);
    return { ...qrCode, ...updateData, updatedAt: new Date() };
  },

  async delete(where) {
    const qrCode = await this.findUnique(where);
    if (!qrCode) throw new Error('QR Code not found');
    await db.collection(COLLECTIONS.QR_CODES).doc(qrCode.id).delete();
    return qrCode;
  },

  async deleteMany(where) {
    const qrCodes = await this.findMany({ where });
    const batch = db.batch();
    
    qrCodes.forEach(qrCode => {
      const ref = db.collection(COLLECTIONS.QR_CODES).doc(qrCode.id);
      batch.delete(ref);
    });
    
    await batch.commit();
    return { count: qrCodes.length };
  },

  async findMany(options = {}) {
    return executeQuery(COLLECTIONS.QR_CODES, options);
  },

  async count(where = {}) {
    let query = db.collection(COLLECTIONS.QR_CODES);
    Object.entries(where).forEach(([key, value]) => {
      if (value !== undefined) {
        query = query.where(key, '==', value);
      }
    });
    const snapshot = await query.count().get();
    return snapshot.data().count;
  },

  async findAll() {
    const snapshot = await db.collection(COLLECTIONS.QR_CODES).get();
    return snapshot.docs.map(formatDoc);
  },

  async countAll() {
    const snapshot = await db.collection(COLLECTIONS.QR_CODES).count().get();
    return snapshot.data().count;
  },

  async incrementScans(id) {
    const ref = db.collection(COLLECTIONS.QR_CODES).doc(id);
    await ref.update({
      scansCount: FieldValue.increment(1),
      updatedAt: Timestamp.now()
    });
  }
};

// ==================== QR SCAN OPERATIONS ====================

const qrScanService = {
  async create(data) {
    const id = generateId();
    const now = Timestamp.now();
    const scanData = prepareForFirestore({
      ...data,
      id,
      scannedAt: now
    });
    await db.collection(COLLECTIONS.QR_SCANS).doc(id).set(scanData);
    return { id, ...scanData, scannedAt: toDate(now) };
  },

  async findMany(options = {}) {
    // Handle date range queries for QR scans
    if (options.where) {
      const convertedWhere = {};
      Object.entries(options.where).forEach(([key, value]) => {
        if (typeof value === 'object' && (value.gte || value.lte)) {
          convertedWhere[key] = {};
          if (value.gte) {
            convertedWhere[key].gte = value.gte instanceof Date ? Timestamp.fromDate(value.gte) : value.gte;
          }
          if (value.lte) {
            convertedWhere[key].lte = value.lte instanceof Date ? Timestamp.fromDate(value.lte) : value.lte;
          }
        } else {
          convertedWhere[key] = value;
        }
      });
      options = { ...options, where: convertedWhere };
    }
    
    const results = await executeQuery(COLLECTIONS.QR_SCANS, options);
    // Format scannedAt field
    return results.map(doc => ({
      ...doc,
      scannedAt: toDate(doc.scannedAt)
    }));
  },

  async count(where = {}) {
    let query = db.collection(COLLECTIONS.QR_SCANS);
    Object.entries(where).forEach(([key, value]) => {
      if (value !== undefined) {
        if (typeof value === 'object' && value.gte) {
          query = query.where(key, '>=', value.gte instanceof Date ? Timestamp.fromDate(value.gte) : value.gte);
        } else if (typeof value === 'object' && value.lte) {
          query = query.where(key, '<=', value.lte instanceof Date ? Timestamp.fromDate(value.lte) : value.lte);
        } else {
          query = query.where(key, '==', value);
        }
      }
    });
    const snapshot = await query.count().get();
    return snapshot.data().count;
  },

  async deleteMany(where) {
    const scans = await this.findMany({ where });
    const batch = db.batch();
    
    scans.forEach(scan => {
      const ref = db.collection(COLLECTIONS.QR_SCANS).doc(scan.id);
      batch.delete(ref);
    });
    
    await batch.commit();
    return { count: scans.length };
  }
};

// ==================== FORM TEMPLATE OPERATIONS ====================

const formTemplateService = {
  async findById(id) {
    const doc = await db.collection(COLLECTIONS.FORM_TEMPLATES).doc(id).get();
    return formatDoc(doc);
  },

  async findUnique(where) {
    if (where.id) return this.findById(where.id);
    return null;
  },

  async findFirst(where) {
    let query = db.collection(COLLECTIONS.FORM_TEMPLATES);
    Object.entries(where).forEach(([key, value]) => {
      if (value !== undefined) {
        query = query.where(key, '==', value);
      }
    });
    const snapshot = await query.limit(1).get();
    if (snapshot.empty) return null;
    return formatDoc(snapshot.docs[0]);
  },

  async create(data) {
    const id = generateId();
    const now = Timestamp.now();
    const templateData = prepareForFirestore({
      ...data,
      id,
      isActive: data.isActive !== false,
      version: data.version || 1,
      createdAt: now,
      updatedAt: now
    });
    
    // Handle fields separately
    let fields = [];
    if (data.fields && data.fields.create) {
      const fieldsBatch = db.batch();
      fields = data.fields.create.map((fieldData, index) => {
        const fieldId = generateId();
        const field = prepareForFirestore({
          ...fieldData,
          id: fieldId,
          templateId: id,
          order: fieldData.order !== undefined ? fieldData.order : index,
          createdAt: now,
          updatedAt: now
        });
        const fieldRef = db.collection(COLLECTIONS.FORM_FIELDS).doc(fieldId);
        fieldsBatch.set(fieldRef, field);
        return { id: fieldId, ...field, createdAt: toDate(now), updatedAt: toDate(now) };
      });
      await fieldsBatch.commit();
    }
    
    delete templateData.fields;
    await db.collection(COLLECTIONS.FORM_TEMPLATES).doc(id).set(templateData);
    
    return { id, ...templateData, fields, createdAt: toDate(now), updatedAt: toDate(now) };
  },

  async update(where, data) {
    const template = await this.findUnique(where);
    if (!template) throw new Error('Form template not found');
    
    const now = Timestamp.now();
    
    // Handle fields update
    if (data.fields && data.fields.create) {
      // Delete existing fields
      const existingFields = await formFieldService.findMany({ where: { templateId: template.id } });
      const deleteBatch = db.batch();
      existingFields.forEach(field => {
        const ref = db.collection(COLLECTIONS.FORM_FIELDS).doc(field.id);
        deleteBatch.delete(ref);
      });
      await deleteBatch.commit();
      
      // Create new fields
      const createBatch = db.batch();
      data.fields.create.forEach((fieldData, index) => {
        const fieldId = generateId();
        const field = prepareForFirestore({
          ...fieldData,
          id: fieldId,
          templateId: template.id,
          order: fieldData.order !== undefined ? fieldData.order : index,
          createdAt: now,
          updatedAt: now
        });
        const fieldRef = db.collection(COLLECTIONS.FORM_FIELDS).doc(fieldId);
        createBatch.set(fieldRef, field);
      });
      await createBatch.commit();
    }
    
    const updateData = { ...data };
    delete updateData.fields;
    
    const finalUpdateData = prepareForFirestore({
      ...updateData,
      updatedAt: now
    });
    
    await db.collection(COLLECTIONS.FORM_TEMPLATES).doc(template.id).update(finalUpdateData);
    
    // Fetch updated template with fields
    const updatedTemplate = await this.findWithFields(template.id);
    return updatedTemplate;
  },

  async updateMany(where, data) {
    const templates = await this.findMany({ where });
    const batch = db.batch();
    
    templates.forEach(template => {
      const ref = db.collection(COLLECTIONS.FORM_TEMPLATES).doc(template.id);
      batch.update(ref, prepareForFirestore({
        ...data,
        updatedAt: Timestamp.now()
      }));
    });
    
    await batch.commit();
    return { count: templates.length };
  },

  async delete(where) {
    const template = await this.findUnique(where);
    if (!template) throw new Error('Form template not found');
    
    // Delete associated fields
    await formFieldService.deleteMany({ templateId: template.id });
    
    await db.collection(COLLECTIONS.FORM_TEMPLATES).doc(template.id).delete();
    return template;
  },

  async deleteMany(where) {
    const templates = await this.findMany({ where });
    
    for (const template of templates) {
      await formFieldService.deleteMany({ templateId: template.id });
    }
    
    const batch = db.batch();
    templates.forEach(template => {
      const ref = db.collection(COLLECTIONS.FORM_TEMPLATES).doc(template.id);
      batch.delete(ref);
    });
    
    await batch.commit();
    return { count: templates.length };
  },

  async findMany(options = {}) {
    return executeQuery(COLLECTIONS.FORM_TEMPLATES, options);
  },

  async findWithFields(id) {
    const template = await this.findById(id);
    if (!template) return null;
    
    const fields = await formFieldService.findMany({
      where: { templateId: id },
      orderBy: { order: 'asc' }
    });
    
    return { ...template, fields };
  }
};

// ==================== FORM FIELD OPERATIONS ====================

const formFieldService = {
  async findById(id) {
    const doc = await db.collection(COLLECTIONS.FORM_FIELDS).doc(id).get();
    return formatDoc(doc);
  },

  async findUnique(where) {
    if (where.id) return this.findById(where.id);
    return null;
  },

  async findMany(options = {}) {
    return executeQuery(COLLECTIONS.FORM_FIELDS, options);
  },

  async findByTemplateId(templateId) {
    const snapshot = await db.collection(COLLECTIONS.FORM_FIELDS)
      .where('templateId', '==', templateId)
      .get();
    return snapshot.docs.map(doc => formatDoc(doc)).sort((a, b) => (a.order || 0) - (b.order || 0));
  },

  async create(data) {
    const id = data.id || generateId();
    const now = Timestamp.now();
    const fieldData = prepareForFirestore({
      ...data,
      id,
      createdAt: now,
      updatedAt: now
    });
    await db.collection(COLLECTIONS.FORM_FIELDS).doc(id).set(fieldData);
    return { id, ...fieldData, createdAt: toDate(now), updatedAt: toDate(now) };
  },

  async createMany(dataArray) {
    const batch = db.batch();
    const now = Timestamp.now();
    const results = [];

    for (const data of dataArray) {
      const id = data.id || generateId();
      const fieldData = prepareForFirestore({
        ...data,
        id,
        createdAt: now,
        updatedAt: now
      });
      const ref = db.collection(COLLECTIONS.FORM_FIELDS).doc(id);
      batch.set(ref, fieldData);
      results.push({ id, ...fieldData, createdAt: toDate(now), updatedAt: toDate(now) });
    }

    await batch.commit();
    return results;
  },

  async update(where, data) {
    const field = await this.findUnique(where);
    if (!field) throw new Error('Form field not found');
    
    const updateData = prepareForFirestore({
      ...data,
      updatedAt: Timestamp.now()
    });
    await db.collection(COLLECTIONS.FORM_FIELDS).doc(field.id).update(updateData);
    return { ...field, ...updateData, updatedAt: new Date() };
  },

  async delete(where) {
    const field = await this.findUnique(where);
    if (!field) throw new Error('Form field not found');
    await db.collection(COLLECTIONS.FORM_FIELDS).doc(field.id).delete();
    return field;
  },

  async deleteMany(where) {
    const fields = await this.findMany({ where });
    const batch = db.batch();
    
    fields.forEach(field => {
      const ref = db.collection(COLLECTIONS.FORM_FIELDS).doc(field.id);
      batch.delete(ref);
    });
    
    await batch.commit();
    return { count: fields.length };
  },

  async deleteByTemplateId(templateId) {
    const fields = await this.findByTemplateId(templateId);
    if (fields.length === 0) return { count: 0 };
    
    const batch = db.batch();
    fields.forEach(field => {
      const ref = db.collection(COLLECTIONS.FORM_FIELDS).doc(field.id);
      batch.delete(ref);
    });
    
    await batch.commit();
    return { count: fields.length };
  }
};

// ==================== AI REVIEW GENERATION OPERATIONS ====================

const aiReviewGenerationService = {
  async findById(id) {
    const doc = await db.collection(COLLECTIONS.AI_REVIEW_GENERATIONS).doc(id).get();
    return formatDoc(doc);
  },

  async findUnique(where) {
    if (where.id) return this.findById(where.id);
    if (where.reviewId) {
      const snapshot = await db.collection(COLLECTIONS.AI_REVIEW_GENERATIONS)
        .where('reviewId', '==', where.reviewId)
        .limit(1)
        .get();
      if (snapshot.empty) return null;
      return formatDoc(snapshot.docs[0]);
    }
    return null;
  },

  async create(data) {
    const id = generateId();
    const now = Timestamp.now();
    const generationData = prepareForFirestore({
      ...data,
      id,
      confidence: data.confidence || 0.0,
      aiModel: data.aiModel || 'gemini-pro',
      status: data.status || 'PENDING',
      generatedAt: now
    });
    await db.collection(COLLECTIONS.AI_REVIEW_GENERATIONS).doc(id).set(generationData);
    return { id, ...generationData, generatedAt: toDate(now) };
  },

  async update(where, data) {
    const generation = await this.findUnique(where);
    if (!generation) throw new Error('AI generation not found');
    
    const updateData = prepareForFirestore(data);
    await db.collection(COLLECTIONS.AI_REVIEW_GENERATIONS).doc(generation.id).update(updateData);
    return { ...generation, ...updateData };
  },

  async delete(where) {
    const generation = await this.findUnique(where);
    if (!generation) throw new Error('AI generation not found');
    await db.collection(COLLECTIONS.AI_REVIEW_GENERATIONS).doc(generation.id).delete();
    return generation;
  },

  async deleteMany(where) {
    const generations = await this.findMany({ where });
    const batch = db.batch();
    
    generations.forEach(gen => {
      const ref = db.collection(COLLECTIONS.AI_REVIEW_GENERATIONS).doc(gen.id);
      batch.delete(ref);
    });
    
    await batch.commit();
    return { count: generations.length };
  },

  async findMany(options = {}) {
    return executeQuery(COLLECTIONS.AI_REVIEW_GENERATIONS, options);
  },

  async count(where = {}) {
    let query = db.collection(COLLECTIONS.AI_REVIEW_GENERATIONS);
    Object.entries(where).forEach(([key, value]) => {
      if (value !== undefined) {
        query = query.where(key, '==', value);
      }
    });
    const snapshot = await query.count().get();
    return snapshot.data().count;
  }
};

// ==================== AI PROMPT TEMPLATE OPERATIONS ====================

const aiPromptTemplateService = {
  async findMany(options = {}) {
    return executeQuery(COLLECTIONS.AI_PROMPT_TEMPLATES, options);
  },

  async deleteMany(where) {
    const templates = await this.findMany({ where });
    const batch = db.batch();
    
    templates.forEach(template => {
      const ref = db.collection(COLLECTIONS.AI_PROMPT_TEMPLATES).doc(template.id);
      batch.delete(ref);
    });
    
    await batch.commit();
    return { count: templates.length };
  }
};

// ==================== AI USAGE ANALYTICS OPERATIONS ====================

const aiUsageAnalyticsService = {
  async create(data) {
    const id = generateId();
    const now = Timestamp.now();
    const analyticsData = prepareForFirestore({
      ...data,
      id,
      tokensUsed: data.tokensUsed || 0,
      responseTime: data.responseTime || 0,
      success: data.success !== false,
      estimatedCost: data.estimatedCost || 0.0,
      createdAt: now
    });
    await db.collection(COLLECTIONS.AI_USAGE_ANALYTICS).doc(id).set(analyticsData);
    return { id, ...analyticsData, createdAt: toDate(now) };
  },

  async findMany(options = {}) {
    return executeQuery(COLLECTIONS.AI_USAGE_ANALYTICS, options);
  },

  async deleteMany(where) {
    const analytics = await this.findMany({ where });
    const batch = db.batch();
    
    analytics.forEach(item => {
      const ref = db.collection(COLLECTIONS.AI_USAGE_ANALYTICS).doc(item.id);
      batch.delete(ref);
    });
    
    await batch.commit();
    return { count: analytics.length };
  }
};

// ==================== SUBSCRIPTION OPERATIONS ====================

const subscriptionService = {
  async findById(id) {
    const doc = await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(id).get();
    return formatDoc(doc);
  },

  async findUnique(where) {
    if (where.id) return this.findById(where.id);
    if (where.businessId) {
      const snapshot = await db.collection(COLLECTIONS.SUBSCRIPTIONS)
        .where('businessId', '==', where.businessId)
        .limit(1)
        .get();
      if (snapshot.empty) return null;
      return formatDoc(snapshot.docs[0]);
    }
    return null;
  },

  async create(data) {
    const id = generateId();
    const now = Timestamp.now();
    const subscriptionData = prepareForFirestore({
      ...data,
      id,
      status: data.status || 'ACTIVE',
      startDate: data.startDate ? Timestamp.fromDate(new Date(data.startDate)) : now,
      endDate: data.endDate ? Timestamp.fromDate(new Date(data.endDate)) : null,
      createdAt: now,
      updatedAt: now
    });
    await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(id).set(subscriptionData);
    return { id, ...subscriptionData, createdAt: toDate(now), updatedAt: toDate(now) };
  },

  async update(where, data) {
    const subscription = await this.findUnique(where);
    if (!subscription) throw new Error('Subscription not found');
    
    const updateData = prepareForFirestore({
      ...data,
      updatedAt: Timestamp.now()
    });
    
    if (updateData.startDate) {
      updateData.startDate = Timestamp.fromDate(new Date(updateData.startDate));
    }
    if (updateData.endDate) {
      updateData.endDate = Timestamp.fromDate(new Date(updateData.endDate));
    }
    if (updateData.cancelledAt) {
      updateData.cancelledAt = Timestamp.fromDate(new Date(updateData.cancelledAt));
    }
    
    await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(subscription.id).update(updateData);
    return { ...subscription, ...updateData, updatedAt: new Date() };
  },

  async findMany(options = {}) {
    // Handle date range queries for subscriptions
    if (options.where) {
      const convertedWhere = {};
      Object.entries(options.where).forEach(([key, value]) => {
        if (typeof value === 'object' && (value.gte || value.lte)) {
          convertedWhere[key] = {};
          if (value.gte) {
            convertedWhere[key].gte = value.gte instanceof Date ? Timestamp.fromDate(value.gte) : value.gte;
          }
          if (value.lte) {
            convertedWhere[key].lte = value.lte instanceof Date ? Timestamp.fromDate(value.lte) : value.lte;
          }
        } else {
          convertedWhere[key] = value;
        }
      });
      options = { ...options, where: convertedWhere };
    }
    
    return executeQuery(COLLECTIONS.SUBSCRIPTIONS, options);
  },

  async count(where = {}) {
    let query = db.collection(COLLECTIONS.SUBSCRIPTIONS);
    Object.entries(where).forEach(([key, value]) => {
      if (value !== undefined) {
        query = query.where(key, '==', value);
      }
    });
    const snapshot = await query.count().get();
    return snapshot.data().count;
  },

  async findAll() {
    const snapshot = await db.collection(COLLECTIONS.SUBSCRIPTIONS).get();
    return snapshot.docs.map(formatDoc);
  },

  async countAll() {
    const snapshot = await db.collection(COLLECTIONS.SUBSCRIPTIONS).count().get();
    return snapshot.data().count;
  }
};

// ==================== BUSINESS GOAL OPERATIONS ====================

const businessGoalService = {
  async findById(id) {
    const doc = await db.collection(COLLECTIONS.BUSINESS_GOALS).doc(id).get();
    return formatDoc(doc);
  },

  async create(data) {
    const id = generateId();
    const now = Timestamp.now();
    const goalData = prepareForFirestore({
      ...data,
      id,
      currentValue: data.currentValue || 0,
      status: data.status || 'ACTIVE',
      priority: data.priority || 'MEDIUM',
      progressPercent: data.progressPercent || 0.0,
      targetDate: data.targetDate ? Timestamp.fromDate(new Date(data.targetDate)) : null,
      createdAt: now,
      updatedAt: now
    });
    await db.collection(COLLECTIONS.BUSINESS_GOALS).doc(id).set(goalData);
    return { id, ...goalData, createdAt: toDate(now), updatedAt: toDate(now) };
  },

  async findMany(options = {}) {
    return executeQuery(COLLECTIONS.BUSINESS_GOALS, options);
  }
};

// ==================== BUSINESS INSIGHT OPERATIONS ====================

const businessInsightService = {
  async create(data) {
    const id = generateId();
    const now = Timestamp.now();
    const insightData = prepareForFirestore({
      ...data,
      id,
      severity: data.severity || 'INFO',
      actionable: data.actionable || false,
      confidence: data.confidence || 0.0,
      isRead: false,
      isArchived: false,
      createdAt: now
    });
    await db.collection(COLLECTIONS.BUSINESS_INSIGHTS).doc(id).set(insightData);
    return { id, ...insightData, createdAt: toDate(now) };
  },

  async findMany(options = {}) {
    return executeQuery(COLLECTIONS.BUSINESS_INSIGHTS, options);
  }
};

// ==================== INDUSTRY BENCHMARK OPERATIONS ====================

const industryBenchmarkService = {
  async findMany(options = {}) {
    return executeQuery(COLLECTIONS.INDUSTRY_BENCHMARKS, options);
  }
};

// ==================== DATABASE HEALTH CHECK ====================

const checkDatabaseHealth = async () => {
  try {
    // Simple connectivity test
    await db.collection('_health_check').doc('test').set({
      timestamp: Timestamp.now()
    });
    await db.collection('_health_check').doc('test').delete();
    return { status: 'connected', type: 'firestore' };
  } catch (error) {
    return { status: 'disconnected', error: error.message, type: 'firestore' };
  }
};

// Export all services
module.exports = {
  // Collection names
  COLLECTIONS,
  
  // Helper functions
  generateId,
  toDate,
  prepareForFirestore,
  formatDoc,
  
  // Entity services
  user: userService,
  business: businessService,
  customer: customerService,
  review: reviewService,
  qrCode: qrCodeService,
  qrScan: qrScanService,
  formTemplate: formTemplateService,
  formField: formFieldService,
  aiGeneration: aiReviewGenerationService,
  aiReviewGeneration: aiReviewGenerationService,
  promptTemplate: {
    async findFirst(where) {
      let query = db.collection(COLLECTIONS.AI_PROMPT_TEMPLATES);
      Object.entries(where).forEach(([key, value]) => {
        if (value !== undefined) {
          query = query.where(key, '==', value);
        }
      });
      const snapshot = await query.limit(1).get();
      if (snapshot.empty) return null;
      return formatDoc(snapshot.docs[0]);
    }
  },
  aiPromptTemplate: aiPromptTemplateService,
  aiUsageAnalytics: aiUsageAnalyticsService,
  subscription: {
    ...subscriptionService,
    async findByBusinessId(businessId) {
      return subscriptionService.findUnique({ businessId });
    },
    async findAll() {
      return subscriptionService.findMany({});
    }
  },
  subscriptionUsage: {
    async create(data) {
      const id = generateId();
      const now = Timestamp.now();
      const usageData = prepareForFirestore({
        ...data,
        id,
        createdAt: now
      });
      await db.collection('subscriptionUsage').doc(id).set(usageData);
      return { id, ...usageData, createdAt: toDate(now) };
    }
  },
  goal: businessGoalService,
  milestone: {
    async create(data) {
      const id = generateId();
      const now = Timestamp.now();
      const milestoneData = prepareForFirestore({
        ...data,
        id,
        achieved: data.achieved || false,
        createdAt: now
      });
      await db.collection(COLLECTIONS.BUSINESS_MILESTONES).doc(id).set(milestoneData);
      return { id, ...milestoneData, createdAt: toDate(now) };
    },
    async findByGoalId(goalId) {
      const snapshot = await db.collection(COLLECTIONS.BUSINESS_MILESTONES)
        .where('goalId', '==', goalId)
        .orderBy('value', 'asc')
        .get();
      return snapshot.docs.map(formatDoc);
    }
  },
  insight: businessInsightService,
  benchmark: industryBenchmarkService,
  businessGoal: businessGoalService,
  businessInsight: businessInsightService,
  industryBenchmark: industryBenchmarkService,
  
  // Database utilities
  checkDatabaseHealth,
  
  // Raw Firestore access
  db,
  FieldValue,
  Timestamp
};
