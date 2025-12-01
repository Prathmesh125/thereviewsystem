// Firebase Admin SDK configuration
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Initialize Firebase Admin SDK
let db = null;
let auth = null;

if (!admin.apps.length) {
  try {
    let credential;
    
    // Option 1: Use FIREBASE_SERVICE_ACCOUNT environment variable (for Render/production)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log('🔥 Using FIREBASE_SERVICE_ACCOUNT environment variable');
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      credential = admin.credential.cert(serviceAccount);
    }
    // Option 2: Use individual environment variables
    else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      console.log('🔥 Using individual Firebase environment variables');
      credential = admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
      });
    }
    // Option 3: Use service account file (for local development)
    else {
      const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './firebase-service-account.json';
      if (fs.existsSync(serviceAccountPath)) {
        console.log('🔥 Using service account file:', serviceAccountPath);
        const serviceAccount = require(path.resolve(serviceAccountPath));
        credential = admin.credential.cert(serviceAccount);
      } else {
        throw new Error('No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT env var or provide service account file.');
      }
    }
    
    admin.initializeApp({ credential });
    
    db = admin.firestore();
    auth = admin.auth();
    console.log('✅ Firebase Admin SDK initialized successfully');
  } catch (error) {
    console.error('❌ Firebase Admin SDK initialization failed:', error.message);
    console.log('   For production: Set FIREBASE_SERVICE_ACCOUNT environment variable');
    console.log('   For local: Ensure firebase-service-account.json exists');
  }
}

module.exports = { admin, db, auth };