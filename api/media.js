import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import path from 'node:path';

function getMimeType(filename = '') {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    case 'avif': return 'image/avif';
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'json': return 'application/json';
    case 'pdf': return 'application/pdf';
    default: return 'application/octet-stream';
  }
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Resolve asset key from query params or URL path
  const urlPath = req.url || '';
  let rawPath = req.query.path || '';
  if (!rawPath && urlPath.includes('/media/')) {
    rawPath = urlPath.split('/media/')[1].split('?')[0];
  }
  const key = decodeURIComponent(String(rawPath || '')).replace(/^\/+|\/+$/g, '');

  if (!key) {
    return res.status(400).json({ error: 'Media asset key required' });
  }

  const mimeType = getMimeType(key);

  // 2. Try Cloudflare R2 S3 Client Direct Fetch
  try {
    const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/+$/, '');
    const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
    const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
    const bucket = (process.env.R2_BUCKET || 'linkadda-media').trim();

    if (endpoint && accessKeyId && secretAccessKey) {
      const s3 = new S3Client({
        endpoint,
        region: process.env.R2_REGION || 'auto',
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
      });

      let s3Res;
      const candidateKeys = [key];
      if (key.includes('/')) {
        candidateKeys.push(key.split('/').pop());
      } else {
        candidateKeys.push(`products/${key}`, `seller_products/${key}`, `categories/${key}`, `orders/${key}`);
      }

      for (const k of candidateKeys) {
        try {
          s3Res = await s3.send(new GetObjectCommand({
            Bucket: bucket,
            Key: k,
          }));
          if (s3Res) break;
        } catch (_) {}
      }

      if (!s3Res) {
        throw new Error(`Asset ${key} not found in R2 bucket`);
      }

      const buf = await streamToBuffer(s3Res.Body);
      const totalLen = buf.length;
      res.setHeader('Content-Type', s3Res.ContentType || mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (s3Res.ETag) res.setHeader('ETag', s3Res.ETag);

      const range = req.headers.range || req.headers.Range;
      if (range && range.startsWith('bytes=')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalLen - 1;
        if (!isNaN(start) && start < totalLen) {
          const chunkEnd = Math.min(end, totalLen - 1);
          const chunk = buf.slice(start, chunkEnd + 1);
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${chunkEnd}/${totalLen}`);
          res.setHeader('Content-Length', String(chunk.length));
          if (req.method === 'HEAD') return res.end();
          return res.send(chunk);
        }
      }

      res.setHeader('Content-Length', String(totalLen));
      if (req.method === 'HEAD') {
        return res.status(200).end();
      }
      return res.status(200).send(buf);
    }
  } catch (r2Err) {
    // Fallback to local files if R2 does not have key or network unavailable
  }

  // 3. Fallback: Check local bundled `images/` directory
  try {
    const fn = path.basename(key);
    const possiblePaths = [
      path.join(process.cwd(), 'images', fn),
      path.join(process.cwd(), 'images', fn.startsWith('prod_') ? fn : `prod_${fn}`),
      path.join(process.cwd(), 'images', fn.replace(/^prod_/, '')),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        const fileBuf = fs.readFileSync(p);
        res.setHeader('Content-Type', getMimeType(p));
        res.setHeader('Content-Length', String(fileBuf.length));
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        if (req.method === 'HEAD') return res.status(200).end();
        return res.status(200).send(fileBuf);
      }
    }
  } catch (_) {}

  return res.status(404).json({ error: 'Asset not found', key });
}
