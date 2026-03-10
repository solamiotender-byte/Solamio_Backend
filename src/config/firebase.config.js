
import admin from "firebase-admin";
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


let serviceAccount;
try {
  const serviceAccountPath = join(__dirname, '../../public/lead-management-3c2d2-firebase-adminsdk-fbsvc-0f41fa9c71.json');
  serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
} catch (error) {
  console.error('Failed to load Firebase service account:', error);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
        : serviceAccount
    ),
  });
}


export default admin;
