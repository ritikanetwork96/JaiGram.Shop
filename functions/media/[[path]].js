/**
 * Cloudflare Pages Function: /media/*
 * Native Edge Delivery for Cloudflare R2 Storage (linkadda-media bucket)
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

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

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // 1. Resolve storage key from path
  const pathSegments = Array.isArray(params.path) 
    ? params.path 
    : (params.path ? [params.path] : []);
  const key = decodeURIComponent(pathSegments.join('/').replace(/^\/+|\/+$/g, ''));

  if (!key) {
    return new Response('Asset key required', { status: 400 });
  }

  // 2. Try Native Cloudflare Pages R2 Binding (env.R2_MEDIA or env.R2_BUCKET)
  const candidateKeys = [key];
  if (key.includes('/')) {
    candidateKeys.push(key.split('/').pop());
  } else {
    candidateKeys.push(`products/${key}`, `seller_products/${key}`, `categories/${key}`, `orders/${key}`);
  }

  const r2Binding = env?.R2_MEDIA || env?.R2_BUCKET || env?.MEDIA_BUCKET;
  if (r2Binding && typeof r2Binding.get === 'function') {
    try {
      let object = null;
      for (const k of candidateKeys) {
        try {
          object = await r2Binding.get(k);
          if (object) break;
        } catch (_) {}
      }

      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        if (!headers.get('Content-Type')) {
          headers.set('Content-Type', getMimeType(key));
        }
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Access-Control-Allow-Origin', '*');

        if (request.method === 'HEAD') {
          return new Response(null, { status: 200, headers });
        }
        return new Response(object.body, { status: 200, headers });
      }
    } catch (err) {
      console.error('Cloudflare R2 binding error:', err);
    }
  }

  // 3. Fallback: S3Client Direct to Cloudflare R2 S3 Endpoint
  try {
    const endpoint = (env?.R2_ENDPOINT || process.env?.R2_ENDPOINT || 'https://e251083d3d3878442daf244a17d304e5.r2.cloudflarestorage.com').replace(/\/+$/, '');
    const accessKeyId = (env?.R2_ACCESS_KEY_ID || process.env?.R2_ACCESS_KEY_ID || 'd296eace59751e50b03caad7be7c9e29').trim();
    const secretAccessKey = (env?.R2_SECRET_ACCESS_KEY || process.env?.R2_SECRET_ACCESS_KEY || '6c01e7ca5baee5253e1744e18cd7086a83305b9e17c3ad250ee4153e0bc1dea5').trim();
    const bucket = (env?.R2_BUCKET || process.env?.R2_BUCKET || 'linkadda-media').trim();

    if (endpoint && accessKeyId && secretAccessKey) {
      const s3 = new S3Client({
        endpoint,
        region: 'auto',
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
      });

      let s3Res;
      for (const k of candidateKeys) {
        try {
          s3Res = await s3.send(new GetObjectCommand({
            Bucket: bucket,
            Key: k,
          }));
          if (s3Res) break;
        } catch (_) {}
      }

      if (s3Res) {
        const headers = new Headers();
        headers.set('Content-Type', s3Res.ContentType || getMimeType(key));
        if (s3Res.ContentLength) headers.set('Content-Length', String(s3Res.ContentLength));
        if (s3Res.ETag) headers.set('ETag', s3Res.ETag);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Access-Control-Allow-Origin', '*');

        if (request.method === 'HEAD') {
          return new Response(null, { status: 200, headers });
        }
        return new Response(s3Res.Body, { status: 200, headers });
      }
    }
  } catch (s3Err) {
    console.error(`R2 S3 fetch error for key "${key}":`, s3Err?.message || s3Err);
  }

  return new Response(`Media asset not found in Cloudflare R2: ${key}`, {
    status: 404,
    headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
  });
}
