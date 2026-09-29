import { handleCors, getAuthSecret, getFirebaseAdminToken, verifyAdminRequest, getClientIp, SELLER_MEMORY_STORE } from '../_utils.js';
import { verifySellerToken } from './auth.js';

const RTDB_URL = 'https://linkadda-cd1da-default-rtdb.firebaseio.com';

const engagementRateLimitMap = new Map();
function isEngagementRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60000;
  let history = (engagementRateLimitMap.get(ip) || []).filter(ts => now - ts < windowMs);
  if (history.length >= 35) return true;
  history.push(now);
  engagementRateLimitMap.set(ip, history);
  if (engagementRateLimitMap.size > 2000) {
    for (const [k, arr] of engagementRateLimitMap.entries()) {
      if (!arr.length || now - arr[arr.length - 1] > windowMs) engagementRateLimitMap.delete(k);
    }
  }
  return false;
}

// ━━ PRODUCT SCHEMA NORMALIZER & SANITIZER (ROCK-SOLID GUARANTEE) ━━
export function sanitizeAndNormalizeProduct(product, existingData = {}, defaults = {}, isAdmin = false) {
  if (!product || typeof product !== 'object') return null;

  const adminFlag = Boolean(isAdmin || defaults.isAdmin);

  const rawTitle = String(product.title || product.name || existingData.title || existingData.name || 'Exclusive Pack').trim();
  const title = rawTitle || 'Exclusive Pack';

  let rawSlug = String(product.slug || existingData.slug || '').trim().toLowerCase();
  if (!rawSlug) {
    rawSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
  const slug = rawSlug || `pack-${Date.now().toString(36)}`;

  let productId = String(product.id || existingData.id || '').trim();
  if (!productId) {
    productId = `prod_${slug}_${Date.now().toString(36)}`;
  }

  // Price sanitization: clean numeric strings
  const rawINR = product.priceINR || product.price || existingData.priceINR || existingData.price || '399';
  const cleanINR = String(rawINR).replace(/[^\d.]/g, '').trim() || '399';

  const rawUSD = product.priceUSD || existingData.priceUSD || '14';
  const cleanUSD = String(rawUSD).replace(/[^\d.]/g, '').trim() || '14';

  const rawOrigINR = product.originalPriceINR || product.originalPrice || product.priceOriginal || existingData.originalPriceINR || existingData.priceOriginal;
  const cleanOrigINR = rawOrigINR ? String(rawOrigINR).replace(/[^\d.]/g, '').trim() : String(Math.max(Number(cleanINR) + 100, Math.round(Number(cleanINR) * 1.8 / 10) * 10 - 1));

  const rawOrigUSD = product.originalPriceUSD || product.originalPrice || existingData.originalPriceUSD;
  const cleanOrigUSD = rawOrigUSD ? String(rawOrigUSD).replace(/[^\d.]/g, '').trim() : String(Math.max(Number(cleanUSD) + 5, Math.round(Number(cleanUSD) * 1.8)));

  // Media sanitization
  let images = [];
  if (Array.isArray(product.images)) images = product.images.filter(Boolean);
  else if (Array.isArray(existingData.images)) images = existingData.images.filter(Boolean);

  if (Array.isArray(product.galleryImages)) {
    product.galleryImages.forEach(u => {
      if (u && !images.includes(u)) images.push(u);
    });
  }

  const mainImage = product.coverImage || product.image || product.thumbnail || (images[0] || '') || existingData.coverImage || existingData.image || existingData.thumbnail || '';
  if (mainImage) {
    images = [mainImage, ...images.filter(u => u !== mainImage)];
  }
  if (!images.length && mainImage) images = [mainImage];

  // Guaranteed Order / Checkout link
  let orderLink = String(product.orderLink || existingData.orderLink || '').trim();
  const rawDownloadLink = String(product.downloadLink || product.fileUrl || existingData.downloadLink || existingData.fileUrl || '').trim();

  // If orderLink looks like a direct cloud drive download link (mega.nz, drive.google.com, etc.), preserve it in downloadLink and set orderLink to standard checkout
  const isCloudDrive = /mega\.nz|drive\.google\.com|dropbox\.com|mediafire\.com|t\.me/i.test(orderLink);
  let downloadLink = rawDownloadLink;
  if (isCloudDrive) {
    if (!downloadLink) downloadLink = orderLink;
    orderLink = `payment.html?productId=${encodeURIComponent(productId)}&name=${encodeURIComponent(title)}&inr=${cleanINR}&usd=${cleanUSD}`;
  } else if (!orderLink || orderLink === '#' || orderLink === '/payment.html' || orderLink === 'payment.html') {
    orderLink = `payment.html?productId=${encodeURIComponent(productId)}&name=${encodeURIComponent(title)}&inr=${cleanINR}&usd=${cleanUSD}`;
  }

  // Guaranteed Engagement counters
  const likes = Math.max(0, Number(product.likes !== undefined ? product.likes : (existingData.likes !== undefined ? existingData.likes : 0)));
  const views = Math.max(0, Number(product.views !== undefined ? product.views : (existingData.views !== undefined ? existingData.views : 0)));

  // Seller info
  const sellerId = product.sellerId || existingData.sellerId || defaults.sellerId || 'seller_jaibajpai67';
  const sellerName = String(product.sellerName || existingData.sellerName || defaults.sellerName || '𓆩✶𓆪𝐓𝐑𝐔𝐒𝐓𝐄𝐃 𝐁𝐑𝐎𝐓𝐇𝐄𝐑𓆩✶𓆪').trim();
  const sellerEmail = String(product.sellerEmail || existingData.sellerEmail || defaults.sellerEmail || 'jaibajpai67@gmail.com').trim().toLowerCase();

  // Tiers / sub-plans
  let tiers = [];
  if (Array.isArray(product.tiers)) {
    tiers = product.tiers.map(t => ({
      label: String(t.label || t.name || '').trim(),
      inr: String(t.inr || '').replace(/[^\d.]/g, '').trim(),
      usd: String(t.usd || '').replace(/[^\d.]/g, '').trim(),
    })).filter(t => t.label || t.inr || t.usd);
  } else if (Array.isArray(existingData.tiers)) {
    tiers = existingData.tiers;
  }

  const now = Date.now();

  return {
    ...existingData,
    ...product,
    id: productId,
    title,
    name: title,
    slug,
    category: String(product.category || existingData.category || '').trim() || 'VIP Collection',
    priceINR: cleanINR,
    priceUSD: cleanUSD,
    originalPriceINR: cleanOrigINR,
    originalPriceUSD: cleanOrigUSD,
    orderLink,
    downloadLink: downloadLink || '',
    fileUrl: downloadLink || '',
    coverImage: mainImage || '',
    image: mainImage || '',
    thumbnail: mainImage || '',
    images,
    galleryImages: images.filter(u => u !== mainImage),
    tiers,
    sellerId,
    sellerName: sellerName || '𓆩✶𓆪𝐓𝐑𝐔𝐒𝐓𝐄𝐃 𝐁𝐑𝐎𝐓𝐇𝐄𝐑𓆩✶𓆪',
    sellerEmail: sellerEmail || 'jaibajpai67@gmail.com',
    sellerVerified: true,
    isVerified: true,
    verified: true,
    status: (adminFlag && (product.status === 'active' || existingData.status === 'active'))
      ? 'active'
      : ((!adminFlag && existingData.status === 'active' && product.status === 'active') ? 'active' : 'pending'),
    approvalStatus: (adminFlag && (product.status === 'active' || existingData.status === 'active'))
      ? 'approved'
      : ((!adminFlag && existingData.status === 'active' && product.status === 'active') ? 'approved' : 'pending'),
    rating: product.rating || existingData.rating || '4.9',
    likes,
    views,
    createdAt: Number(product.createdAt || existingData.createdAt || now),
    updatedAt: now,
  };
}

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST, OPTIONS')) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const action = String(body.action || '').trim().toLowerCase();

    // ━━ 0. ADMIN SAVE ACTION (BACKEND FALLBACK) ━━
    if (action === 'admin_save') {
      const isAuthorized = await verifyAdminRequest(req);
      if (!isAuthorized) {
        return res.status(401).json({ error: 'Unauthorized: Master administrator authentication required.' });
      }

      const adminToken = await getFirebaseAdminToken();
      if (!adminToken) {
        return res.status(500).json({ error: 'Database service unavailable. Please retry in a few moments.' });
      }
      const authQuery = `?auth=${encodeURIComponent(adminToken)}`;
      const product = body.product;
      if (!product || typeof product !== 'object') {
        return res.status(400).json({ error: 'Missing product payload.' });
      }

      // Check existing product if any
      let existingProduct = {};
      if (product.id) {
        try {
          const exRes = await fetch(`${RTDB_URL}/products/${encodeURIComponent(product.id)}.json${authQuery}`, {
            signal: AbortSignal.timeout(6000),
          });
          if (exRes.ok) {
            existingProduct = (await exRes.json()) || {};
          }
        } catch (_) {}
      }

      const payload = sanitizeAndNormalizeProduct(product, existingProduct, {
        sellerId: 'master_admin',
        sellerName: 'JaiGram Official',
        isAdmin: true,
      }, true);

      const saveRes = await fetch(`${RTDB_URL}/products/${encodeURIComponent(payload.id)}.json${authQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (!saveRes.ok) {
        const errText = await saveRes.text();
        throw new Error(`Database save error: ${errText}`);
      }
      return res.status(200).json({
        success: true,
        product: payload,
        message: 'Product saved successfully with guaranteed button & checkout schema!',
      });
    }

    // ━━ 0B. HEAL & REPAIR PRODUCTS (DATABASE INTEGRITY MAINTENANCE) ━━
    if (action === 'heal_products' || action === 'repair_database') {
      const isAuthorized = await verifyAdminRequest(req);
      if (!isAuthorized) {
        return res.status(401).json({ error: 'Unauthorized: Master administrator authentication required.' });
      }

      const adminToken = await getFirebaseAdminToken();
      if (!adminToken) {
        return res.status(500).json({ error: 'Database service unavailable. Please retry in a few moments.' });
      }
      const authQuery = `?auth=${encodeURIComponent(adminToken)}`;

      const prodsRes = await fetch(`${RTDB_URL}/products.json${authQuery}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!prodsRes.ok) {
        throw new Error('Failed to read products from database');
      }

      const allProds = (await prodsRes.json()) || {};
      let healedCount = 0;
      let deletedGhostCount = 0;
      const patchTasks = [];

      for (const [pId, p] of Object.entries(allProds)) {
        if (!p || typeof p !== 'object') continue;

        // 1. Ghost product detection (only views/likes without title or price)
        const hasTitle = Boolean(p.title || p.name);
        const hasPrice = Boolean(p.priceINR || p.price);
        if (!hasTitle && !hasPrice) {
          deletedGhostCount++;
          patchTasks.push(
            fetch(`${RTDB_URL}/products/${encodeURIComponent(pId)}.json${authQuery}`, {
              method: 'DELETE',
            }).catch(() => {})
          );
          continue;
        }

        // 2. Check if product is missing required fields for buttons
        const needsHealing = (
          p.likes === undefined ||
          p.views === undefined ||
          !p.orderLink ||
          p.orderLink === '#' ||
          p.orderLink === '/payment.html' ||
          !p.priceINR ||
          !p.status ||
          !p.sellerVerified ||
          !p.thumbnail
        );

        if (needsHealing) {
          healedCount++;
          const cleanProd = sanitizeAndNormalizeProduct(p, p, {
            sellerId: p.sellerId || 'master_admin',
            sellerName: p.sellerName || 'LinkAdda Official',
          });
          cleanProd.id = cleanProd.id || pId;
          patchTasks.push(
            fetch(`${RTDB_URL}/products/${encodeURIComponent(cleanProd.id)}.json${authQuery}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(cleanProd),
            }).catch(() => {})
          );
        }
      }

      await Promise.allSettled(patchTasks);

      return res.status(200).json({
        success: true,
        message: `Database healed: ${healedCount} products repaired, ${deletedGhostCount} ghost products removed.`,
        healedCount,
        deletedGhostCount,
        totalChecked: Object.keys(allProds).length,
      });
    }

    // ━━ PUBLIC ENGAGEMENT: TRACK VIEW & TOGGLE LIKE (NO SELLER LOGIN NEEDED) ━━
    // Helper to resolve correct product key in RTDB (Strict: Returns '' if product does not exist!)
    async function resolveProductKey(pId, aQuery) {
      if (!pId) return '';
      try {
        const directRes = await fetch(`${RTDB_URL}/products/${encodeURIComponent(pId)}.json${aQuery}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (directRes.ok) {
          const d = await directRes.json();
          // Ensure it's a real product, not an empty or ghost entry
          if (d && typeof d === 'object' && (d.title || d.name || d.priceINR)) return pId;
        }
      } catch (_) {}

      try {
        const allRes = await fetch(`${RTDB_URL}/products.json${aQuery}`, {
          signal: AbortSignal.timeout(10000),
        });
        if (allRes.ok) {
          const allP = await allRes.json();
          if (allP && typeof allP === 'object') {
            for (const [k, v] of Object.entries(allP)) {
              if (!v || typeof v !== 'object') continue;
              if (k === pId || v?.id === pId || String(v?.id).toLowerCase() === pId.toLowerCase() || v?.slug === pId) {
                if (v.title || v.name || v.priceINR) return k;
              }
            }
          }
        }
      } catch (_) {}
      // STRICT: If not found, return empty string so we NEVER create a ghost product!
      return '';
    }

    // ━━ 1. TRACK VIEW (PUBLIC/BUYER ENGAGEMENT) ━━
    if (action === 'track_view' || action === 'view') {
      const productId = String(body.productId || '').trim();
      if (!productId) return res.status(400).json({ error: 'Missing productId' });

      const clientIp = getClientIp(req);
      if (isEngagementRateLimited(clientIp)) {
        return res.status(200).json({ success: true, rateLimited: true });
      }

      const adminToken = await getFirebaseAdminToken();
      const authQuery = adminToken ? `?auth=${encodeURIComponent(adminToken)}` : '';

      try {
        const targetKey = await resolveProductKey(productId, authQuery);
        // If product does not exist, do not write anything!
        if (!targetKey) {
          return res.status(200).json({ success: false, notFound: true, message: 'Product does not exist' });
        }

        const getRes = await fetch(`${RTDB_URL}/products/${encodeURIComponent(targetKey)}/views.json${authQuery}`, {
          signal: AbortSignal.timeout(12000),
        });
        let curViews = 0;
        if (getRes.ok) {
          const val = await getRes.json();
          curViews = Math.max(0, Number(val || 0));
        }
        const newViews = curViews + 1;
        await fetch(`${RTDB_URL}/products/${encodeURIComponent(targetKey)}/views.json${authQuery}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newViews),
          signal: AbortSignal.timeout(12000),
        });
        return res.status(200).json({ success: true, views: newViews, productId: targetKey });
      } catch (err) {
        return res.status(200).json({ success: false, error: err.message });
      }
    }

    // ━━ 2. TOGGLE LIKE / APPRECIATION (PUBLIC/BUYER ENGAGEMENT) ━━
    if (action === 'toggle_like' || action === 'like') {
      const productId = String(body.productId || '').trim();
      const isLiked = body.isLiked !== false && body.isLiked !== 'false';
      if (!productId) return res.status(400).json({ error: 'Missing productId' });

      const adminToken = await getFirebaseAdminToken();
      const authQuery = adminToken ? `?auth=${encodeURIComponent(adminToken)}` : '';

      try {
        const targetKey = await resolveProductKey(productId, authQuery);
        // If product does not exist, do not write anything!
        if (!targetKey) {
          return res.status(200).json({ success: false, notFound: true, message: 'Product does not exist' });
        }

        const getRes = await fetch(`${RTDB_URL}/products/${encodeURIComponent(targetKey)}/likes.json${authQuery}`, {
          signal: AbortSignal.timeout(12000),
        });
        let curLikes = 0;
        if (getRes.ok) {
          const val = await getRes.json();
          curLikes = Math.max(0, Number(val || 0));
        }
        const newLikes = Math.max(0, isLiked ? curLikes + 1 : Math.max(0, curLikes - 1));
        await fetch(`${RTDB_URL}/products/${encodeURIComponent(targetKey)}/likes.json${authQuery}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newLikes),
          signal: AbortSignal.timeout(12000),
        });
        return res.status(200).json({ success: true, likes: newLikes, productId: targetKey });
      } catch (err) {
        return res.status(200).json({ success: false, error: err.message });
      }
    }

    const sellerId = String(body.sellerId || '').trim();
    const token = String(body.token || '').trim();
    const secret = getAuthSecret();

    if (!sellerId || !token || !verifySellerToken(sellerId, token, secret)) {
      return res.status(401).json({ error: 'Unauthorized seller session. Please log in again.' });
    }

    const adminToken = await getFirebaseAdminToken();
    if (!adminToken) {
      return res.status(500).json({ error: 'Database service unavailable. Please retry in a few moments.' });
    }
    const authQuery = `?auth=${encodeURIComponent(adminToken)}`;

    // ━━ 1. SAVE PRODUCT (CREATE / EDIT) ━━
    if (action === 'save') {
      const product = body.product;
      if (!product || typeof product !== 'object') {
        return res.status(400).json({ error: 'Missing product payload.' });
      }

      let productId = String(product.id || '').trim();
      let existingProduct = null;

      if (productId) {
        try {
          const checkExistingRes = await fetch(`${RTDB_URL}/products/${encodeURIComponent(productId)}.json${authQuery}`, { signal: AbortSignal.timeout(6000) });
          if (checkExistingRes.ok) {
            existingProduct = await checkExistingRes.json();
          }
        } catch (_) {}
      }

      // If product exists in database, strictly verify that this seller is the owner!
      if (existingProduct) {
        if (!existingProduct.sellerId || existingProduct.sellerId !== sellerId) {
          return res.status(403).json({ error: 'You do not have permission to edit or overwrite this product.' });
        }
      }

      const isEditing = Boolean(body.isEditing || body.isEditingMode || existingProduct);

      if (!productId) {
        const slug = String(product.slug || product.title || product.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        productId = slug ? `prod_${slug}_${Date.now().toString(36)}` : `prod_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
      }

      let sellerStoreName = String(body.sellerStoreName || product.sellerStoreName || product.sellerName || '').trim();
      const preTasks = [];

      // If store name is still empty, fetch from database in parallel
      if (!sellerStoreName) {
        preTasks.push(
          fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`, { signal: AbortSignal.timeout(8000) })
            .then(res => res.ok ? res.json() : null)
            .then(sData => {
              if (sData && sData.storeName) sellerStoreName = sData.storeName;
            })
            .catch(() => {})
        );
      }

      if (preTasks.length > 0) {
        await Promise.all(preTasks);
      }

      let existingLikes = 0;
      let existingViews = 0;
      if (isEditing) {
        try {
          const curRes = await fetch(`${RTDB_URL}/products/${encodeURIComponent(productId)}.json${authQuery}`, { signal: AbortSignal.timeout(5000) });
          if (curRes.ok) {
            const curData = await curRes.json();
            if (curData) {
              existingLikes = Number(curData.likes || 0);
              existingViews = Number(curData.views || 0);
            }
          }
        } catch (_) {}
      }

      const finalLikes = isEditing 
        ? Number(product.likes !== undefined ? product.likes : existingLikes)
        : Number(product.likes !== undefined ? product.likes : 0);

      const finalViews = isEditing
        ? Number(product.views !== undefined ? product.views : existingViews)
        : Number(product.views !== undefined ? product.views : 0);

      const rawPayload = {
        ...product,
        id: productId,
        sellerId,
        sellerName: sellerStoreName || product.sellerName || 'Creator Partner',
        likes: finalLikes,
        views: finalViews,
      };

      const payload = sanitizeAndNormalizeProduct(rawPayload, existingProduct || {}, {
        sellerId,
        sellerName: sellerStoreName || product.sellerName || 'Creator Partner',
      });

      const saveRes = await fetch(`${RTDB_URL}/products/${encodeURIComponent(payload.id)}.json${authQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!saveRes.ok) {
        const errText = await saveRes.text();
        throw new Error(`Database save error: ${errText}`);
      }

      return res.status(200).json({
        success: true,
        product: payload,
        message: payload.status === 'active' 
          ? 'Pack saved and published live successfully!' 
          : 'Pack submitted for Admin approval! It will go live once verified by Admin.',
      });
    }

    // ━━ 2. DELETE PRODUCT ━━
    if (action === 'delete') {
      const productId = String(body.productId || '').trim();
      if (!productId) {
        return res.status(400).json({ error: 'Product ID is required.' });
      }

      // Verify product ownership before deleting (Strict ownership check)
      const checkRes = await fetch(`${RTDB_URL}/products/${encodeURIComponent(productId)}.json${authQuery}`);
      if (!checkRes.ok) {
        return res.status(404).json({ error: 'Product not found.' });
      }
      const existing = await checkRes.json();
      if (!existing || !existing.sellerId || existing.sellerId !== sellerId) {
        return res.status(403).json({ error: 'You do not have permission to delete this product.' });
      }

      const delRes = await fetch(`${RTDB_URL}/products/${encodeURIComponent(productId)}.json${authQuery}`, {
        method: 'DELETE',
      });

      if (!delRes.ok) {
        const errText = await delRes.text();
        throw new Error(`Database delete error: ${errText}`);
      }

      return res.status(200).json({
        success: true,
        message: 'Product pack deleted successfully.',
      });
    }

    // ━━ 3. GET SELLER ORDERS & 7-DAY PAYOUT REPORT ━━
    if (action === 'orders') {
      // 1. Fetch all products to find this seller's products
      let sellerProdIds = new Set();
      let sellerProdTitles = new Set();
      try {
        const prodsRes = await fetch(`${RTDB_URL}/products.json${authQuery}`);
        if (prodsRes.ok) {
          const prods = await prodsRes.json();
          if (prods && typeof prods === 'object') {
            for (const [pId, p] of Object.entries(prods)) {
              if (p && p.sellerId === sellerId) {
                sellerProdIds.add(pId);
                sellerProdIds.add(p.id);
                if (p.name) sellerProdTitles.add(String(p.name).toLowerCase().trim());
                if (p.title) sellerProdTitles.add(String(p.title).toLowerCase().trim());
              }
            }
          }
        }
      } catch (_) {}

      // 2. Fetch orders
      const ordersRes = await fetch(`${RTDB_URL}/orders.json${authQuery}`);
      let ordersList = [];
      let totalGross = 0;
      let totalCreatorEarnings = 0;
      let settledEarnings = 0;
      let escrowEarnings = 0;

      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();

      if (ordersRes.ok) {
        const rawOrders = await ordersRes.json();
        if (rawOrders && typeof rawOrders === 'object') {
          for (const [oId, o] of Object.entries(rawOrders)) {
            if (!o) continue;

            let isMatch = false;
            let matchedName = o.productName || 'Creator Pack';
            let itemPrice = Number(o.amount || o.totalAmount || o.price || 0);

            if (o.sellerId === sellerId) {
              isMatch = true;
            } else if (Array.isArray(o.items)) {
              const found = o.items.find(it => it && (sellerProdIds.has(it.id) || sellerProdTitles.has(String(it.name || '').toLowerCase().trim())));
              if (found) {
                isMatch = true;
                matchedName = found.name || matchedName;
                itemPrice = Number(found.price || itemPrice);
              }
            } else if (o.productId && sellerProdIds.has(o.productId)) {
              isMatch = true;
            } else if (o.productName && sellerProdTitles.has(String(o.productName).toLowerCase().trim())) {
              isMatch = true;
            }

            if (isMatch) {
              const statusVal = String(o.status || o.orderStatus || o.paymentStatus || '').toLowerCase();
              const isApproved = statusVal === 'approved' || statusVal === 'completed' || statusVal === 'paid' || statusVal === 'verified' || o.verified === true;

              // STRICT RULE: If order has NOT been approved by admin, it must NOT appear in seller dashboard or revenue!
              if (!isApproved) continue;

              const creatorEarnings = itemPrice;
              const orderTime = Number(o.createdAt || o.timestamp || Date.now());
              const ageMs = Math.max(0, now - orderTime);
              const isSettled = ageMs >= SEVEN_DAYS_MS;
              const payoutDate = new Date(orderTime + SEVEN_DAYS_MS).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric'
              });

              totalGross += itemPrice;
              totalCreatorEarnings += creatorEarnings;

              if (isSettled) {
                settledEarnings += creatorEarnings;
              } else {
                escrowEarnings += creatorEarnings;
              }

              ordersList.push({
                id: oId,
                productName: matchedName,
                amount: itemPrice,
                creatorEarnings: creatorEarnings,
                isApproved: true,
                customerName: 'Verified Buyer', // PRIVACY: Seller never sees buyer's personal real name
                customerEmail: '', // PRIVACY: No personal contact info exposed
                customerPhone: '',
                createdAt: orderTime,
                payoutStatus: isSettled ? 'settled' : 'in_escrow',
                payoutDueDate: payoutDate,
                daysRemaining: isSettled ? 0 : Math.max(0, Math.ceil((SEVEN_DAYS_MS - ageMs) / (24 * 60 * 60 * 1000))),
              });
            }
          }
        }
      }

      ordersList.sort((a, b) => b.createdAt - a.createdAt);

      return res.status(200).json({
        success: true,
        orders: ordersList,
        payouts: {
          totalGross,
          totalCreatorEarnings,
          settledEarnings,
          escrowEarnings,
          payoutRate: '100%',
          cycle: '7-Day Rolling Payout (UPI)',
        },
      });
    }

    return res.status(400).json({ error: 'Invalid action specified.' });
  } catch (err) {
    console.error('Error in /api/seller/products:', err);
    return res.status(500).json({ error: err.message || 'Server error processing request.' });
  }
}
