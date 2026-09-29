import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import https from 'node:https';
import { getClientIp, handleCors, verifyAdminRequest, getAuthSecret } from './_utils.js';
import { verifySellerToken } from './seller/auth.js';

const customHttpsAgent = new https.Agent({
  rejectUnauthorized: true,
  keepAlive: true,
});

function getEnvConfig() {
  const endpoint = String(process.env.R2_ENDPOINT || process.env.RUSTFS_ENDPOINT || '').replace(/\/+$/, '');
  const bucket = String(process.env.R2_BUCKET || process.env.RUSTFS_BUCKET || 'linkadda-media').trim();
  const region = String(process.env.R2_REGION || process.env.RUSTFS_REGION || 'auto').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || process.env.RUSTFS_ACCESS_KEY || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || process.env.RUSTFS_SECRET_KEY || '').trim();
  const publicBaseUrl = String(process.env.R2_PUBLIC_URL || 'https://media.jaigram.shop').replace(/\/+$/, '');

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Cloudflare R2 storage credentials are not properly configured on server.');
  }

  return { endpoint, bucket, region, accessKeyId, secretAccessKey, publicBaseUrl };
}

const uploadRateLimitMap = new Map();
const MAX_UPLOADS_PER_MIN = 35;

const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif',
  'mp4', 'webm', 'mov', 'm4v', 'ogg', 'mkv'
]);

function isAllowedExtension(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

function isValidMediaBuffer(buf, filename = '') {
  if (!buf || buf.length < 8) return false;
  const ext = String(filename || '').split('.').pop().toLowerCase();
  
  // Video files validation
  const videoExts = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogg', 'mkv']);
  if (videoExts.has(ext)) {
    // MP4/MOV/M4V typically contain 'ftyp' in first 16 bytes
    if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') return true;
    // WEBM/MKV starts with EBML 0x1A 0x45 0xDF 0xA3
    if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return true;
    // General video buffer check
    return buf.length >= 16;
  }

  // Image files validation
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // WEBP: 'RIFF' ... 'WEBP'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
  // GIF: GIF87a or GIF89a
  if (buf.toString('ascii', 0, 3) === 'GIF') return true;
  // SVG: contains '<svg'
  if (buf.toString('utf8', 0, Math.min(buf.length, 512)).includes('<svg')) return true;

  return buf.length >= 16;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '60mb',
    },
  },
};

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function parseBase64(rawBase64, fallbackMime = 'image/png') {
  let cleanBase64 = String(rawBase64 || '');
  let mime = fallbackMime;
  if (cleanBase64.includes('base64,')) {
    const parts = cleanBase64.split('base64,');
    cleanBase64 = parts[1];
    const matchMime = parts[0].match(/data:([^;]+);/);
    if (matchMime) mime = matchMime[1];
  }
  return {
    buffer: Buffer.from(cleanBase64, 'base64'),
    mime,
  };
}

export default async function handler(req, res) {
  // CORS Headers
  if (handleCors(req, res, 'POST, OPTIONS')) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};

    // ━━ SECURITY CHECK: Caller must be verified Admin or Authenticated Seller ━━
    const isAdmin = await verifyAdminRequest(req);
    let isSeller = false;

    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    const sellerId = String(body.sellerId || req.headers['x-seller-id'] || '').trim();
    const sellerToken = String(body.sellerToken || body.token || bearerToken || '').trim();
    const secret = getAuthSecret();

    if (sellerId && sellerToken && verifySellerToken(sellerId, sellerToken, secret)) {
      isSeller = true;
    }

    const isCustomerOrderProof = !isAdmin && !isSeller && String(body.folder || '') === 'orders';
    if (!isAdmin && !isSeller && !isCustomerOrderProof) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required to upload files.' });
    }

    const clientIp = getClientIp(req);
    const now = Date.now();
    let timestamps = (uploadRateLimitMap.get(clientIp) || []).filter(ts => now - ts < 60000);
    if (timestamps.length >= MAX_UPLOADS_PER_MIN) {
      return res.status(429).json({ error: 'Too many upload requests. Please wait a minute.' });
    }
    timestamps.push(now);
    uploadRateLimitMap.set(clientIp, timestamps);

    const config = getEnvConfig();
    const s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
      requestHandler: {
        httpsAgent: customHttpsAgent,
      },
    });

    const action = String(body.action || '').toLowerCase();

    // ━━ 1. CHUNK UPLOAD MODE (Admin & Seller Only) ━━
    if (action === 'chunk') {
      if (!isAdmin && !isSeller) {
        return res.status(401).json({ error: 'Unauthorized: Admin or Seller credentials required for chunk uploads.' });
      }
      const uploadId = String(body.uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const partIndex = Number(body.partIndex);
      if (!uploadId || isNaN(partIndex)) {
        return res.status(400).json({ error: 'Missing uploadId or partIndex for chunk upload.' });
      }

      const { buffer: chunkBuffer } = parseBase64(body.chunkBase64 || body.base64);
      if (!chunkBuffer || chunkBuffer.length === 0) {
        return res.status(400).json({ error: 'Empty chunk data provided.' });
      }

      const chunkKey = `_chunks/${uploadId}/${partIndex}`;
      await s3.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: chunkKey,
        Body: chunkBuffer,
        ContentType: 'application/octet-stream',
      }));

      return res.status(200).json({
        success: true,
        uploadId,
        partIndex,
        size: chunkBuffer.length,
      });
    }

    // ━━ 2. ASSEMBLE CHUNKS MODE (Admin & Seller Only) ━━
    if (action === 'assemble') {
      if (!isAdmin && !isSeller) {
        return res.status(401).json({ error: 'Unauthorized: Admin or Seller credentials required for chunk assembly.' });
      }
      const uploadId = String(body.uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const totalParts = Number(body.totalParts);
      const folder = String(body.folder || 'products').replace(/[^a-zA-Z0-9_-]/g, '') || 'products';
      const filename = String(body.filename || `${Date.now()}_asset.png`).replace(/[^a-zA-Z0-9_.-]/g, '_');
      const contentType = String(body.contentType || 'application/octet-stream');

      if (!uploadId || !totalParts || totalParts < 1) {
        return res.status(400).json({ error: 'Missing uploadId or totalParts for assembly.' });
      }

      // Fetch all chunk buffers from S3
      const partBuffers = [];
      for (let i = 0; i < totalParts; i++) {
        const chunkKey = `_chunks/${uploadId}/${i}`;
        const chunkRes = await s3.send(new GetObjectCommand({
          Bucket: config.bucket,
          Key: chunkKey,
        }));
        const buf = await streamToBuffer(chunkRes.Body);
        partBuffers.push(buf);
      }

      const combinedBuffer = Buffer.concat(partBuffers);

      if (!isAllowedExtension(filename)) {
        return res.status(400).json({ error: 'Invalid file extension. Allowed formats: PNG, JPG, JPEG, WEBP, GIF, SVG, AVIF, MP4, WEBM, MOV, M4V, OGG, MKV.' });
      }
      if (!isValidMediaBuffer(combinedBuffer, filename)) {
        return res.status(400).json({ error: 'Uploaded file content is not a valid image or video format.' });
      }

      // Auto-detect video contentType if generic
      const ext = filename.split('.').pop().toLowerCase();
      if (ext === 'mp4' && (!contentType || contentType.startsWith('image/'))) contentType = 'video/mp4';
      if (ext === 'webm' && (!contentType || contentType.startsWith('image/'))) contentType = 'video/webm';
      if (ext === 'mov' && (!contentType || contentType.startsWith('image/'))) contentType = 'video/quicktime';

      const key = `${folder}/${filename}`;

      // Put the final assembled object to RustFS S3
      await s3.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: combinedBuffer,
        ContentType: contentType,
      }));

      // Cleanup chunks asynchronously (non-blocking for fast response)
      (async () => {
        for (let i = 0; i < totalParts; i++) {
          try {
            await s3.send(new DeleteObjectCommand({
              Bucket: config.bucket,
              Key: `_chunks/${uploadId}/${i}`,
            }));
          } catch (_) {}
        }
      })();

      const publicUrl = `${config.publicBaseUrl}/${encodeURI(key)}`;

      return res.status(200).json({
        success: true,
        key,
        bucket: config.bucket,
        publicUrl,
        size: combinedBuffer.length,
        contentType,
      });
    }

    // ━━ 3. DIRECT UPLOAD MODE (Default for files < 3.5 MB) ━━
    let bodyBuffer;
    let contentType = 'image/png';
    let folder = 'products';
    let filename = `asset_${Date.now()}.png`;

    if (typeof body === 'object' && body !== null) {
      folder = String(body.folder || 'products').replace(/[^a-zA-Z0-9_-]/g, '') || 'products';
      filename = String(body.filename || `${Date.now()}_asset.png`).replace(/[^a-zA-Z0-9_.-]/g, '_');
      contentType = String(body.contentType || 'image/png');

      // STRICT: Customer order proof can ONLY write to 'orders' with randomized safe filename
      if (isCustomerOrderProof) {
        folder = 'orders';
        filename = `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      }

      if (body.base64) {
        const parsed = parseBase64(body.base64, contentType);
        bodyBuffer = parsed.buffer;
        if (parsed.mime) contentType = parsed.mime;
      } else if (body.buffer) {
        bodyBuffer = Buffer.from(body.buffer);
      }
    }

    if (!bodyBuffer || bodyBuffer.length === 0) {
      return res.status(400).json({ error: 'No image or file data provided.' });
    }

    if (!isAllowedExtension(filename)) {
      return res.status(400).json({ error: 'Invalid file extension. Allowed formats: PNG, JPG, JPEG, WEBP, GIF, SVG, AVIF, MP4, WEBM, MOV, M4V, OGG, MKV.' });
    }

    if (!isValidMediaBuffer(bodyBuffer, filename)) {
      return res.status(400).json({ error: 'Uploaded file content is not a valid image or video format.' });
    }

    // Auto-detect video contentType if generic
    const directExt = filename.split('.').pop().toLowerCase();
    if (directExt === 'mp4' && (!contentType || contentType.startsWith('image/'))) contentType = 'video/mp4';
    if (directExt === 'webm' && (!contentType || contentType.startsWith('image/'))) contentType = 'video/webm';
    if (directExt === 'mov' && (!contentType || contentType.startsWith('image/'))) contentType = 'video/quicktime';

    const key = `${folder}/${filename}`;

    await s3.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: bodyBuffer,
      ContentType: contentType,
    }));

    const publicUrl = `${config.publicBaseUrl}/${encodeURI(key)}`;

    return res.status(200).json({
      success: true,
      key,
      bucket: config.bucket,
      url: publicUrl,
      publicUrl,
      size: bodyBuffer.length,
      contentType,
    });
  } catch (err) {
    console.error('S3 upload error in /api/upload:', err);
    return res.status(500).json({
      error: err?.message || 'Failed to upload asset to storage.',
    });
  }
}
