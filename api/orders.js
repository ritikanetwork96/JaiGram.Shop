import crypto from 'node:crypto';
import {
  handleCors,
  getFirebaseAdminToken,
  verifyAdminRequest,
  deriveCustomerId,
  isValidEmail,
  getAuthSecret,
} from './_utils.js';

const RTDB_URL = 'https://linkadda-cd1da-default-rtdb.firebaseio.com';

function verifyCustomerToken(req, uid, email) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const tokenVal = authHeader.slice(7).trim();
  if (!tokenVal.includes('.')) return false;
  const [tokenUid, tokenSig] = tokenVal.split('.');
  if (tokenUid !== uid) return false;
  try {
    const secret = getAuthSecret();
    const expectedSig = crypto.createHmac('sha256', secret).update(`customer:${uid}:${email}`).digest('hex');
    const sigBuf = Buffer.from(tokenSig, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  } catch (_) {
    return false;
  }
}

/**
 * Normalizes an order record from various schemas
 */
function normalizeOrder(id, raw) {
  if (!raw || typeof raw !== 'object') return null;

  const orderId = raw.orderId || raw.id || id;
  const title = raw.productTitle || raw.productName || raw.title || raw.name || 'Digital Product';
  const email = (raw.customerEmail || raw.buyerEmail || raw.email || raw.buyer || '').toLowerCase().trim();
  const uid = raw.customerUid || raw.buyerUid || raw.uid || (email ? deriveCustomerId(email) : '');
  const buyerName = raw.customerName || raw.buyer || raw.name || (email ? email.split('@')[0] : 'Customer');
  const amount = raw.amount || raw.price || raw.total || 0;
  const amountDisplay = raw.amountDisplay || (amount ? `₹${amount}` : '₹0');
  const status = raw.status || raw.orderStatus || 'pending';
  const date = raw.date || (raw.createdAt ? new Date(raw.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Recently');
  const timestamp = Number(raw.createdAt || raw.timestamp || Date.now());

  return {
    productId: raw.productId || '',
    productTitle: title,
    productName: title,
    title,
    sellerName: (raw.sellerName && raw.sellerName !== 'JaiGram Verified' && raw.sellerName !== 'LinkAdda Verified') ? raw.sellerName : (raw.seller && raw.seller !== 'JaiGram Verified' && raw.seller !== 'LinkAdda Verified' ? raw.seller : 'Trusted brother'),
    seller: (raw.sellerName && raw.sellerName !== 'JaiGram Verified' && raw.sellerName !== 'LinkAdda Verified') ? raw.sellerName : (raw.seller && raw.seller !== 'JaiGram Verified' && raw.seller !== 'LinkAdda Verified' ? raw.seller : 'Trusted brother'),
    buyerEmail: email,
    email,
    customerName: buyerName,
    buyer: buyerName,
    amount,
    price: amount,
    amountDisplay,
    paymentMethod: raw.paymentMethod || raw.method || 'Online Payment',
    downloadLink: raw.downloadLink || raw.fileUrl || raw.orderLink || '',
    fileUrl: raw.fileUrl || raw.downloadLink || '',
    orderLink: raw.orderLink || '',
    image: raw.image || raw.thumbnail || raw.productImage || '',
    thumbnail: raw.thumbnail || raw.image || '',
    badge: raw.badge || raw.category || 'Digital Content',
    category: raw.category || raw.badge || 'Digital Content',
    status,
    orderStatus: status,
    date,
    createdAt: timestamp,
    updatedAt: Number(raw.updatedAt || timestamp),
    ...raw,
    // Ensure critical normalized keys override
    id: orderId,
    orderId,
    customerEmail: email,
    customerUid: uid,
  };
}

export default async function handler(req, res) {
  if (handleCors(req, res, 'GET, POST, PUT, OPTIONS')) return;

  const token = await getFirebaseAdminToken();
  const authQuery = token ? `?auth=${encodeURIComponent(token)}` : '';

  // Extract query parameters
  const query = (() => {
    if (req.query && typeof req.query === 'object') return req.query;
    try {
      const url = new URL(req.url || '', 'http://localhost');
      return Object.fromEntries(url.searchParams.entries());
    } catch (_) {
      return {};
    }
  })();

  // ━━━ GET: FETCH ORDERS ━━━
  if (req.method === 'GET') {
    const emailParam = String(query.email || '').toLowerCase().trim();
    const uidParam = String(query.uid || '').trim();
    const orderIdParam = String(query.orderId || query.id || '').trim();
    const wantsAll = query.all === 'true' || query.list === 'true';

    // If requesting all orders, verify admin access
    if (wantsAll && !emailParam && !uidParam && !orderIdParam) {
      const isAdmin = await verifyAdminRequest(req);
      if (!isAdmin) {
        return res.status(403).json({ error: 'Unauthorized: Admin authentication required to list all orders.' });
      }
    }

    try {
      const ordersMap = new Map();

      // 1. Fetch from /orders.json
      try {
        const r1 = await fetch(`${RTDB_URL}/orders.json${authQuery}`);
        if (r1.ok) {
          const d1 = await r1.json();
          if (d1 && typeof d1 === 'object') {
            Object.keys(d1).forEach(k => {
              const norm = normalizeOrder(k, d1[k]);
              if (norm) ordersMap.set(norm.orderId, norm);
            });
          }
        }
      } catch (e) {
        console.warn('Error fetching /orders.json:', e.message);
      }

      // 2. Fetch from /events/orders.json (backup sync node)
      try {
        const r2 = await fetch(`${RTDB_URL}/events/orders.json${authQuery}`);
        if (r2.ok) {
          const d2 = await r2.json();
          if (d2 && typeof d2 === 'object') {
            Object.keys(d2).forEach(k => {
              const norm = normalizeOrder(k, d2[k]);
              if (norm) {
                // If already present, merge with latest updates
                const existing = ordersMap.get(norm.orderId);
                ordersMap.set(norm.orderId, { ...(existing || {}), ...norm });
              }
            });
          }
        }
      } catch (e) {
        console.warn('Error fetching /events/orders.json:', e.message);
      }

      let allOrders = Array.from(ordersMap.values());

      const cleanLookup = (s) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').trim().toLowerCase();

      // Filter by specific orderId or orderIds list if requested
      const orderIdsParam = String(query.orderIds || query.ids || '').trim();
      const requestedIdSet = orderIdsParam 
        ? new Set(orderIdsParam.split(',').map(cleanLookup).filter(Boolean))
        : null;

      if (orderIdParam) {
        const targetClean = cleanLookup(orderIdParam);
        let found = allOrders.find(o => cleanLookup(o.orderId) === targetClean || cleanLookup(o.id) === targetClean);
        
        // Direct RTDB fallback if not found in cache
        if (!found && targetClean) {
          try {
            const rDirect = await fetch(`${RTDB_URL}/orders/${encodeURIComponent(targetClean)}.json${authQuery}`);
            if (rDirect.ok) {
              const dDirect = await rDirect.json();
              if (dDirect) found = normalizeOrder(targetClean, dDirect);
            }
          } catch (_) {}
        }

        // Direct order_approvals fallback
        if (!found && targetClean) {
          try {
            const rApp = await fetch(`${RTDB_URL}/order_approvals/${encodeURIComponent(targetClean)}.json`);
            if (rApp.ok) {
              const dApp = await rApp.json();
              if (dApp) found = normalizeOrder(targetClean, dApp);
            }
          } catch (_) {}
        }

        if (found) {
          const isAdmin = await verifyAdminRequest(req);
          const orderEmail = String(found.customerEmail || found.buyerEmail || '').toLowerCase().trim();
          const targetUid = found.customerUid || (orderEmail ? deriveCustomerId(orderEmail) : '');
          const isCustomer = Boolean(targetUid && (verifyCustomerToken(req, targetUid, orderEmail) || (emailParam && emailParam.toLowerCase() === orderEmail && verifyCustomerToken(req, targetUid, emailParam))));

          const orderStatus = String(found.status || found.orderStatus || '').toLowerCase();
          const isApproved = ['approved', 'completed', 'paid', 'confirmed'].includes(orderStatus);

          // If neither admin nor authenticated session token, redact sensitive payment proof screenshots
          // but preserve fulfillment download link if approved
          if (!isAdmin && !isCustomer) {
            const sanitizedOrder = {
              ...found,
              screenshot: undefined,
              screenshotUrl: undefined,
              paymentProof: undefined,
              proofUrl: undefined,
              downloadLink: isApproved ? (found.downloadLink || found.fileUrl || found.orderLink || '') : undefined,
              fileUrl: isApproved ? (found.fileUrl || found.downloadLink || '') : undefined,
              orderLink: isApproved ? (found.orderLink || found.downloadLink || '') : undefined,
            };
            return res.status(200).json({ success: true, count: 1, order: sanitizedOrder });
          }

          return res.status(200).json({ success: true, count: 1, order: found });
        }
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      // Filter for customer orders: match by specific order IDs OR customer email / UID
      if ((requestedIdSet && requestedIdSet.size > 0) || emailParam || uidParam) {
        const computedUid = emailParam ? deriveCustomerId(emailParam) : '';
        const targetUid = uidParam || computedUid;
        const isAdmin = await verifyAdminRequest(req);
        const isCustomer = verifyCustomerToken(req, targetUid, emailParam);

        allOrders = allOrders.filter(ord => {
          const oId = cleanLookup(ord.orderId || ord.id);
          // If customer has the exact order ID from local storage, allow match!
          if (requestedIdSet && requestedIdSet.has(oId)) return true;

          // Or if order matches customer's email or UID
          const ordEmail = (ord.customerEmail || ord.buyerEmail || ord.email || '').toLowerCase().trim();
          const ordUid = ord.customerUid || ord.buyerUid || ord.uid || '';
          if (emailParam && ordEmail === emailParam) return true;
          if (uidParam && ordUid === uidParam) return true;
          if (computedUid && ordUid === computedUid) return true;
          return false;
        });

        // If not admin and not token authenticated, redact payment proof screenshots
        // but ensure approved orders keep their download/access links!
        if (!isAdmin && !isCustomer) {
          allOrders = allOrders.map(ord => {
            const orderStatus = String(ord.status || ord.orderStatus || '').toLowerCase();
            const isApproved = ['approved', 'completed', 'paid', 'confirmed'].includes(orderStatus);
            return {
              ...ord,
              screenshot: undefined,
              screenshotUrl: undefined,
              paymentProof: undefined,
              proofUrl: undefined,
              downloadLink: isApproved ? (ord.downloadLink || ord.fileUrl || ord.orderLink || '') : undefined,
              fileUrl: isApproved ? (ord.fileUrl || ord.downloadLink || '') : undefined,
              orderLink: isApproved ? (ord.orderLink || ord.downloadLink || '') : undefined,
            };
          });
        }
      }

      // Enrich orders with product metadata (images, thumbnails, category, real download link) if missing
      try {
        const needsProductEnrich = allOrders.filter(o => o.productId && (!o.image || !o.thumbnail || !o.downloadLink || o.downloadLink.startsWith('payment.html')));
        if (needsProductEnrich.length > 0) {
          const pr = await fetch(`${RTDB_URL}/products.json`);
          if (pr.ok) {
            const prods = await pr.json();
            if (prods && typeof prods === 'object') {
              allOrders.forEach(ord => {
                if (ord.productId && prods[ord.productId]) {
                  const p = prods[ord.productId];
                  if (!ord.image || ord.image === '') ord.image = p.thumbnail || p.image || '';
                  if (!ord.thumbnail || ord.thumbnail === '') ord.thumbnail = p.thumbnail || p.image || '';
                  if (!ord.badge || ord.badge === 'Digital Content') ord.badge = p.badge || p.category || ord.badge;
                  if (!ord.category || ord.category === 'Digital Content') ord.category = p.category || p.badge || ord.category;
                  if (!ord.sellerName || ord.sellerName === 'JaiGram Verified' || ord.sellerName === 'LinkAdda Verified') ord.sellerName = p.sellerStoreName || p.sellerName || p.storeName || 'Trusted brother';
                  if (!ord.seller || ord.seller === 'JaiGram Verified' || ord.seller === 'LinkAdda Verified') ord.seller = p.sellerStoreName || p.sellerName || p.storeName || 'Trusted brother';
                  if (p.specDelivery) ord.specDelivery = p.specDelivery;
                  if (p.specAccess) ord.specAccess = p.specAccess;
                  const realLink = p.telegramLink || p.downloadLink || p.fileUrl || '';
                  if (realLink && (!ord.downloadLink || ord.downloadLink.startsWith('payment.html'))) {
                    ord.downloadLink = realLink;
                    ord.fileUrl = realLink;
                  }
                }
              });
            }
          }
        }
      } catch (eProd) {
        console.warn('Product enrichment notice:', eProd.message);
      }

      // Sort newest first
      allOrders.sort((a, b) => (Number(b.createdAt || 0) - Number(a.createdAt || 0)));

      return res.status(200).json({
        success: true,
        count: allOrders.length,
        orders: allOrders,
      });
    } catch (err) {
      console.error('API orders GET error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to fetch orders.' });
    }
  }

  // ━━━ POST / PUT: SAVE / CREATE / UPDATE ORDER ━━━
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      let body = req.body;
      if (!body && typeof req.on === 'function') {
        body = await new Promise((resolve) => {
          let data = '';
          req.on('data', chunk => { data += chunk; });
          req.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (_) { resolve({}); }
          });
          req.on('error', () => resolve({}));
        });
      } else if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { body = {}; }
      }
      body = body || {};

      const orderId = String(body.orderId || body.id || `ORD_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`).trim();
      const email = String(body.customerEmail || body.buyerEmail || body.email || '').toLowerCase().trim();
      const uid = String(body.customerUid || body.buyerUid || body.uid || (email ? deriveCustomerId(email) : '')).trim();
      const buyerName = String(body.customerName || body.buyer || body.name || (email ? email.split('@')[0] : 'Customer')).trim();
      const now = Date.now();

      const isAdminCaller = await verifyAdminRequest(req);
      const requestedStatus = String(body.status || body.orderStatus || 'pending').toLowerCase().trim();
      // SECURITY: Only authorized Master Admin can mark an order as completed or approved
      const status = isAdminCaller ? (requestedStatus || 'pending') : 'pending';

      let sellerId = String(body.sellerId || '').trim();
      let sellerName = String(body.sellerName || body.seller || '').trim();
      let productId = String(body.productId || '').trim();
      let productTitle = String(body.productTitle || body.productName || body.title || body.name || '').trim();
      let thumbnail = String(body.thumbnail || body.image || body.productImage || '').trim();
      let downloadLink = String(body.downloadLink || body.fileUrl || body.orderLink || '').trim();

      // If productId is provided, automatically enrich seller and product info from RTDB /products/${productId}.json
      if (productId && (!sellerName || !sellerId || !productTitle || !downloadLink || !thumbnail)) {
        try {
          const pr = await fetch(`${RTDB_URL}/products/${encodeURIComponent(productId)}.json`, {
            signal: AbortSignal.timeout(4000),
          });
          if (pr.ok) {
            const p = await pr.json();
            if (p && typeof p === 'object') {
              if (!sellerName || sellerName === 'JaiGram Verified' || sellerName === 'LinkAdda Verified') sellerName = p.sellerStoreName || p.sellerName || p.storeName || p.seller || 'Trusted brother';
              if (!sellerId) sellerId = p.sellerId || '';
              if (!productTitle) productTitle = p.title || p.name || productTitle;
              if (!thumbnail) thumbnail = p.thumbnail || p.image || '';
              if (!downloadLink) downloadLink = p.telegramLink || p.downloadLink || p.fileUrl || '';
            }
          }
        } catch (_) {}
      }

      const orderPayload = {
        ...body,
        id: orderId,
        orderId,
        productId,
        productTitle: productTitle || 'VIP Digital Pass',
        productName: productTitle || 'VIP Digital Pass',
        title: productTitle || 'VIP Digital Pass',
        sellerId: sellerId || '',
        sellerName: (sellerName && sellerName !== 'JaiGram Verified' && sellerName !== 'LinkAdda Verified') ? sellerName : 'Trusted brother',
        seller: (sellerName && sellerName !== 'JaiGram Verified' && sellerName !== 'LinkAdda Verified') ? sellerName : 'Trusted brother',
        downloadLink: downloadLink || body.downloadLink || '',
        fileUrl: downloadLink || body.fileUrl || '',
        thumbnail: thumbnail || body.thumbnail || '',
        image: thumbnail || body.image || '',
        customerEmail: email,
        buyerEmail: email,
        customerUid: uid,
        customerName: buyerName,
        buyer: buyerName,
        createdAt: Number(body.createdAt || now),
        updatedAt: now,
        status,
      };

      // 1. Save to /orders/${orderId}
      let savedMain = false;
      try {
        const rMain = await fetch(`${RTDB_URL}/orders/${encodeURIComponent(orderId)}.json${authQuery}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload),
        });
        if (rMain.ok) savedMain = true;
      } catch (e) {
        console.warn('Failed saving to /orders:', e.message);
      }

      // 2. Also save to /events/orders/${orderId} for redundancy
      try {
        await fetch(`${RTDB_URL}/events/orders/${encodeURIComponent(orderId)}.json${authQuery}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload),
        });
      } catch (_) {}

      // 2b. Sync status changes to order_approvals node for real-time customer access
      if (status === 'approved' || status === 'rejected' || status === 'completed' || status === 'paid') {
        try {
          const appPayload = {
            orderId,
            productName: productTitle || 'VIP Digital Pass',
            downloadLink: (status === 'approved' || status === 'completed' || status === 'paid') ? (downloadLink || '') : '',
            telegramLink: (status === 'approved' || status === 'completed' || status === 'paid') ? (downloadLink || '') : '',
            channelLink: (status === 'approved' || status === 'completed' || status === 'paid') ? (downloadLink || '') : '',
            status,
            orderStatus: status,
            reviewedAt: now,
            customerEmail: email,
          };
          await fetch(`${RTDB_URL}/order_approvals/${encodeURIComponent(orderId)}.json${authQuery}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appPayload),
          });
        } catch (_) {}
      }

      if (email && isValidEmail(email) && uid) {
        try {
          // Fetch existing customer to preserve fields
          let existingCust = null;
          try {
            const cr = await fetch(`${RTDB_URL}/customers/${encodeURIComponent(uid)}.json${authQuery}`);
            if (cr.ok) existingCust = await cr.json();
          } catch (_) {}

          if (!existingCust) {
            try {
              const er = await fetch(`${RTDB_URL}/events/customers/${encodeURIComponent(uid)}.json${authQuery}`);
              if (er.ok) existingCust = await er.json();
            } catch (_) {}
          }

          const updatedCustomer = {
            uid,
            email,
            displayName: existingCust?.displayName || buyerName || email.split('@')[0],
            phone: body.customerPhone || body.phone || existingCust?.phone || '',
            lastOrderAt: now,
            lastActiveAt: new Date().toISOString(),
            createdAt: existingCust?.createdAt || now,
            updatedAt: now,
            hasSavedName: existingCust?.hasSavedName || false,
            totalOrders: (Number(existingCust?.totalOrders) || 0) + 1,
            walletBalance: (() => {
              let bal = existingCust?.walletBalance !== undefined ? Number(existingCust.walletBalance) : 0.00;
              if (body.paymentMethod === 'wallet' || body.method === 'wallet') {
                const deduct = Number(body.amount || body.price || 0);
                bal = Math.max(0, bal - deduct);
              } else if (isAdminCaller && body.type === 'wallet_topup' && (requestedStatus === 'completed' || requestedStatus === 'approved')) {
                // SECURITY: Only verified admin can approve wallet top-ups
                bal += Number(body.amount || body.price || 0);
              }
              return bal;
            })(),
          };

          // Save customer profile to both nodes
          await fetch(`${RTDB_URL}/events/customers/${encodeURIComponent(uid)}.json${authQuery}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedCustomer),
          });
          await fetch(`${RTDB_URL}/customers/${encodeURIComponent(uid)}.json${authQuery}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedCustomer),
          });

          // If approved by admin as wallet top-up, dispatch official wallet receipt email to customer
          if (isAdminCaller && body.type === 'wallet_topup' && (requestedStatus === 'completed' || requestedStatus === 'approved') && email) {
            const brevoKey = (process.env.BREVO_API_KEY || '').trim();
            if (brevoKey) {
              const topupAmt = Number(body.amount || body.price || 0);
              const senderEmail = (process.env.BREVO_SENDER_EMAIL || 'ritikanetwork96@gmail.com').trim();
              const senderName = (process.env.BREVO_SENDER_NAME || 'JaiGram Shop').trim();
              const orderReceiptId = orderId;
              const payMethod = body.paymentMethod || body.method || 'Online Payment';
              const formattedDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

              const brevoPayload = {
                sender: { name: senderName, email: senderEmail },
                to: [{ email, name: buyerName }],
                subject: `💰 Payment Receipt: ₹${topupAmt} Added to Your JaiGram Wallet (${orderReceiptId})`,
                htmlContent: `
                  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #07060c; color: #ffffff; padding: 32px 24px; border-radius: 16px; max-width: 520px; margin: 0 auto; border: 1px solid rgba(16, 185, 129, 0.3);">
                    <div style="text-align: center; margin-bottom: 24px;">
                      <div style="font-size: 26px; font-weight: 800; color: #ffffff;">JaiGram <span style="color: #10b981;">&#9819;</span> Shop</div>
                      <div style="font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #10b981; font-weight: 700; margin-top: 4px;">Official Wallet Top-up Receipt</div>
                    </div>
                    <div style="text-align: center; margin-bottom: 20px;">
                      <span style="display: inline-block; padding: 5px 14px; border-radius: 9999px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); color: #34d399; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px;">
                        &#10004; Funds Added Successfully
                      </span>
                    </div>
                    <h2 style="color: #ffffff; margin: 0 0 10px; font-size: 19px; text-align: center;">Hello ${buyerName}! 🎉</h2>
                    <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin-bottom: 22px; text-align: center;">
                      Aapke JaiGram Wallet me <strong>₹${topupAmt.toFixed(2)}</strong> successfully add ho gaye hain. Ab aap instant 1-click checkout se koi bhi pack khareed sakte hain.
                    </p>
                    <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 14px; padding: 20px; margin-bottom: 22px; text-align: center;">
                      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">Amount Credited</div>
                      <div style="font-size: 32px; font-weight: 850; color: #ffffff; letter-spacing: -0.5px; margin-bottom: 8px;">₹${topupAmt.toFixed(2)}</div>
                      <div style="display: inline-block; padding: 3px 12px; border-radius: 6px; background: rgba(255, 255, 255, 0.06); font-size: 12px; color: #e2e8f0;">
                        New Wallet Balance: <strong style="color: #34d399;">₹${updatedCustomer.walletBalance.toFixed(2)}</strong>
                      </div>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; color: #cbd5e1;">
                      <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                        <td style="padding: 9px 0; color: #94a3b8;">Receipt / Ref ID:</td>
                        <td style="padding: 9px 0; color: #ffffff; font-weight: 700; text-align: right; font-family: monospace;">${orderReceiptId}</td>
                      </tr>
                      <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                        <td style="padding: 9px 0; color: #94a3b8;">Payment Mode:</td>
                        <td style="padding: 9px 0; color: #ffffff; font-weight: 600; text-align: right;">${payMethod}</td>
                      </tr>
                      <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                        <td style="padding: 9px 0; color: #94a3b8;">Date &amp; Time:</td>
                        <td style="padding: 9px 0; color: #cbd5e1; text-align: right;">${formattedDate}</td>
                      </tr>
                      <tr>
                        <td style="padding: 9px 0; color: #94a3b8;">Status:</td>
                        <td style="padding: 9px 0; color: #34d399; font-weight: 700; text-align: right;">&#10004; Verified &amp; Approved</td>
                      </tr>
                    </table>
                    <div style="text-align: center; margin-bottom: 20px;">
                      <a href="https://jaigram.shop/user" target="_blank" style="background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; padding: 13px 28px; border-radius: 12px; font-weight: 750; font-size: 14px; text-decoration: none; display: inline-block; box-shadow: 0 4px 18px rgba(16, 185, 129, 0.45); letter-spacing: 0.3px;">
                        🚀 Open JaiGram User Dashboard
                      </a>
                    </div>
                    <div style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 24px; padding-top: 16px; text-align: center;">
                      <p style="color: #64748b; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} JaiGram Shop &bull; Official Digital Marketplace</p>
                    </div>
                  </div>
                `
              };

              fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                  'accept': 'application/json',
                  'api-key': brevoKey,
                  'content-type': 'application/json',
                },
                body: JSON.stringify(brevoPayload),
              }).catch((e) => console.warn('Brevo wallet receipt dispatch note:', e.message));
            }
          }

          // If approved by admin for a regular digital product order, dispatch official access email to customer
          if (isAdminCaller && (requestedStatus === 'completed' || requestedStatus === 'approved') && email && body.type !== 'wallet_topup') {
            const brevoKey = (process.env.BREVO_API_KEY || '').trim();
            if (brevoKey) {
              const senderEmail = (process.env.BREVO_SENDER_EMAIL || 'ritikanetwork96@gmail.com').trim();
              const senderName = (process.env.BREVO_SENDER_NAME || 'JaiGram Shop').trim();
              const finalTitle = productTitle || 'VIP Digital Pass';
              const accessLink = downloadLink || body.fileUrl || body.orderLink || 'https://t.me/TRUSTED_BROTHER1234';

              const brevoPayload = {
                sender: { name: senderName, email: senderEmail },
                to: [{ email, name: buyerName }],
                subject: `✅ Payment Approved! Access Your Pack (${finalTitle})`,
                htmlContent: `
                  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #07060c; color: #ffffff; padding: 32px 24px; border-radius: 16px; max-width: 520px; margin: 0 auto; border: 1px solid rgba(16, 185, 129, 0.3);">
                    <div style="text-align: center; margin-bottom: 24px;">
                      <div style="font-size: 26px; font-weight: 800; color: #ffffff;">JaiGram <span style="color: #10b981;">&#9819;</span> Store</div>
                      <div style="font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #10b981; font-weight: 700; margin-top: 4px;">Payment Verified &amp; Approved</div>
                    </div>
                    <h2 style="color: #ffffff; margin: 0 0 12px; font-size: 19px; text-align: center;">Hello ${buyerName}! 🎉</h2>
                    <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6; margin-bottom: 20px; text-align: center;">
                      Your payment for <strong>${finalTitle}</strong> (Order <strong>#${orderId.replace(/^#+/, '')}</strong>) has been verified and approved by JaiGram Admin.
                    </p>
                    <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 22px; border-radius: 14px; margin: 24px 0; text-align: center;">
                      <p style="margin: 0 0 14px; font-size: 13px; color: #94a3b8; font-weight: 600;">Use the button below to join the VIP Telegram channel and access your pack:</p>
                      <a href="${accessLink}" target="_blank" style="background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; padding: 14px 28px; border-radius: 12px; font-weight: 850; font-size: 15px; text-decoration: none; display: inline-block; box-shadow: 0 4px 18px rgba(16, 185, 129, 0.45); letter-spacing: 0.3px;">
                        🚀 Open Telegram VIP Link
                      </a>
                    </div>
                    <p style="color: #64748b; font-size: 12px; margin-top: 24px; text-align: center;">
                      Direct URL: <a href="${accessLink}" style="color: #38bdf8; word-break: break-all;">${accessLink}</a>
                    </p>
                    <div style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 24px; padding-top: 16px; text-align: center;">
                      <p style="color: #64748b; font-size: 11px; margin: 0;">&copy; ${new Date().getFullYear()} JaiGram Shop &bull; 24/7 VIP Support: @JaiGram_Support</p>
                    </div>
                  </div>
                `
              };

              fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: {
                  'accept': 'application/json',
                  'api-key': brevoKey,
                  'content-type': 'application/json',
                },
                body: JSON.stringify(brevoPayload),
              }).catch(e => console.warn('Brevo product approval dispatch note:', e.message));
            }
          }
        } catch (errCust) {
          console.warn('Customer auto-sync error in order save:', errCust.message);
        }
      }

      return res.status(200).json({
        success: true,
        orderId,
        order: orderPayload,
        savedToDatabase: savedMain,
      });
    } catch (err) {
      console.error('API orders POST error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to save order.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
