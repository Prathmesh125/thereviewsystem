const { auth, db } = require('../config/firebase');

const verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        message: 'Authorization header is required' 
      });
    }

    const idToken = authHeader.split(' ')[1];

    // Check if Firebase is initialized
    if (!auth) {
      return res.status(503).json({ 
        message: 'Firebase authentication is not configured. Please add service account key.' 
      });
    }
    
    console.log('Verifying Firebase token...');
    
    // Verify the Firebase ID token
    const decodedToken = await auth.verifyIdToken(idToken);
    
    console.log('Token verified - User UID:', decodedToken.uid, 'Email:', decodedToken.email);
    
    // Add user info to request object
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      ...decodedToken
    };
    
    next();
  } catch (error) {
    console.error('Firebase token verification error:', error.message);
    
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ 
        message: 'Token has expired. Please sign in again.' 
      });
    }
    
    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ 
        message: 'Token has been revoked. Please sign in again.' 
      });
    }
    
    if (error.code === 'auth/argument-error') {
      return res.status(401).json({ 
        message: 'Invalid token format. Please sign in again.' 
      });
    }
    
    return res.status(401).json({ 
      message: 'Invalid or expired token. Please sign in again.' 
    });
  }
};

// Middleware to check user role from Firestore
const checkUserRole = (requiredRole) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.uid) {
        return res.status(401).json({ 
          message: 'User not authenticated' 
        });
      }
      
      // Check if Firebase Firestore is initialized
      if (!db) {
        console.log('⚠️ Firestore not available, using default role');
        req.user.role = 'BUSINESS_OWNER';
        req.user.userData = {
          role: 'BUSINESS_OWNER',
          email: req.user.email
        };
        
        if (requiredRole && req.user.role !== requiredRole) {
          return res.status(403).json({ 
            message: 'Insufficient permissions' 
          });
        }
        return next();
      }
      
      // Get user document from Firestore
      const userDoc = await db.collection('users').doc(req.user.uid).get();
      
      if (!userDoc.exists) {
        // User doesn't exist in Firestore, create with default role
        console.log('User not found in Firestore, creating with default role');
        await db.collection('users').doc(req.user.uid).set({
          email: req.user.email,
          role: 'BUSINESS_OWNER',
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        req.user.role = 'BUSINESS_OWNER';
        req.user.userData = {
          role: 'BUSINESS_OWNER',
          email: req.user.email
        };
      } else {
        const userData = userDoc.data();
        req.user.role = userData.role || 'BUSINESS_OWNER';
        req.user.userData = userData;
      }
      
      if (requiredRole && req.user.role !== requiredRole) {
        return res.status(403).json({ 
          message: 'Insufficient permissions' 
        });
      }
      
      next();
    } catch (error) {
      console.error('Role check error:', error.message);
      
      // If Firestore fails, allow with default role in development
      if (process.env.NODE_ENV === 'development') {
        console.log('⚠️ Firestore error in development, using default role');
        req.user.role = 'BUSINESS_OWNER';
        req.user.userData = {
          role: 'BUSINESS_OWNER',
          email: req.user.email
        };
        return next();
      }
      
      return res.status(500).json({ 
        message: 'Error verifying user role' 
      });
    }
  };
};

module.exports = {
  verifyFirebaseToken,
  checkUserRole
};
