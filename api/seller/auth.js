import crypto from 'node:crypto';
import { handleCors, getAuthSecret, isValidEmail, getFirebaseAdminToken, SELLER_MEMORY_STORE } from '../_utils.js';

const RTDB_URL = 'https://linkadda-cd1da-default-rtdb.firebaseio.com';

const sellerFailedLoginMap = globalThis.__SELLER_FAILED_LOGINS || (globalThis.__SELLER_FAILED_LOGINS = new Map());
const MAX_SELLER_LOGIN_ATTEMPTS = 5;
const SELLER_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function hashSellerPassword(password, secret) {
  return crypto.createHmac('sha256', secret).update(password).digest('hex');
}

function verifyPassword(inputPassword, storedHash, secret) {
  if (!inputPassword || !storedHash) return false;

  const cleanPass = String(inputPassword).trim();
  const cleanStored = String(storedHash).trim();

  // 1. Primary HMAC-SHA256
  try {
    const hmacHash = crypto.createHmac('sha256', secret).update(cleanPass).digest('hex');
    if (hmacHash.length === cleanStored.length && crypto.timingSafeEqual(Buffer.from(hmacHash, 'hex'), Buffer.from(cleanStored, 'hex'))) {
      return true;
    }
  } catch (_) {}

  // 2. Client-side admin approval hash: SHA-256(password + secret)
  try {
    const concatHash = crypto.createHash('sha256').update(cleanPass + secret).digest('hex');
    if (concatHash.length === cleanStored.length && crypto.timingSafeEqual(Buffer.from(concatHash, 'hex'), Buffer.from(cleanStored, 'hex'))) {
      return true;
    }
  } catch (_) {}

  // 3. Simple SHA-256(password)
  try {
    const simpleSha = crypto.createHash('sha256').update(cleanPass).digest('hex');
    if (simpleSha.length === cleanStored.length && crypto.timingSafeEqual(Buffer.from(simpleSha, 'hex'), Buffer.from(cleanStored, 'hex'))) {
      return true;
    }
  } catch (_) {}

  // 4. Plaintext fallback (if legacy password was stored raw)
  if (cleanPass === cleanStored) {
    return true;
  }

  return false;
}

export function createSellerToken(sellerId, secret) {
  const expires = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days session
  const payload = `${sellerId}:${expires}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${expires}.${sig}`;
}

export function verifySellerToken(sellerId, token, secret) {
  if (!token || !token.includes('.')) return false;
  const [expiresStr, sig] = token.split('.');
  const expires = Number(expiresStr);
  if (isNaN(expires) || Date.now() > expires) return false;
  const expectedSig = crypto.createHmac('sha256', secret).update(`${sellerId}:${expires}`).digest('hex');
  const bufSig = Buffer.from(sig, 'hex');
  const bufExpected = Buffer.from(expectedSig, 'hex');
  return bufSig.length === bufExpected.length && crypto.timingSafeEqual(bufSig, bufExpected);
}

function renderPasswordResetEmail(ownerName, storeName, otpCode, portalUrl = 'https://jaigram.shop/seller/login') {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your JaiGram Partner Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #07060c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #07060c; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background: #120e1f; border-radius: 20px; border: 1px solid rgba(255, 42, 141, 0.25); box-shadow: 0 20px 50px rgba(0,0,0,0.7); overflow: hidden;">
          <tr>
            <td style="padding: 32px 28px 20px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
              <div style="font-size: 24px; font-weight: 800; color: #ffffff;">
                JaiGram <span style="color: #ff2a8d;">&#9819;</span> <span style="color: #ff2a8d;">Seller Hub</span>
              </div>
              <div style="margin-top: 4px; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #fbbf24; font-weight: 700;">
                Password Reset Verification
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 28px; text-align: center;">
              <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 800; color: #ffffff;">Hello ${ownerName || storeName}!</h2>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                We received a request to reset the password for your JaiGram seller account (<strong>${storeName}</strong>). Use the verification code below to set your new password:
              </p>

              <!-- Prominent Copy-Ready OTP Box -->
              <div style="margin: 0 auto 20px; max-width: 320px; padding: 18px 24px; background: linear-gradient(135deg, rgba(255, 42, 133, 0.16) 0%, rgba(139, 92, 246, 0.12) 100%); border: 2px solid #ff2a85; border-radius: 16px; box-shadow: 0 10px 30px rgba(255, 42, 133, 0.3); text-align: center;">
                <span style="font-size: 38px; font-weight: 900; letter-spacing: 8px; color: #ffffff; font-family: 'SF Mono', Consolas, 'Courier New', monospace; display: block; user-select: all; -webkit-user-select: all; -moz-user-select: all; cursor: pointer; text-shadow: 0 0 14px rgba(255, 42, 133, 0.6);">${otpCode}</span>
                <div style="margin-top: 8px; display: inline-block; padding: 4px 12px; background: rgba(255, 255, 255, 0.08); border-radius: 6px; font-size: 11px; font-weight: 700; color: #ff65a3; letter-spacing: 0.5px;">
                  &#128203; Tap or click code to copy
                </div>
              </div>

              <!-- Direct CTA Action Button -->
              <div style="margin-bottom: 22px;">
                <a href="${portalUrl}" target="_blank" style="display: inline-block; padding: 13px 32px; background: linear-gradient(135deg, #ff2a85 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-weight: 800; font-size: 13.5px; border-radius: 12px; box-shadow: 0 6px 20px rgba(255, 42, 133, 0.45); text-transform: uppercase; letter-spacing: 0.6px;">
                  Open Seller Hub &amp; Reset &rarr;
                </a>
              </div>

              <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                This code is valid for <strong>15 minutes</strong>. If you did not request this password reset, please ignore this email or contact JaiGram support.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 28px; background: rgba(255, 255, 255, 0.02); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b;">
                &copy; ${new Date().getFullYear()} JaiGram Shop &bull; Seller Partner Security
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function renderPasswordChangedNotificationEmail(ownerName, storeName, timestampStr, portalUrl) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your JaiGram Seller Password Has Been Updated</title>
</head>
<body style="margin: 0; padding: 0; background-color: #07060c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #07060c; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background: #120e1f; border-radius: 20px; border: 1px solid rgba(16, 185, 129, 0.3); box-shadow: 0 20px 50px rgba(0,0,0,0.7); overflow: hidden;">
          <tr>
            <td style="padding: 32px 28px 20px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
              <div style="font-size: 24px; font-weight: 800; color: #ffffff;">
                JaiGram <span style="color: #10b981;">&#9819;</span> <span style="color: #10b981;">Seller Hub</span>
              </div>
              <div style="margin-top: 4px; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #10b981; font-weight: 700;">
                Security Notification
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 28px; text-align: center;">
              <div style="display: inline-block; width: 64px; height: 64px; line-height: 64px; border-radius: 50%; background: rgba(16, 185, 129, 0.15); border: 2px solid #10b981; font-size: 28px; margin-bottom: 18px;">
                &#9989;
              </div>
              <h2 style="margin: 0 0 12px; font-size: 22px; font-weight: 800; color: #ffffff;">Password Changed Successfully</h2>
              <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                Hello <strong>${ownerName || storeName}</strong>, this is an official security confirmation that the confidential password for your JaiGram seller account (<strong>${storeName}</strong>) was successfully updated on <strong>${timestampStr}</strong>.
              </p>

              <div style="margin: 0 auto 26px; padding: 16px 20px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; text-align: left;">
                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">&#128274; Account Status: <span style="color: #10b981; font-weight: 600;">Secured & Active</span></div>
                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">&#128337; Updated At: <span style="color: #ffffff;">${timestampStr}</span></div>
                <div style="font-size: 12px; color: #94a3b8;">&#127978; Store: <span style="color: #ffffff;">${storeName}</span></div>
              </div>

              <a href="${portalUrl}" style="display: inline-block; padding: 14px 34px; background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; text-decoration: none; font-weight: 800; font-size: 15px; border-radius: 12px; box-shadow: 0 8px 24px rgba(16, 185, 129, 0.35);">
                Open Seller Hub &rarr;
              </a>

              <p style="margin: 26px 0 0; font-size: 12px; line-height: 1.5; color: #64748b;">
                If you made this change, you can safely disregard this message. If you did <strong>NOT</strong> authorize this change, please immediately reach out to our Helpdesk at <strong>ritikanetwork96@gmail.com</strong> or contact Telegram <strong>@JaiGram_Support</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 28px; background: rgba(255, 255, 255, 0.02); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b;">
                &copy; ${new Date().getFullYear()} JaiGram Shop &bull; Seller Partner Security
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export default async function handler(req, res) {
  if (handleCors(req, res, 'GET, POST, OPTIONS')) return;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    let queryAction = '';
    try {
      if (req.query && req.query.action) {
        queryAction = String(req.query.action).trim().toLowerCase();
      } else if (req.url) {
        const urlObj = new URL(req.url, 'http://localhost');
        queryAction = (urlObj.searchParams.get('action') || '').trim().toLowerCase();
      }
    } catch (_) {}

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const action = String(body.action || queryAction || (req.method === 'GET' ? 'list_public_sellers' : 'login')).trim().toLowerCase();
    const secret = getAuthSecret();
    const adminToken = await getFirebaseAdminToken();
    const authQuery = adminToken ? `?auth=${encodeURIComponent(adminToken)}` : '';

    // Helper to find a seller by email with comprehensive multi-node merging
    async function findSellerByEmail(email) {
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail) return null;

      let eventSeller = null;
      let rootSeller = null;
      let foundKey = null;
      const matchedKeys = new Set();
      const candidateHashes = [];

      // 1. Query RTDB /events/sellers
      try {
        const evRes = await fetch(`${RTDB_URL}/events/sellers.json${authQuery}`);
        if (evRes.ok) {
          const sellers = await evRes.json();
          if (sellers && typeof sellers === 'object') {
            for (const [key, s] of Object.entries(sellers)) {
              if (s && String(s.email || '').trim().toLowerCase() === cleanEmail) {
                matchedKeys.add(key);
                if (s.id) matchedKeys.add(s.id);
                if (s.passwordHash) candidateHashes.push(s.passwordHash);
                if (!eventSeller || (Number(s.passwordUpdatedAt || 0) > Number(eventSeller.passwordUpdatedAt || 0))) {
                  eventSeller = { ...s, id: s.id || key };
                  foundKey = key;
                }
              }
            }
          }
        }
      } catch (_) {}

      // 2. Query RTDB /sellers
      try {
        const rootRes = await fetch(`${RTDB_URL}/sellers.json${authQuery}`);
        if (rootRes.ok) {
          const sellers = await rootRes.json();
          if (sellers && typeof sellers === 'object') {
            for (const [key, s] of Object.entries(sellers)) {
              if (s && String(s.email || '').trim().toLowerCase() === cleanEmail) {
                matchedKeys.add(key);
                if (s.id) matchedKeys.add(s.id);
                if (s.passwordHash) candidateHashes.push(s.passwordHash);
                if (!rootSeller || (Number(s.passwordUpdatedAt || 0) > Number(rootSeller.passwordUpdatedAt || 0))) {
                  rootSeller = { ...s, id: s.id || key };
                  if (!foundKey) foundKey = key;
                }
              }
            }
          }
        }
      } catch (_) {}

      // If found in one node, attempt targeted lookup in the other node to merge all fields
      const resolvedId = eventSeller?.id || rootSeller?.id || foundKey;
      if (resolvedId) {
        matchedKeys.add(resolvedId);
        if (!eventSeller) {
          try {
            const evSRes = await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(resolvedId)}.json${authQuery}`);
            if (evSRes.ok) {
              const d = await evSRes.json();
              if (d && typeof d === 'object') {
                eventSeller = { ...d, id: d.id || resolvedId };
                if (d.passwordHash) candidateHashes.push(d.passwordHash);
              }
            }
          } catch (_) {}
        }
        if (!rootSeller) {
          try {
            const rootSRes = await fetch(`${RTDB_URL}/sellers/${encodeURIComponent(resolvedId)}.json${authQuery}`);
            if (rootSRes.ok) {
              const d = await rootSRes.json();
              if (d && typeof d === 'object') {
                rootSeller = { ...d, id: d.id || resolvedId };
                if (d.passwordHash) candidateHashes.push(d.passwordHash);
              }
            }
          } catch (_) {}
        }
      }

      // 3. Fallback: check /events/seller_applications if not found yet
      if (!eventSeller && !rootSeller) {
        try {
          const appRes = await fetch(`${RTDB_URL}/events/seller_applications.json${authQuery}`);
          if (appRes.ok) {
            const apps = await appRes.json();
            if (apps && typeof apps === 'object') {
              for (const [appKey, a] of Object.entries(apps)) {
                if (a && String(a.email || '').trim().toLowerCase() === cleanEmail && (a.status === 'approved' || a.sellerId)) {
                  const sId = a.sellerId || appKey;
                  matchedKeys.add(sId);
                  matchedKeys.add(appKey);
                  try {
                    const sRes = await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(sId)}.json${authQuery}`);
                    if (sRes.ok) {
                      const sd = await sRes.json();
                      if (sd) {
                        eventSeller = { ...sd, id: sd.id || sId };
                        if (sd.passwordHash) candidateHashes.push(sd.passwordHash);
                      }
                    }
                  } catch (_) {}
                  try {
                    const sRes = await fetch(`${RTDB_URL}/sellers/${encodeURIComponent(sId)}.json${authQuery}`);
                    if (sRes.ok) {
                      const sd = await sRes.json();
                      if (sd) {
                        rootSeller = { ...sd, id: sd.id || sId };
                        if (sd.passwordHash) candidateHashes.push(sd.passwordHash);
                      }
                    }
                  } catch (_) {}
                  break;
                }
              }
            }
          }
        } catch (_) {}
      }

      // 4. Memory store lookup
      let memSeller = null;
      if (resolvedId && SELLER_MEMORY_STORE.sellers.has(resolvedId)) {
        memSeller = SELLER_MEMORY_STORE.sellers.get(resolvedId);
        if (memSeller?.passwordHash) candidateHashes.push(memSeller.passwordHash);
      } else {
        for (const [k, s] of SELLER_MEMORY_STORE.sellers.entries()) {
          if (s && String(s.email || '').trim().toLowerCase() === cleanEmail) {
            memSeller = s;
            matchedKeys.add(k);
            if (s.id) matchedKeys.add(s.id);
            if (s.passwordHash) candidateHashes.push(s.passwordHash);
            break;
          }
        }
      }

      if (!eventSeller && !rootSeller && !memSeller) {
        return null;
      }

      // Merge records: rootSeller (base) + eventSeller (events) + memSeller (cache)
      const merged = {
        ...(rootSeller || {}),
        ...(eventSeller || {}),
        ...(memSeller || {}),
        id: resolvedId || eventSeller?.id || rootSeller?.id || memSeller?.id,
        email: cleanEmail,
      };

      // Guaranteed passwordHash selection: pick newest by passwordUpdatedAt
      let bestHash = merged.passwordHash;
      const memUpdated = Number(memSeller?.passwordUpdatedAt || 0);
      const evUpdated = Number(eventSeller?.passwordUpdatedAt || 0);
      const rtUpdated = Number(rootSeller?.passwordUpdatedAt || 0);

      if (memUpdated >= evUpdated && memUpdated >= rtUpdated && memSeller?.passwordHash) {
        bestHash = memSeller.passwordHash;
      } else if (evUpdated >= rtUpdated && eventSeller?.passwordHash) {
        bestHash = eventSeller.passwordHash;
      } else if (rootSeller?.passwordHash) {
        bestHash = rootSeller.passwordHash;
      }
      merged.passwordHash = bestHash;
      merged._candidateHashes = Array.from(new Set(candidateHashes.filter(Boolean)));
      if (merged.id) matchedKeys.add(merged.id);
      merged.allMatchedKeys = Array.from(matchedKeys);

      // Specifically guarantee resetOtp and resetAttempts are preserved from whichever has them
      if (!merged.resetOtp && rootSeller?.resetOtp) merged.resetOtp = rootSeller.resetOtp;
      if (!merged.resetOtp && eventSeller?.resetOtp) merged.resetOtp = eventSeller.resetOtp;
      if (!merged.resetOtp && memSeller?.resetOtp) merged.resetOtp = memSeller.resetOtp;

      if (merged.resetExpires === undefined) {
        merged.resetExpires = eventSeller?.resetExpires ?? rootSeller?.resetExpires ?? memSeller?.resetExpires;
      }
      if (merged.resetAttempts === undefined) {
        merged.resetAttempts = eventSeller?.resetAttempts ?? rootSeller?.resetAttempts ?? memSeller?.resetAttempts ?? 0;
      }

      SELLER_MEMORY_STORE.sellers.set(merged.id, merged);
      return merged;
    }

    // ━━ 0. PUBLIC ACTION: LIST VERIFIED SELLERS (Strict No Contact / Privacy Shield) ━━
    if (action === 'list_public_sellers') {
      try {
        let sellersMap = {
          'store_linkadda_official': {
            id: 'store_linkadda_official',
            storeName: 'JaiGram Official',
            category: 'VIP Media Partner',
            avatar: '',
            status: 'active',
            verified: true,
            followerCount: 1,
            totalProducts: 0,
          },
          'store_trusted_brother': {
            id: 'store_trusted_brother',
            storeName: 'Trusted brother',
            category: 'Digital Creator',
            avatar: '../images/popup-avatar-circle.png',
            status: 'active',
            verified: true,
            followerCount: 1,
            totalProducts: 0,
          },
          'store_ghost_layer_shop': {
            id: 'store_ghost_layer_shop',
            storeName: 'GHost Layer Shop',
            category: 'Digital Creator',
            avatar: '',
            status: 'active',
            verified: true,
            followerCount: 0,
            totalProducts: 0,
          },
        };

        // 1. Fetch from /events/sellers
        try {
          const evRes = await fetch(`${RTDB_URL}/events/sellers.json${authQuery}`);
          if (evRes.ok) {
            const evData = await evRes.json();
            if (evData && typeof evData === 'object') {
              sellersMap = { ...sellersMap, ...evData };
            }
          }
        } catch (_) {}

        // 2. Merge /sellers
        try {
          const rootRes = await fetch(`${RTDB_URL}/sellers.json${authQuery}`);
          if (rootRes.ok) {
            const rootData = await rootRes.json();
            if (rootData && typeof rootData === 'object') {
              sellersMap = { ...sellersMap, ...rootData };
            }
          }
        } catch (_) {}

        // 2.5 Merge /public_sellers (Always publicly accessible in RTDB rules)
        try {
          const pubRes = await fetch(`${RTDB_URL}/public_sellers.json`);
          if (pubRes.ok) {
            const pubData = await pubRes.json();
            if (pubData && typeof pubData === 'object') {
              for (const [pid, ps] of Object.entries(pubData)) {
                if (ps && !sellersMap[pid]) {
                  sellersMap[pid] = { ...ps, id: ps.id || pid };
                }
              }
            }
          }
        } catch (_) {}

        // 2.6 Merge approved /seller_applications
        try {
          const appRes = await fetch(`${RTDB_URL}/seller_applications.json${authQuery}`);
          if (appRes.ok) {
            const appData = await appRes.json();
            if (appData && typeof appData === 'object') {
              for (const [appId, a] of Object.entries(appData)) {
                if (a && (a.status === 'approved' || a.credentialsSent)) {
                  const sId = a.sellerId || appId;
                  if (!sellersMap[sId]) {
                    sellersMap[sId] = {
                      id: sId,
                      storeName: a.storeName || a.fullName || 'Verified Store',
                      ownerName: a.fullName,
                      category: a.category || 'Digital Creator',
                      avatar: a.avatar || '',
                      status: 'active',
                      followerCount: Number(a.followerCount || a.followers || 0),
                      joinedAt: a.approvedAt || a.submittedAt || null,
                    };
                  }
                }
              }
            }
          }
        } catch (_) {}

        // 3. Merge in-memory store
        for (const [id, s] of SELLER_MEMORY_STORE.sellers.entries()) {
          if (!sellersMap[id]) sellersMap[id] = s;
        }

        // Count active products per seller and discover product-listed creators
        const productCountMap = {};
        const productSellersMap = {};
        let unassignedProductCount = 0;
        try {
          const pRes = await fetch(`${RTDB_URL}/products.json`);
          if (pRes.ok) {
            const pData = await pRes.json();
            if (pData && typeof pData === 'object') {
              for (const p of Object.values(pData)) {
                if (p && p.status !== 'deleted' && p.status !== 'inactive' && p.status !== 'archived') {
                  const sId = String(p.sellerId || '').trim();
                  const sName = String(p.sellerName || p.sellerStoreName || '').trim();
                  if (sId) productCountMap[sId] = (productCountMap[sId] || 0) + 1;
                  if (sName) {
                    const sn = sName.toLowerCase();
                    productCountMap[sn] = (productCountMap[sn] || 0) + 1;
                    if (!productSellersMap[sn]) {
                      productSellersMap[sn] = {
                        id: sId || ('store_' + sn.replace(/\s+/g, '_')),
                        storeName: sName,
                        avatar: p.sellerAvatar || '',
                        category: p.category || 'Digital Creator',
                        status: 'active',
                        followerCount: 0,
                      };
                    }
                  } else {
                    unassignedProductCount++;
                  }
                }
              }
            }
          }
        } catch (_) {}

        // Default products without third-party seller attribution count for flagship stores
        if (unassignedProductCount > 0) {
          productCountMap['trusted brother'] = (productCountMap['trusted brother'] || 0) + unassignedProductCount;
          productCountMap['linkadda official'] = (productCountMap['linkadda official'] || 0) + unassignedProductCount;
        }

        // Merge any creator discovered from products
        for (const [snKey, pCreator] of Object.entries(productSellersMap)) {
          const exists = Object.values(sellersMap).some(s => s && String(s.storeName || '').trim().toLowerCase() === snKey);
          if (!exists) {
            sellersMap[pCreator.id] = pCreator;
          }
        }

        // Fetch live follower counts from /store_followers
        let liveFollowersMap = {};
        try {
          const fRes = await fetch(`${RTDB_URL}/store_followers.json`);
          if (fRes.ok) {
            const fData = await fRes.json();
            if (fData && typeof fData === 'object') {
              liveFollowersMap = fData;
            }
          }
        } catch (_) {}

        const publicSellers = [];
        for (const [id, s] of Object.entries(sellersMap)) {
          if (!s || s.status === 'suspended' || s.status === 'deleted' || s.deleted === true) continue;
          const storeName = String(s.storeName || s.ownerName || 'Verified Store').trim();
          const cleanKey = (s.id || id || storeName).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          const cleanNameKey = storeName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

          const prodCount = productCountMap[id] ||
            productCountMap[storeName.toLowerCase()] ||
            (storeName.toLowerCase().includes('trusted') ? productCountMap['trusted brother'] : 0) ||
            (storeName.toLowerCase().includes('linkadda') ? productCountMap['linkadda official'] : 0) ||
            s.totalProducts || 0;

          const liveF = liveFollowersMap[cleanKey] || liveFollowersMap[cleanNameKey];
          const followerCount = typeof liveF?.count === 'number'
            ? liveF.count
            : Number(s.followerCount || s.followers || 0);

          publicSellers.push({
            id: s.id || id,
            storeName,
            avatar: s.avatar || '',
            category: s.category || 'Digital Creator',
            verified: s.status === 'active' || s.verified !== false,
            totalProducts: prodCount,
            followerCount,
            joinedAt: s.createdAt || s.approvedAt || null,
          });
        }

        // Keep /public_sellers in RTDB updated dynamically with real verified sellers
        if (authQuery) {
          const pubMap = {};
          publicSellers.forEach(ps => { pubMap[ps.id] = ps; });
          fetch(`${RTDB_URL}/public_sellers.json${authQuery}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pubMap),
          }).catch(() => {});
        }

        return res.status(200).json({
          success: true,
          sellers: publicSellers,
        });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to retrieve sellers catalog.' });
      }
    }

    // ━━ 0.1 PUBLIC ACTION: GET LIVE STORE FOLLOWERS COUNT ━━
    if (action === 'get_store_followers') {
      const sellerId = String(body.sellerId || req.query?.sellerId || '').trim();
      const storeName = String(body.storeName || req.query?.storeName || '').trim();

      const cleanUnicode = String(storeName || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x00-\x7F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      const candidateKeys = new Set();
      if (cleanUnicode) candidateKeys.add(cleanUnicode.replace(/[^a-z0-9_-]/g, '_'));
      if (storeName) candidateKeys.add(storeName.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '_'));
      if (sellerId) candidateKeys.add(sellerId.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '_'));

      if (cleanUnicode.includes('trusted') && cleanUnicode.includes('brother') || sellerId === 'seller_6e2c36f417' || sellerId === 'seller_jaibajpai67') {
        candidateKeys.add('trusted_brother');
        candidateKeys.add('trustedbrother');
      }
      if (cleanUnicode.includes('ghost') && cleanUnicode.includes('layer') || sellerId === 'seller_8f3baf766f') {
        candidateKeys.add('ghost_layer_shop');
        candidateKeys.add('ghost_layer');
      }

      if (candidateKeys.size === 0) {
        return res.status(400).json({ error: 'Missing seller identifier.' });
      }

      let count = 0;
      for (const k of candidateKeys) {
        if (!k) continue;
        try {
          const fRes = await fetch(`${RTDB_URL}/store_followers/${encodeURIComponent(k)}.json`);
          if (fRes.ok) {
            const fData = await fRes.json();
            if (fData && typeof fData === 'object') {
              if (typeof fData.count === 'number' && fData.count > count) {
                count = fData.count;
              }
              if (fData.followers && typeof fData.followers === 'object') {
                const fLen = Object.keys(fData.followers).length;
                if (fLen > count) count = fLen;
              }
            }
          }
        } catch (_) {}
      }

      // Check seller's followerCount in memory or RTDB sellers
      if (sellerId) {
        const mem = SELLER_MEMORY_STORE.sellers.get(sellerId);
        if (mem && typeof mem.followerCount === 'number' && mem.followerCount > count) {
          count = mem.followerCount;
        }
      }

      return res.status(200).json({
        success: true,
        followerCount: count,
      });
    }

    // ━━ 0.2 PUBLIC ACTION: TOGGLE FOLLOW STORE (LIVE SYNC WITH SELLER) ━━
    if (action === 'toggle_follow') {
      const sellerId = String(body.sellerId || req.query?.sellerId || '').trim();
      const storeName = String(body.storeName || req.query?.storeName || '').trim();
      const customerId = String(body.customerId || req.query?.customerId || 'visitor').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
      const follow = body.follow === true || body.follow === 'true';

      const cleanUnicode = String(storeName || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x00-\x7F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      let cleanKey = cleanUnicode ? cleanUnicode.replace(/[^a-z0-9_-]/g, '_') : '';
      if (cleanUnicode.includes('trusted') && cleanUnicode.includes('brother') || sellerId === 'seller_6e2c36f417' || sellerId === 'seller_jaibajpai67') {
        cleanKey = 'trusted_brother';
      } else if (cleanUnicode.includes('ghost') && cleanUnicode.includes('layer') || sellerId === 'seller_8f3baf766f') {
        cleanKey = 'ghost_layer_shop';
      } else if (!cleanKey) {
        cleanKey = sellerId || storeName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      }

      if (!cleanKey) {
        return res.status(400).json({ error: 'Missing store identifier.' });
      }

      try {
        // Fetch current followers from /store_followers
        let currentFollowers = {};
        try {
          const fRes = await fetch(`${RTDB_URL}/store_followers/${encodeURIComponent(cleanKey)}/followers.json`);
          if (fRes.ok) {
            const fData = await fRes.json();
            if (fData && typeof fData === 'object') {
              currentFollowers = fData;
            }
          }
        } catch (_) {}

        if (follow) {
          currentFollowers[customerId] = Date.now();
        } else {
          delete currentFollowers[customerId];
        }

        const newCount = Object.keys(currentFollowers).length;

        // Persist to RTDB /store_followers
        try {
          await fetch(`${RTDB_URL}/store_followers/${encodeURIComponent(cleanKey)}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              count: newCount,
              storeName: storeName || cleanKey,
              updatedAt: Date.now(),
            }),
          });
          if (follow) {
            await fetch(`${RTDB_URL}/store_followers/${encodeURIComponent(cleanKey)}/followers/${encodeURIComponent(customerId)}.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(Date.now()),
            });
          } else {
            await fetch(`${RTDB_URL}/store_followers/${encodeURIComponent(cleanKey)}/followers/${encodeURIComponent(customerId)}.json`, {
              method: 'DELETE',
            });
          }
        } catch (_) {}

        // Resolve sellerId if needed to update seller's follower count
        let resolvedSellerId = sellerId;
        if (!resolvedSellerId && storeName) {
          for (const s of SELLER_MEMORY_STORE.sellers.values()) {
            if (s && String(s.storeName).toLowerCase() === storeName.toLowerCase()) {
              resolvedSellerId = s.id;
              break;
            }
          }
        }

        if (resolvedSellerId) {
          if (SELLER_MEMORY_STORE.sellers.has(resolvedSellerId)) {
            SELLER_MEMORY_STORE.sellers.get(resolvedSellerId).followerCount = newCount;
          }

          fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(resolvedSellerId)}.json${authQuery}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ followerCount: newCount }),
          }).catch(() => {});

          if (adminToken) {
            fetch(`${RTDB_URL}/sellers/${encodeURIComponent(resolvedSellerId)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ followerCount: newCount }),
            }).catch(() => {});
          }

          fetch(`${RTDB_URL}/public_sellers/${encodeURIComponent(resolvedSellerId)}.json${authQuery}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ followerCount: newCount }),
          }).catch(() => {});
        }

        return res.status(200).json({
          success: true,
          followerCount: newCount,
          following: follow,
        });
      } catch (err) {
        return res.status(200).json({
          success: true,
          followerCount: follow ? 1 : 0,
          following: follow,
        });
      }
    }

    // ━━ 1. SELLER LOGIN ━━
    if (action === 'login') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '').trim();

      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      if (!password) {
        return res.status(400).json({ error: 'Please enter your password.' });
      }

      // Check lockout status
      const now = Date.now();
      const attemptRecord = sellerFailedLoginMap.get(email) || { count: 0, lockedUntil: 0 };
      if (attemptRecord.lockedUntil && now < attemptRecord.lockedUntil) {
        const remainingMinutes = Math.ceil((attemptRecord.lockedUntil - now) / 60000);
        return res.status(429).json({
          error: `Account temporarily locked due to multiple failed login attempts. Please try again in ${remainingMinutes} minute(s).`,
          locked: true,
          retryAfter: Math.ceil((attemptRecord.lockedUntil - now) / 1000),
        });
      }

      const matchedSeller = await findSellerByEmail(email);

      if (!matchedSeller) {
        return res.status(401).json({ error: 'No seller account found with this email. Have you applied yet?' });
      }

      if (matchedSeller.status === 'suspended') {
        return res.status(403).json({ error: 'Your seller account is currently suspended. Please contact JaiGram Admin.' });
      }

      // Verify Password Hash using bulletproof verifyPassword
      let isValid = verifyPassword(password, matchedSeller.passwordHash, secret);

      // If not valid with primary hash, check all candidate hashes across nodes/memory
      if (!isValid && Array.isArray(matchedSeller._candidateHashes) && matchedSeller._candidateHashes.length) {
        for (const candHash of matchedSeller._candidateHashes) {
          if (candHash && verifyPassword(password, candHash, secret)) {
            isValid = true;
            break;
          }
        }
      }

      if (!isValid) {
        const nextCount = attemptRecord.count + 1;
        if (nextCount >= MAX_SELLER_LOGIN_ATTEMPTS) {
          sellerFailedLoginMap.set(email, { count: nextCount, lockedUntil: now + SELLER_LOCKOUT_MS });
          return res.status(429).json({
            error: 'Too many incorrect password attempts. Your seller account has been locked for 15 minutes for your security.',
            locked: true,
            retryAfter: 900,
          });
        }
        sellerFailedLoginMap.set(email, { count: nextCount, lockedUntil: 0 });
        const remaining = Math.max(0, MAX_SELLER_LOGIN_ATTEMPTS - nextCount);
        return res.status(401).json({
          error: `Incorrect password. ${remaining} attempt(s) remaining before account lockout.`,
        });
      }

      // Upgrade hash to canonical HMAC-SHA256 across all matching nodes/keys
      const canonicalHash = hashSellerPassword(password, secret);
      const keysToSync = (matchedSeller.allMatchedKeys && matchedSeller.allMatchedKeys.length) ? matchedSeller.allMatchedKeys : [matchedSeller.id];
      const nowTs = Date.now();

      keysToSync.forEach(k => {
        if (SELLER_MEMORY_STORE.sellers.has(k)) {
          const m = SELLER_MEMORY_STORE.sellers.get(k);
          m.passwordHash = canonicalHash;
          m.passwordUpdatedAt = nowTs;
        }
        fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(k)}.json${authQuery}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passwordHash: canonicalHash, passwordUpdatedAt: nowTs }),
        }).catch(() => {});
        fetch(`${RTDB_URL}/sellers/${encodeURIComponent(k)}.json${authQuery}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passwordHash: canonicalHash, passwordUpdatedAt: nowTs }),
        }).catch(() => {});
      });

      // Clear failed login attempts counter on successful authentication
      sellerFailedLoginMap.delete(email);

      // Generate 30-day session token
      const token = createSellerToken(matchedSeller.id, secret);

      const safeSeller = {
        id: matchedSeller.id,
        email: matchedSeller.email,
        ownerName: matchedSeller.ownerName,
        storeName: matchedSeller.storeName,
        phone: matchedSeller.phone || '',
        telegram: matchedSeller.telegram || '',
        payoutMethod: matchedSeller.payoutMethod || (matchedSeller.upiId ? 'upi' : ''),
        payoutCountry: matchedSeller.payoutCountry || (matchedSeller.usdtAddress || matchedSeller.binancePayId || matchedSeller.paypalEmail ? 'INTL' : 'IN'),
        upiId: matchedSeller.upiId || '',
        bankName: matchedSeller.bankName || '',
        accountHolder: matchedSeller.accountHolder || '',
        accountNumber: matchedSeller.accountNumber || '',
        ifsc: matchedSeller.ifsc || '',
        usdtAddress: matchedSeller.usdtAddress || '',
        usdtNetwork: matchedSeller.usdtNetwork || 'TRC-20',
        binancePayId: matchedSeller.binancePayId || '',
        paypalEmail: matchedSeller.paypalEmail || '',
        avatar: matchedSeller.avatar || '',
        category: matchedSeller.category,
        mustChangePassword: Boolean(matchedSeller.mustChangePassword),
        status: matchedSeller.status,
      };

      return res.status(200).json({
        success: true,
        seller: safeSeller,
        token,
        message: `Welcome back to JaiGram Seller Hub, ${safeSeller.storeName}!`,
      });
    }

    // ━━ 2. CHANGE PASSWORD ━━
    if (action === 'change_password') {
      const sellerId = String(body.sellerId || '').trim();
      const token = String(body.token || '').trim();
      const oldPassword = String(body.oldPassword || '').trim();
      const newPassword = String(body.newPassword || '').trim();

      if (!sellerId || !verifySellerToken(sellerId, token, secret)) {
        return res.status(401).json({ error: 'Unauthorized session. Please log in again.' });
      }

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
      }

      let seller = SELLER_MEMORY_STORE.sellers.get(sellerId);

      if (!seller) {
        try {
          const evSRes = await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`);
          if (evSRes.ok) seller = await evSRes.json();
        } catch (_) {}
      }

      if (!seller) {
        try {
          const rootSRes = await fetch(`${RTDB_URL}/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`);
          if (rootSRes.ok) seller = await rootSRes.json();
        } catch (_) {}
      }

      if (!seller) return res.status(404).json({ error: 'Seller record not found.' });

      // If email present, also query findSellerByEmail to discover all associated keys
      if (seller.email) {
        try {
          const fullSeller = await findSellerByEmail(seller.email);
          if (fullSeller) {
            seller = { ...fullSeller, ...seller };
          }
        } catch (_) {}
      }

      // Verify old password if provided
      if (seller.passwordHash && oldPassword) {
        if (!verifyPassword(oldPassword, seller.passwordHash, secret)) {
          return res.status(400).json({ error: 'Current password does not match.' });
        }
      }

      const newHash = hashSellerPassword(newPassword, secret);
      const nowTs = Date.now();
      const updateData = {
        passwordHash: newHash,
        mustChangePassword: false,
        passwordUpdatedAt: nowTs,
      };

      const keysToUpdate = (seller.allMatchedKeys && seller.allMatchedKeys.length) ? seller.allMatchedKeys : [sellerId];
      keysToUpdate.forEach(k => {
        if (SELLER_MEMORY_STORE.sellers.has(k)) {
          const mem = SELLER_MEMORY_STORE.sellers.get(k);
          Object.assign(mem, updateData);
        } else {
          SELLER_MEMORY_STORE.sellers.set(k, { ...seller, ...updateData, id: k });
        }
      });

      try {
        const patchPromises = [];
        keysToUpdate.forEach(k => {
          patchPromises.push(
            fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(k)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updateData),
            }).catch(() => {})
          );
          patchPromises.push(
            fetch(`${RTDB_URL}/sellers/${encodeURIComponent(k)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updateData),
            }).catch(() => {})
          );
        });
        await Promise.allSettled(patchPromises);
      } catch (_) {}

      // Send Security Confirmation Email via Brevo API
      const apiKey = (process.env.BREVO_API_KEY || '').trim();
      const senderEmail = (process.env.BREVO_SENDER_EMAIL || 'ritikanetwork96@gmail.com').trim();
      const senderName = (process.env.BREVO_SENDER_NAME || 'JaiGram Shop').trim();

      const reqHost = req.headers['host'] || req.headers['x-forwarded-host'] || '';
      const isLocal = reqHost.includes('localhost') || reqHost.includes('127.0.0.1');
      const portalUrl = isLocal ? `http://${reqHost}/seller/login` : 'https://jaigram.shop/seller/login';

      if (apiKey && seller.email) {
        try {
          const timestampStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
          await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'api-key': apiKey,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              sender: { name: senderName, email: senderEmail },
              to: [{ email: seller.email, name: seller.ownerName || seller.storeName }],
              subject: `🔒 Security Alert: Your JaiGram Seller Password Has Been Updated`,
              htmlContent: renderPasswordChangedNotificationEmail(
                seller.ownerName || seller.storeName,
                seller.storeName,
                timestampStr,
                portalUrl
              ),
            }),
          });
        } catch (mailErr) {
          console.warn('Could not send password change confirmation email:', mailErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Password updated successfully! A confirmation notification has been sent to your email.',
      });
    }

    // ━━ 3. FORGOT PASSWORD REQUEST (SEND OTP) ━━
    if (action === 'forgot_password_request') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }

      const seller = await findSellerByEmail(email);
      if (!seller) {
        return res.status(404).json({ error: 'No registered seller account found with this email. Have you applied yet?' });
      }

      const otp = crypto.randomInt(100000, 1000000).toString();
      const resetExpires = Date.now() + 15 * 60 * 1000; // 15 mins

      const updateData = {
        email: seller.email || email,
        resetOtp: otp,
        resetExpires,
        resetAttempts: 0,
      };

      const keysToUpdate = (seller.allMatchedKeys && seller.allMatchedKeys.length) ? seller.allMatchedKeys : [seller.id];

      keysToUpdate.forEach(k => {
        if (SELLER_MEMORY_STORE.sellers.has(k)) {
          const mem = SELLER_MEMORY_STORE.sellers.get(k);
          Object.assign(mem, updateData);
        } else {
          SELLER_MEMORY_STORE.sellers.set(k, { ...seller, ...updateData, id: k });
        }
      });

      // Write reset OTP to BOTH /events/sellers and /sellers across all matched keys
      try {
        const patchPromises = [];
        keysToUpdate.forEach(k => {
          patchPromises.push(
            fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(k)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updateData),
            }).catch(() => {})
          );
          patchPromises.push(
            fetch(`${RTDB_URL}/sellers/${encodeURIComponent(k)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updateData),
            }).catch(() => {})
          );
        });
        await Promise.allSettled(patchPromises);
      } catch (e) {
        console.warn('Failed to save reset OTP:', e.message);
      }

      // Send OTP via Brevo API
      const apiKey = (process.env.BREVO_API_KEY || '').trim();
      const senderEmail = (process.env.BREVO_SENDER_EMAIL || 'ritikanetwork96@gmail.com').trim();
      const senderName = (process.env.BREVO_SENDER_NAME || 'JaiGram Shop').trim();

      if (apiKey) {
        try {
          const reqHost = req.headers['host'] || req.headers['x-forwarded-host'] || '';
          const isLocal = reqHost.includes('localhost') || reqHost.includes('127.0.0.1');
          const portalUrl = isLocal ? `http://${reqHost}/seller/login` : 'https://jaigram.shop/seller/login';

          await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'api-key': apiKey,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              sender: { name: senderName, email: senderEmail },
              to: [{ email: seller.email, name: seller.ownerName || seller.storeName }],
              subject: `🔐 JaiGram Seller Hub: Your Password Reset Code is ${otp}`,
              htmlContent: renderPasswordResetEmail(seller.ownerName, seller.storeName, otp, portalUrl),
            }),
          });
        } catch (mailErr) {
          console.warn('Brevo reset email dispatch warning:', mailErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: `A 6-digit verification code has been dispatched to ${email}.`,
      });
    }

    // ━━ 4. FORGOT PASSWORD VERIFY (RESET PASSWORD) ━━
    if (action === 'forgot_password_verify') {
      const email = String(body.email || '').trim().toLowerCase();
      const otp = String(body.otp || '').trim();
      const newPassword = String(body.newPassword || '').trim();

      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      if (!otp || otp.length < 4) {
        return res.status(400).json({ error: 'Please enter the verification code sent to your email.' });
      }
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
      }

      const seller = await findSellerByEmail(email);
      if (!seller) {
        return res.status(404).json({ error: 'No seller record found.' });
      }

      const currentAttempts = Number(seller.resetAttempts || 0);
      if (currentAttempts >= 5) {
        // Invalidate OTP on 5 failed attempts in BOTH nodes
        try {
          const lockPayload = { resetOtp: null, resetExpires: null, resetAttempts: 0 };
          await Promise.allSettled([
            fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(seller.id)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(lockPayload),
            }),
            fetch(`${RTDB_URL}/sellers/${encodeURIComponent(seller.id)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(lockPayload),
            }),
          ]);
        } catch (_) {}
        return res.status(429).json({ error: 'Too many incorrect attempts. Password reset code has been locked. Please request a new code.' });
      }

      const storedOtp = seller.resetOtp !== undefined && seller.resetOtp !== null ? String(seller.resetOtp).trim() : '';
      if (!storedOtp || storedOtp !== otp) {
        const nextAttempts = currentAttempts + 1;
        try {
          const attemptPayload = { resetAttempts: nextAttempts };
          await Promise.allSettled([
            fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(seller.id)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(attemptPayload),
            }),
            fetch(`${RTDB_URL}/sellers/${encodeURIComponent(seller.id)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(attemptPayload),
            }),
          ]);
        } catch (_) {}
        const remaining = Math.max(0, 5 - nextAttempts);
        return res.status(400).json({ error: `Invalid verification code. ${remaining} attempt(s) remaining.` });
      }

      if (!seller.resetExpires || Date.now() > Number(seller.resetExpires)) {
        return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
      }

      const newHash = hashSellerPassword(newPassword, secret);
      const nowTs = Date.now();
      const updateData = {
        passwordHash: newHash,
        mustChangePassword: false,
        passwordUpdatedAt: nowTs,
        resetOtp: null,
        resetExpires: null,
        resetAttempts: 0,
      };

      // Clear failed login attempts / lockouts immediately
      sellerFailedLoginMap.delete(email);

      const keysToUpdate = (seller.allMatchedKeys && seller.allMatchedKeys.length) ? seller.allMatchedKeys : [seller.id];

      keysToUpdate.forEach(k => {
        if (SELLER_MEMORY_STORE.sellers.has(k)) {
          const mem = SELLER_MEMORY_STORE.sellers.get(k);
          Object.assign(mem, updateData);
        } else {
          SELLER_MEMORY_STORE.sellers.set(k, { ...seller, ...updateData, id: k });
        }
      });

      try {
        const patchPromises = [];
        keysToUpdate.forEach(k => {
          patchPromises.push(
            fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(k)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updateData),
            }).catch(() => {})
          );
          patchPromises.push(
            fetch(`${RTDB_URL}/sellers/${encodeURIComponent(k)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updateData),
            }).catch(() => {})
          );
        });
        await Promise.allSettled(patchPromises);
      } catch (e) {
        console.warn('Failed to update reset password:', e.message);
      }

      // Send Security Confirmation Email via Brevo API
      const apiKey = (process.env.BREVO_API_KEY || '').trim();
      const senderEmail = (process.env.BREVO_SENDER_EMAIL || 'ritikanetwork96@gmail.com').trim();
      const senderName = (process.env.BREVO_SENDER_NAME || 'JaiGram Shop').trim();

      const reqHost = req.headers['host'] || req.headers['x-forwarded-host'] || '';
      const isLocal = reqHost.includes('localhost') || reqHost.includes('127.0.0.1');
      const portalUrl = isLocal ? `http://${reqHost}/seller/login` : 'https://jaigram.shop/seller/login';

      if (apiKey && (seller.email || email)) {
        try {
          const timestampStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
          await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'api-key': apiKey,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              sender: { name: senderName, email: senderEmail },
              to: [{ email: seller.email || email, name: seller.ownerName || seller.storeName || 'Partner' }],
              subject: `🔒 Security Alert: Your JaiGram Seller Password Has Been Updated`,
              htmlContent: renderPasswordChangedNotificationEmail(
                seller.ownerName || seller.storeName,
                seller.storeName || 'Creator Store',
                timestampStr,
                portalUrl
              ),
            }),
          });
        } catch (mailErr) {
          console.warn('Could not send password change confirmation email:', mailErr.message);
        }
      }

      // Generate session token so seller can be logged in immediately
      const token = createSellerToken(seller.id, secret);
      const safeSeller = {
        id: seller.id,
        email: seller.email,
        ownerName: seller.ownerName,
        storeName: seller.storeName,
        phone: seller.phone || '',
        telegram: seller.telegram || '',
        upiId: seller.upiId || '',
        avatar: seller.avatar || '',
        category: seller.category || 'General',
        mustChangePassword: false,
        status: seller.status || 'active',
      };

      return res.status(200).json({
        success: true,
        message: 'Password reset successfully! You can now sign in with your new password.',
        token,
        seller: safeSeller,
      });
    }

    // ━━ 5. GET SESSION / VALIDATE ━━
    if (action === 'get_session') {
      const sellerId = String(body.sellerId || '').trim();
      const token = String(body.token || '').trim();

      if (!sellerId || !verifySellerToken(sellerId, token, secret)) {
        return res.status(401).json({ error: 'Invalid or expired session.', valid: false });
      }

      let seller = SELLER_MEMORY_STORE.sellers.get(sellerId);

      if (!seller) {
        try {
          const evRes = await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`);
          if (evRes.ok) seller = await evRes.json();
        } catch (_) {}
      }

      if (!seller) {
        try {
          const rootRes = await fetch(`${RTDB_URL}/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`);
          if (rootRes.ok) seller = await rootRes.json();
        } catch (_) {}
      }

      if (!seller) return res.status(404).json({ error: 'Seller not found.', valid: false });

      return res.status(200).json({
        success: true,
        valid: true,
        seller: {
          id: seller.id || sellerId,
          email: seller.email,
          ownerName: seller.ownerName,
          storeName: seller.storeName,
          phone: seller.phone || '',
          telegram: seller.telegram || '',
          payoutMethod: seller.payoutMethod || (seller.upiId ? 'upi' : ''),
          payoutCountry: seller.payoutCountry || (seller.usdtAddress || seller.binancePayId || seller.paypalEmail ? 'INTL' : 'IN'),
          upiId: seller.upiId || '',
          bankName: seller.bankName || '',
          accountHolder: seller.accountHolder || '',
          accountNumber: seller.accountNumber || '',
          ifsc: seller.ifsc || '',
          usdtAddress: seller.usdtAddress || '',
          usdtNetwork: seller.usdtNetwork || 'TRC-20',
          binancePayId: seller.binancePayId || '',
          paypalEmail: seller.paypalEmail || '',
          avatar: seller.avatar || '',
          category: seller.category || 'General',
          followerCount: Number(seller.followerCount || seller.followers || 0),
          mustChangePassword: Boolean(seller.mustChangePassword),
          status: seller.status,
        },
      });
    }

    // ━━ 6. UPDATE SELLER PROFILE & SETTINGS ━━
    if (action === 'update_profile') {
      const sellerId = String(body.sellerId || '').trim();
      const token = String(body.token || '').trim();

      if (!sellerId || !verifySellerToken(sellerId, token, secret)) {
        return res.status(401).json({ error: 'Unauthorized seller session. Please log in again.' });
      }

      // Fetch existing seller first so partial updates (e.g. updating only UPI or Payout) work smoothly
      let seller = SELLER_MEMORY_STORE.sellers.get(sellerId);
      if (!seller) {
        try {
          const evRes = await fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`);
          if (evRes.ok) seller = await evRes.json();
        } catch (_) {}
      }
      if (!seller) {
        try {
          const rootRes = await fetch(`${RTDB_URL}/sellers/${encodeURIComponent(sellerId)}.json${authQuery}`);
          if (rootRes.ok) seller = await rootRes.json();
        } catch (_) {}
      }

      if (!seller) {
        return res.status(404).json({ error: 'Seller account not found.' });
      }

      // Support partial update: use provided body values, or fallback to existing seller values
      const storeName = body.storeName !== undefined ? String(body.storeName || '').trim() : String(seller.storeName || '').trim();
      const ownerName = body.ownerName !== undefined ? String(body.ownerName || '').trim() : String(seller.ownerName || '').trim();
      const email = body.email !== undefined ? String(body.email || '').trim().toLowerCase() : String(seller.email || '').trim().toLowerCase();
      const phone = body.phone !== undefined ? String(body.phone || '').trim() : String(seller.phone || '').trim();
      const telegram = body.telegram !== undefined ? String(body.telegram || '').trim() : String(seller.telegram || '').trim();

      // Payout Fields (India UPI / Bank + International Crypto / Binance / PayPal)
      const payoutCountry = body.payoutCountry !== undefined ? String(body.payoutCountry || 'IN').trim() : (seller.payoutCountry || 'IN');
      const payoutMethod = body.payoutMethod !== undefined ? String(body.payoutMethod || 'upi').trim() : (seller.payoutMethod || 'upi');
      const upiId = body.upiId !== undefined ? String(body.upiId || '').trim() : String(seller.upiId || '').trim();
      const bankName = body.bankName !== undefined ? String(body.bankName || '').trim() : String(seller.bankName || '').trim();
      const accountHolder = body.accountHolder !== undefined ? String(body.accountHolder || '').trim() : String(seller.accountHolder || '').trim();
      const accountNumber = body.accountNumber !== undefined ? String(body.accountNumber || '').trim() : String(seller.accountNumber || '').trim();
      const ifsc = body.ifsc !== undefined ? String(body.ifsc || '').trim().toUpperCase() : String(seller.ifsc || '').trim().toUpperCase();
      const usdtAddress = body.usdtAddress !== undefined ? String(body.usdtAddress || '').trim() : String(seller.usdtAddress || '').trim();
      const usdtNetwork = body.usdtNetwork !== undefined ? String(body.usdtNetwork || 'TRC-20').trim() : (seller.usdtNetwork || 'TRC-20');
      const binancePayId = body.binancePayId !== undefined ? String(body.binancePayId || '').trim() : String(seller.binancePayId || '').trim();
      const paypalEmail = body.paypalEmail !== undefined ? String(body.paypalEmail || '').trim() : String(seller.paypalEmail || '').trim();

      const currentPassword = String(body.currentPassword || '').trim();
      const newPassword = String(body.newPassword || '').trim();

      if (!storeName) {
        return res.status(400).json({ error: 'Company / Store Name is required.' });
      }
      if (!ownerName) {
        return res.status(400).json({ error: 'Your Full Name is required.' });
      }
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }

      // Strictly protect admin account
      if (email.toLowerCase() === 'ritikanetwork96@gmail.com') {
        return res.status(403).json({ error: 'This email is reserved for system administration.' });
      }

      // If email changed, verify uniqueness across other sellers
      if (email !== String(seller.email || '').toLowerCase()) {
        const existingWithEmail = await findSellerByEmail(email);
        if (existingWithEmail && existingWithEmail.id !== sellerId) {
          return res.status(400).json({ error: 'Another seller is already registered with this email address.' });
        }
      }

      // If new password provided, verify current password
      let updatedHash = null;
      if (newPassword) {
        if (newPassword.length < 6) {
          return res.status(400).json({ error: 'New password must be at least 6 characters.' });
        }
        if (seller.passwordHash && currentPassword) {
          if (!verifyPassword(currentPassword, seller.passwordHash, secret)) {
            return res.status(400).json({ error: 'Current password is incorrect.' });
          }
        } else if (seller.passwordHash && !currentPassword) {
          return res.status(400).json({ error: 'Please enter your current password to set a new password.' });
        }
        updatedHash = hashSellerPassword(newPassword, secret);
      }

      const avatar = typeof body.avatar === 'string' ? body.avatar.trim() : (seller.avatar || '');
      const category = typeof body.category === 'string' ? body.category.trim() : (seller.category || 'General');

      const patchData = {
        storeName,
        ownerName,
        email,
        category,
        phone,
        telegram,
        payoutCountry,
        payoutMethod,
        upiId,
        bankName,
        accountHolder,
        accountNumber,
        ifsc,
        usdtAddress,
        usdtNetwork,
        binancePayId,
        paypalEmail,
        avatar,
        updatedAt: Date.now(),
      };

      if (updatedHash) {
        patchData.passwordHash = updatedHash;
        patchData.mustChangePassword = false;
        patchData.passwordUpdatedAt = Date.now();
      }

      // Update in-memory across all matching keys
      const keysToUpdate = (seller.allMatchedKeys && seller.allMatchedKeys.length) ? seller.allMatchedKeys : [sellerId];
      keysToUpdate.forEach(k => {
        if (SELLER_MEMORY_STORE.sellers.has(k)) {
          const mem = SELLER_MEMORY_STORE.sellers.get(k);
          Object.assign(mem, patchData);
        } else {
          SELLER_MEMORY_STORE.sellers.set(k, { ...seller, ...patchData, id: k });
        }
      });

      // Update RTDB /events/sellers and /sellers across all keys
      try {
        const patchPromises = [];
        keysToUpdate.forEach(k => {
          patchPromises.push(
            fetch(`${RTDB_URL}/events/sellers/${encodeURIComponent(k)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patchData),
            }).catch(() => {})
          );
          patchPromises.push(
            fetch(`${RTDB_URL}/sellers/${encodeURIComponent(k)}.json${authQuery}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patchData),
            }).catch(() => {})
          );
        });
        await Promise.allSettled(patchPromises);
      } catch (e) {
        console.warn('sellers patch error:', e.message);
      }

      // If password was changed in profile, send security alert email via Brevo
      if (updatedHash) {
        const apiKey = (process.env.BREVO_API_KEY || '').trim();
        const senderEmail = (process.env.BREVO_SENDER_EMAIL || 'ritikanetwork96@gmail.com').trim();
        const senderName = (process.env.BREVO_SENDER_NAME || 'JaiGram Shop').trim();

        const reqHost = req.headers['host'] || req.headers['x-forwarded-host'] || '';
        const isLocal = reqHost.includes('localhost') || reqHost.includes('127.0.0.1');
        const portalUrl = isLocal ? `http://${reqHost}/seller/login` : 'https://jaigram.shop/seller/login';

        if (apiKey && email) {
          try {
            const timestampStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
            await fetch('https://api.brevo.com/v3/smtp/email', {
              method: 'POST',
              headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                sender: { name: senderName, email: senderEmail },
                to: [{ email, name: ownerName || storeName }],
                subject: `🔒 Security Alert: Your JaiGram Seller Password Has Been Updated`,
                htmlContent: renderPasswordChangedNotificationEmail(
                  ownerName || storeName,
                  storeName,
                  timestampStr,
                  portalUrl
                ),
              }),
            });
          } catch (mailErr) {
            console.warn('Could not send password change confirmation email:', mailErr.message);
          }
        }
      }

      // Also update /public_sellers/{id} so directory reflects changes instantly
      try {
        const publicPatch = {
          id: sellerId,
          storeName,
          category,
          avatar,
          updatedAt: Date.now(),
        };
        await fetch(`${RTDB_URL}/public_sellers/${encodeURIComponent(sellerId)}.json${authQuery}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(publicPatch),
        });
      } catch (e) {
        console.warn('public_sellers patch error:', e.message);
      }

      // If storeName changed, sync all products belonging to this seller!
      if (storeName !== seller.storeName) {
        try {
          const prodRes = await fetch(`${RTDB_URL}/products.json${authQuery}`);
          if (prodRes.ok) {
            const allProds = await prodRes.json();
            if (allProds && typeof allProds === 'object') {
              const updates = {};
              for (const [pid, p] of Object.entries(allProds)) {
                if (p && p.sellerId === sellerId) {
                  updates[`products/${pid}/sellerName`] = storeName;
                }
              }
              if (Object.keys(updates).length > 0) {
                await fetch(`${RTDB_URL}/.json${authQuery}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(updates),
                });
              }
            }
          }
        } catch (prodErr) {
          console.warn('Product sellerName sync error:', prodErr.message);
        }
      }

      const updatedSafeSeller = {
        id: sellerId,
        email,
        ownerName,
        storeName,
        phone,
        telegram,
        payoutCountry,
        payoutMethod,
        upiId,
        bankName,
        accountHolder,
        accountNumber,
        ifsc,
        usdtAddress,
        usdtNetwork,
        binancePayId,
        paypalEmail,
        avatar,
        category,
        followerCount: Number(seller.followerCount || seller.followers || 0),
        mustChangePassword: false,
        status: seller.status || 'active',
      };

      return res.status(200).json({
        success: true,
        seller: updatedSafeSeller,
        message: 'Profile and payment details updated successfully in database!',
      });
    }

    return res.status(400).json({ error: 'Invalid action requested.' });
  } catch (err) {
    console.error('Unexpected error in /api/seller/auth:', err);
    return res.status(500).json({ error: err.message || 'Server error in seller authentication.' });
  }
}
