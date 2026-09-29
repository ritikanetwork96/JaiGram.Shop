/**
 * JaiGram Shop — Unified Cloudflare Worker with Static Assets & Serverless APIs
 * Directs /api/* requests to serverless API handlers and all other requests to static assets
 */

import ordersHandler from './api/orders.js';
import uploadHandler from './api/upload.js';
import customerAuthHandler from './api/auth/customer.js';
import sendOtpHandler from './api/auth/send-otp.js';
import verifyOtpHandler from './api/auth/verify-otp.js';
import mailSendHandler from './api/mail/send.js';
import sellerApplyHandler from './api/seller/apply.js';
import sellerApproveHandler from './api/seller/approve.js';
import sellerAuthHandler from './api/seller/auth.js';
import sellerProductsHandler from './api/seller/products.js';
import reportsHandler from './api/reports.js';
import mediaHandler from './api/media.js';
import { RUNTIME_ENV } from './runtime-secrets.js';

const ROUTE_HANDLERS = {
  'orders': ordersHandler,
  'upload': uploadHandler,
  'reports': reportsHandler,
  'media': mediaHandler,
  'auth/customer': customerAuthHandler,
  'auth/send-otp': sendOtpHandler,
  'auth/verify-otp': verifyOtpHandler,
  'mail/send': mailSendHandler,
  'seller/apply': sellerApplyHandler,
  'seller/approve': sellerApproveHandler,
  'seller/auth': sellerAuthHandler,
  'seller/products': sellerProductsHandler,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ━━ 1. SERVERLESS API ROUTER (/api/*) ━━
    if (url.pathname.startsWith('/api/')) {
      // 1a. Inject Cloudflare Worker environment secrets into process.env
      if (typeof globalThis.process === 'undefined') {
        globalThis.process = { env: {} };
      } else if (!globalThis.process.env) {
        globalThis.process.env = {};
      }

      // First apply RUNTIME_ENV bridged from Cloudflare build variables
      if (typeof RUNTIME_ENV === 'object') {
        for (const [k, v] of Object.entries(RUNTIME_ENV)) {
          if (v && typeof v === 'string') {
            globalThis.process.env[k] = v;
          }
        }
      }

      if (env && typeof env === 'object') {
        for (const [k, v] of Object.entries(env)) {
          if (typeof v === 'string') {
            globalThis.process.env[k] = v;
          }
        }
        // Explicitly map known keys in case env uses non-enumerable getters
        const knownKeys = [
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
        for (const key of knownKeys) {
          if (env[key] !== undefined && env[key] !== null) {
            globalThis.process.env[key] = String(env[key]);
          }
        }
      }

      // 1b. Match route handler
      const routeKey = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
      const handler = ROUTE_HANDLERS[routeKey];
      if (!handler) {
        return new Response(JSON.stringify({ error: `API route not found: ${url.pathname}` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 1c. Adapter: Map Cloudflare Request to Node.js req/res
      const method = request.method;
      const headers = {};
      for (const [k, v] of request.headers.entries()) {
        headers[k.toLowerCase()] = v;
      }

      let body = null;
      if (method !== 'GET' && method !== 'HEAD') {
        const ct = (headers['content-type'] || '').toLowerCase();
        if (ct.includes('application/json')) {
          try {
            body = await request.json();
          } catch (_) {
            try {
              const text = await request.text();
              body = JSON.parse(text);
            } catch (_) {
              body = null;
            }
          }
        } else {
          try {
            const text = await request.text();
            try {
              body = JSON.parse(text);
            } catch (_) {
              body = text;
            }
          } catch (_) {
            body = null;
          }
        }
      }

      const query = Object.fromEntries(url.searchParams.entries());

      let statusCode = 200;
      const resHeaders = new Headers();
      let resBody = null;

      const req = {
        method,
        url: request.url,
        headers,
        query,
        env: { ...(typeof RUNTIME_ENV === 'object' ? RUNTIME_ENV : {}), ...(env || {}) },
      };

      const res = {
        status(code) {
          statusCode = code;
          return res;
        },
        statusCode: 200,
        setHeader(name, value) {
          resHeaders.set(name, value);
          return res;
        },
        getHeader(name) {
          return resHeaders.get(name);
        },
        json(data) {
          if (!resHeaders.has('Content-Type')) {
            resHeaders.set('Content-Type', 'application/json');
          }
          resBody = JSON.stringify(data);
          return res;
        },
        send(data) {
          resBody = typeof data === 'object' ? JSON.stringify(data) : String(data);
          return res;
        },
        end(data) {
          if (data !== undefined) resBody = data;
          return res;
        },
      };

      try {
        await handler(req, res);
      } catch (err) {
        console.error(`Error in /api/${routeKey}:`, err);
        return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(resBody, {
        status: statusCode,
        headers: resHeaders,
      });
    }

    // ━━ 2. STATIC ASSETS SERVING VIA CLOUDFLARE ASSETS BINDING ━━
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }

      // Clean URL Fallback: Try with .html if user requested /login, /about, /payment, etc.
      if (request.method === 'GET' && !url.pathname.includes('.')) {
        const cleanPath = url.pathname.replace(/\/+$/, '');
        const htmlRequest = new Request(new URL(`${cleanPath}.html${url.search}`, request.url), request);
        const htmlResponse = await env.ASSETS.fetch(htmlRequest);
        if (htmlResponse.status !== 404) {
          return htmlResponse;
        }

        // Try /path/index.html (e.g. /user -> /user/index.html)
        const indexRequest = new Request(new URL(`${cleanPath}/index.html${url.search}`, request.url), request);
        const indexResponse = await env.ASSETS.fetch(indexRequest);
        if (indexResponse.status !== 404) {
          return indexResponse;
        }
      }

      return assetResponse;
    }

    return new Response('Not Found', { status: 404 });
  },
};
