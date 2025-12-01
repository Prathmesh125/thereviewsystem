const admin = require('firebase-admin');
const fs = require('fs');
const serviceAccount = JSON.parse(fs.readFileSync('./firebase-service-account.json', 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function checkData() {
  console.log('=== Checking Firestore Data ===\n');
  
  // Check users collection
  const users = await db.collection('users').get();
  console.log('USERS collection:', users.size, 'documents');
  users.forEach(doc => {
    const data = doc.data();
    console.log('  -', doc.id, '|', data.email, '|', data.role || 'NO ROLE');
  });
  
  console.log('\n');
  
  // Check businesses collection
  const businesses = await db.collection('businesses').get();
  console.log('BUSINESSES collection:', businesses.size, 'documents');
  businesses.forEach(doc => {
    const data = doc.data();
    console.log('  -', doc.id, '|', data.name, '|', data.type);
  });
  
  console.log('\n');
  
  // Check reviews collection
  const reviews = await db.collection('reviews').get();
  console.log('REVIEWS collection:', reviews.size, 'documents');
  
  // Check customers collection  
  const customers = await db.collection('customers').get();
  console.log('CUSTOMERS collection:', customers.size, 'documents');
  
  // Check qrCodes collection
  const qrCodes = await db.collection('qrCodes').get();
  console.log('QR_CODES collection:', qrCodes.size, 'documents');
  
  // Check subscriptions collection
  const subscriptions = await db.collection('subscriptions').get();
  console.log('SUBSCRIPTIONS collection:', subscriptions.size, 'documents');
  
  process.exit(0);
}

checkData().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
