
import admin from "firebase-admin";
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, isAbsolute, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const normalizeServiceAccount = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!value.project_id || !value.client_email || !value.private_key) return null;

  return {
    ...value,
    private_key: String(value.private_key).replace(/\\n/g, "\n"),
  };
};

const readJsonFile = (filePath) => {
  if (!filePath || !existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
};

const loadServiceAccount = () => {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
      const parsed = raw.startsWith("{")
        ? JSON.parse(raw)
        : readJsonFile(isAbsolute(raw) ? raw : join(process.cwd(), raw));
      return normalizeServiceAccount(parsed);
    }

    const defaultPath = join(
      __dirname,
      "../../public/lead-management-3c2d2-firebase-adminsdk-fbsvc-0f41fa9c71.json"
    );
    return normalizeServiceAccount(readJsonFile(defaultPath));
  } catch (error) {
    console.warn("Firebase service account could not be loaded:", error.message);
    return null;
  }
};

if (!admin.apps.length) {
  const serviceAccount = loadServiceAccount();

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    console.warn(
      "Firebase notifications disabled: valid service account JSON was not found."
    );
  }
}

export const isFirebaseReady = () => admin.apps.length > 0;

export default admin;
