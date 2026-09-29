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

const envObj = {};
for (const k of keys) {
  envObj[k] = (process.env[k] || '').trim();
}

const content = `// Auto-generated build-time environment bridge (Populated by Cloudflare build)
export const RUNTIME_ENV = ${JSON.stringify(envObj, null, 2)};
export default RUNTIME_ENV;
`;

fs.writeFileSync(path.join(rootDir, 'runtime-secrets.js'), content, 'utf8');
console.log('✓ Successfully synchronized runtime environment secrets for build.');
