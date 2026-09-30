import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const keys = [
  'BREVO_API_KEY',
  'BREVO_SENDER_EMAIL',
  'BREVO_SENDER_NAME',
  'AUTH_SECRET',
  'admin',
  'password',
  'FIREBASE_API_KEY',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_REGION',
  'R2_PUBLIC_URL',
];

// Load fallback from .env if present
const dotEnvPath = path.join(rootDir, '.env');
const dotEnvMap = {};
if (fs.existsSync(dotEnvPath)) {
  try {
    const raw = fs.readFileSync(dotEnvPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        dotEnvMap[k] = v;
      }
    }
  } catch (_) {}
}

const envObj = {};
for (const k of keys) {
  envObj[k] = (process.env[k] || dotEnvMap[k] || '').trim();
}

const content = `// Auto-generated build-time environment bridge (Populated by Cloudflare build)
export const RUNTIME_ENV = ${JSON.stringify(envObj, null, 2)};
export default RUNTIME_ENV;
`;

fs.writeFileSync(path.join(rootDir, 'runtime-secrets.js'), content, 'utf8');
console.log('✓ Successfully synchronized runtime environment secrets for build.');
