const admin = require('firebase-admin');
const fs = require('fs');

// Load service account
const serviceAccountPath = './firebase-service-account.json';
console.log('Loading from:', serviceAccountPath);
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
console.log('Project ID:', serviceAccount.project_id);
console.log('Client Email:', serviceAccount.client_email);

// Initialize
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
    });
}

const db = admin.firestore();

// Try to access Firestore
async function test() {
    try {
        console.log('Attempting to list collections...');
        const collections = await db.listCollections();
        console.log('Success! Collections:', collections.map(c => c.id));
        
        // Try to read from users collection
        console.log('\nAttempting to read users collection...');
        const usersSnapshot = await db.collection('users').limit(1).get();
        console.log('Users query success! Found:', usersSnapshot.size, 'documents');
        
    } catch (error) {
        console.error('\n--- ERROR ---');
        console.error('Code:', error.code);
        console.error('Message:', error.message);
        if (error.details) console.error('Details:', error.details);
        console.error('\n--- Troubleshooting ---');
        console.error('1. Make sure Firestore is enabled in your Firebase project');
        console.error('2. Go to Firebase Console > Project Settings > Service Accounts');
        console.error('3. Generate a new private key');
        console.error('4. Replace firebase-service-account.json with the new key');
    }
    process.exit(0);
}

test();
