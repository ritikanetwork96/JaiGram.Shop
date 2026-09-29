/**
 * Cloudflare Pages Functions Adapter Router (/api/*)
 * Enables seamless execution of LinkAdda Serverless APIs on Cloudflare Pages
 */
import ordersHandler from '../../api/orders.js';
import uploadHandler from '../../api/upload.js';
import customerAuthHandler from '../../api/auth/customer.js';
import sendOtpHandler from '../../api/auth/send-otp.js';
import verifyOtpHandler from '../../api/auth/verify-otp.js';
import mailSendHandler from '../../api/mail/send.js';
import sellerApplyHandler from '../../api/seller/apply.js';
import sellerApproveHandler from '../../api/seller/approve.js';
import sellerAuthHandler from '../../api/seller/auth.js';
import sellerProductsHandler from '../../api/seller/products.js';
import reportsHandler from '../../api/reports.js';
import mediaHandler from '../../api/media.js';

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

export async function onRequest(context) {
  const { request, env, params } = context;

  // 1. Populate process.env with Cloudflare Pages environment secrets
  if (env && typeof env === 'object') {
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') {
        process.env[k] = v;
      }
    }
  }

  // 2. Resolve route path (e.g. /api/orders or /api/auth/send-otp)
  const routeSegments = Array.isArray(params.route) 
    ? params.route 
    : (params.route ? [params.route] : []);
  const routeKey = routeSegments.join('/').replace(/^\/+|\/+$/g, '');

  const handler = ROUTE_HANDLERS[routeKey];
  if (!handler) {
    return new Response(JSON.stringify({ error: `API route not found: /api/${routeKey}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 3. Adapter: Map Cloudflare Fetch Request to Node.js req/res
  const url = new URL(request.url);
  const method = request.method;
  const headers = {};
  for (const [k, v] of request.headers.entries()) {
    headers[k.toLowerCase()] = v;
  }

  let body = null;
  if (method !== 'GET' && method !== 'HEAD') {
    const text = await request.text();
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = text;
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
    body,
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
