const admin = require('firebase-admin');
const fs = require('fs');
const serviceAccount = JSON.parse(fs.readFileSync('./firebase-service-account.json', 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function setSuperAdmin() {
  const uid = 'RBpIuqnf2YMjWq3QVxPmbSldeRr1';
  const email = 'millrockindustries@gmail.com';
  
  console.log('Setting up Super Admin for:', email);
  
  // Check if user exists by UID
  const userByUid = await db.collection('users').doc(uid).get();
  
  if (userByUid.exists) {
    console.log('Found user by UID:', uid);
    console.log('Current data:', JSON.stringify(userByUid.data(), null, 2));
    await db.collection('users').doc(uid).update({ role: 'SUPER_ADMIN' });
    console.log('Updated role to SUPER_ADMIN');
  } else {
    // Create the user document with SUPER_ADMIN role
    console.log('Creating user document with UID:', uid);
    await db.collection('users').doc(uid).set({
      id: uid,
      email: email,
      role: 'SUPER_ADMIN',
      firstName: 'Super',
      lastName: 'Admin',
      isActive: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    });
    console.log('Created user with SUPER_ADMIN role');
  }
  
  // Verify
  const verifyDoc = await db.collection('users').doc(uid).get();
  console.log('Verified user data:', JSON.stringify(verifyDoc.data(), null, 2));
  
  process.exit(0);
}

setSuperAdmin().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
