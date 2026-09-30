import crypto from 'node:crypto';
import { deriveCustomerId, handleCors, verifyAdminRequest, getAuthSecret } from '../_utils.js';

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

let cachedToken = null;
let tokenExpiresAt = 0;

export async function getFirebaseAdminToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }
  const apiKey = (process.env.FIREBASE_API_KEY || '').trim();
  const adminEmail = (process.env.admin || '').trim();
  const adminPassword = (process.env.password || '').trim();

  if (!apiKey || !adminEmail || !adminPassword) {
    return null;
  }

  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword, returnSecureToken: true }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.idToken) {
      cachedToken = data.idToken;
      tokenExpiresAt = Date.now() + (Number(data.expiresIn) || 3600) * 1000;
      return cachedToken;
    }
  } catch (err) {
    console.warn('Firebase admin token error:', err.message);
  }
  return null;
}

export const computeCustomerId = deriveCustomerId;

export async function fetchCustomerRecord(uid, token) {
  const authQuery = token ? `?auth=${encodeURIComponent(token)}` : '';

  // 1. Try standard /customers/ node
  try {
    const res = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(uid)}.json${authQuery}`);
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error && data.email) return data;
    }
  } catch (_) {}

  // 2. Try guaranteed /events/customers/ node
  try {
    const res = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/events/customers/${encodeURIComponent(uid)}.json${authQuery}`);
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error && data.email) return data;
    }
  } catch (_) {}

  return null;
}

export async function fetchAllCustomers(token) {
  const authQuery = token ? `?auth=${encodeURIComponent(token)}` : '';
  const customerMap = new Map();

  // 1. Read from /events/customers
  try {
    const res = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/events/customers.json${authQuery}`);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        Object.keys(data).forEach(key => {
          const item = data[key];
          if (item && item.email) {
            customerMap.set(item.email.toLowerCase().trim(), item);
          }
        });
      }
    }
  } catch (err) {
    console.warn('Fetch all from events/customers notice:', err.message);
  }

  // 2. Read from /customers
  try {
    const res = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers.json${authQuery}`);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        Object.keys(data).forEach(key => {
          const item = data[key];
          if (item && item.email) {
            const emailKey = item.email.toLowerCase().trim();
            const existing = customerMap.get(emailKey);
            customerMap.set(emailKey, { ...existing, ...item });
          }
        });
      }
    }
  } catch (_) {}

  const list = Array.from(customerMap.values());
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list;
}

export async function saveCustomerRecord(uid, customer, token) {
  const authQuery = token ? `?auth=${encodeURIComponent(token)}` : '';
  let saved = false;

  // 1. Save to /events/customers/ (guaranteed permitted on active RTDB)
  try {
    const res = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/events/customers/${encodeURIComponent(uid)}.json${authQuery}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customer),
    });
    if (res.ok) {
      const data = await res.json();
      if (!data?.error) saved = true;
    }
  } catch (err) {
    console.warn('Save to events/customers error:', err.message);
  }

  // 2. Also save to standard /customers/ (when database.rules.json is active)
  try {
    await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(uid)}.json${authQuery}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customer),
    });
  } catch (_) {}

  return saved;
}

export async function deleteCustomerRecord(uid, token) {
  const authQuery = token ? `?auth=${encodeURIComponent(token)}` : '';
  try {
    await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/events/customers/${encodeURIComponent(uid)}.json${authQuery}`, {
      method: 'DELETE',
    });
  } catch (_) {}
  try {
    await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(uid)}.json${authQuery}`, {
      method: 'DELETE',
    });
  } catch (_) {}
}

async function isAuthorizedAdmin(req) {
  return await verifyAdminRequest(req);
}

export default async function handler(req, res) {
  if (handleCors(req, res, 'GET, POST, OPTIONS')) return;

  const token = await getFirebaseAdminToken();

  // Helper to extract query parameters safely
  const query = (() => {
    if (req.query && typeof req.query === 'object') return req.query;
    try {
      const url = new URL(req.url || '', 'http://localhost');
      const params = {};
      for (const [k, v] of url.searchParams.entries()) {
        params[k] = v;
      }
      return params;
    } catch (_) {
      return {};
    }
  })();

  // GET: Fetch all customers (Admin only) or fetch individual customer by email / uid
  if (req.method === 'GET') {
    const wantsListAll = query.all === 'true' || query.list === 'true';

    if (wantsListAll) {
      const authorized = await isAuthorizedAdmin(req);
      if (!authorized) {
        return res.status(403).json({ error: 'Unauthorized. Admin credentials required to list customers.' });
      }

      try {
        const users = await fetchAllCustomers(token);
        return res.status(200).json({
          success: true,
          count: users.length,
          users,
        });
      } catch (err) {
        return res.status(500).json({ error: err.message || 'Failed to list users.' });
      }
    }

    const email = String(query.email || '').toLowerCase().trim();
    let uid = String(query.uid || '').trim();

    if (!uid && email) {
      uid = computeCustomerId(email);
    }

    if (!uid) {
      return res.status(400).json({ error: 'Please provide email or uid parameter.' });
    }

    try {
      const customer = await fetchCustomerRecord(uid, token);
      const isTokenValid = customer && verifyCustomerToken(req, uid, customer.email);
      const isAdmin = await isAuthorizedAdmin(req);
      const isAuthorized = isAdmin || isTokenValid;

      if (!isAuthorized) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: Valid customer session token or master administrator authentication required.',
        });
      }

      if (customer && (customer.status === 'banned' || customer.banned || customer.isBanned) && !isAdmin) {
        return res.status(403).json({
          success: false,
          error: customer.banReason ? `Your account has been suspended: ${customer.banReason}` : 'Your account has been suspended by administration. Please contact support.',
          banned: true,
          status: 'banned',
        });
      }

      // Provide comprehensive customer details for the user with strictly verified wallet balance
      let verifiedWalletBal = Number(customer?.walletBalance);
      if (isNaN(verifiedWalletBal) || verifiedWalletBal < 0 || verifiedWalletBal === 120 || verifiedWalletBal >= 50000 || String(customer?.walletBalance).includes('11220') || String(customer?.walletBalance).includes('100011')) {
        verifiedWalletBal = 0.00;
        if (customer && (Number(customer.walletBalance) >= 50000 || Number(customer.walletBalance) === 120 || String(customer.walletBalance).includes('11220'))) {
          customer.walletBalance = 0.00;
          saveCustomerRecord(uid, { ...customer, walletBalance: 0.00, updatedAt: Date.now() }, token).catch(() => {});
        }
      }

      const safeCustomer = customer ? {
        uid: customer.uid,
        displayName: customer.displayName || 'Customer',
        username: customer.username || customer.handle || (customer.email ? customer.email.split('@')[0] : ''),
        handle: customer.handle || customer.username || (customer.email ? customer.email.split('@')[0] : ''),
        hasSavedName: customer.hasSavedName !== false,
        email: customer.email,
        photoURL: customer.photoURL || '',
        walletBalance: verifiedWalletBal,
        createdAt: customer.createdAt,
        totalOrders: customer.totalOrders || 0,
        lastOrderAt: customer.lastOrderAt || null,
      } : null;

      return res.status(200).json({
        success: true,
        uid,
        customer: isAuthorized && customer ? { ...customer, ...safeCustomer, walletBalance: verifiedWalletBal } : safeCustomer,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to fetch customer record.' });
    }
  }

  // POST: Create, unify, or update customer profile (handles Name and Email edits!)
  if (req.method === 'POST') {
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

      const email = String(body.email || body.newEmail || '').toLowerCase().trim();
      const oldEmail = String(body.oldEmail || '').toLowerCase().trim();
      const oldUid = String(body.oldUid || '').trim() || (oldEmail ? computeCustomerId(oldEmail) : null);

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'A valid email address is required.' });
      }

      const uid = computeCustomerId(email);
      const fallbackName = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const incomingProvider = String(body.provider || 'email_otp').trim();

      // Retrieve existing customer record (checking new UID first, or old UID if email changed)
      let existing = await fetchCustomerRecord(uid, token);
      if (!existing && oldUid && oldUid !== uid) {
        existing = await fetchCustomerRecord(oldUid, token);
      }

      // Security check: Check if user account has been suspended or banned
      if (existing && (existing.status === 'banned' || existing.banned || existing.isBanned)) {
        const isAdminCaller = await isAuthorizedAdmin(req);
        if (!isAdminCaller) {
          return res.status(403).json({
            error: existing.banReason ? `Your account has been suspended: ${existing.banReason}` : 'Your account has been suspended by administration. Please contact support.',
            banned: true,
            status: 'banned',
          });
        }
      }

      // Extract incoming requested name
      const incomingName = String(body.newName || body.name || body.displayName || '').trim();

      // Security check: If modifying an existing customer profile with a saved name, verify caller authority
      if (existing?.hasSavedName && incomingName && incomingName !== existing.displayName) {
        const isAdmin = await isAuthorizedAdmin(req);
        const isSelf = verifyCustomerToken(req, uid, email) || (oldUid && verifyCustomerToken(req, oldUid, oldEmail));
        if (!isAdmin && !isSelf) {
          return res.status(403).json({
            error: 'Security Notice: Modifying an existing profile requires valid session credentials.',
          });
        }
      }

      // Determine display name:
      // Priority 1: Explicitly provided newName, name, or displayName in current request
      let finalDisplayName = fallbackName;
      if (incomingName && incomingName !== fallbackName) {
        finalDisplayName = incomingName;
      } else if (existing?.displayName && existing.displayName !== fallbackName) {
        finalDisplayName = existing.displayName;
      } else if (incomingName) {
        finalDisplayName = incomingName;
      }

      // Combine auth providers into unified list
      const existingProviders = Array.isArray(existing?.providers)
        ? existing.providers
        : (existing?.provider ? [existing.provider] : []);
      const mergedProviders = Array.from(new Set([...existingProviders, incomingProvider].filter(Boolean)));

      const hasSavedCustomName = Boolean(
        body.hasSavedName !== undefined ? body.hasSavedName : 
        (existing?.hasSavedName || (finalDisplayName && finalDisplayName !== fallbackName && finalDisplayName !== 'Customer'))
      );

      // Wallet balance security:
      // Customers cannot arbitrarily increase their balance on the client.
      // Balance can only be increased by an authorized admin or through verified order payments.
      // Customers may only decrease their balance (e.g. spending on an order).
      const isAdminCaller = await isAuthorizedAdmin(req);
      let finalWalletBalance = existing?.walletBalance !== undefined ? Number(existing.walletBalance) : 0.00;
      if (isNaN(finalWalletBalance) || finalWalletBalance < 0 || finalWalletBalance === 120 || finalWalletBalance >= 50000 || String(finalWalletBalance).includes('11220') || String(finalWalletBalance).includes('100011')) {
        finalWalletBalance = 0.00;
      }
      if (body.walletBalance !== undefined) {
        const incomingBal = Number(body.walletBalance);
        if (incomingBal === 120 || incomingBal >= 50000 || String(incomingBal).includes('11220') || String(incomingBal).includes('100011')) {
          finalWalletBalance = 0.00;
        } else if (isAdminCaller) {
          finalWalletBalance = Math.max(0, incomingBal);
        } else if (incomingBal <= finalWalletBalance) {
          finalWalletBalance = Math.max(0, incomingBal);
        } else {
          console.warn(`[Security Alert] Blocked unauthorized client attempt to increase wallet balance for ${email}: ${finalWalletBalance} -> ${incomingBal}`);
        }
      }

      const incomingUsername = String(body.username || body.handle || '').trim().replace(/^@/, '');
      const finalUsername = incomingUsername || existing?.username || existing?.handle || (email ? email.split('@')[0] : '');

      const userStatus = existing?.status || (existing?.banned ? 'banned' : 'active');
      const unifiedCustomer = {
        ...(existing || {}),
        uid,
        email,
        displayName: finalDisplayName,
        username: finalUsername,
        handle: finalUsername,
        hasSavedName: hasSavedCustomName,
        photoURL: body.photoURL !== undefined ? body.photoURL : (existing?.photoURL || ''),
        walletBalance: finalWalletBalance,
        totalOrders: existing?.totalOrders !== undefined ? existing.totalOrders : 0,
        provider: incomingProvider,
        providers: mergedProviders.length ? mergedProviders : [incomingProvider],
        verified: existing?.verified !== undefined ? existing.verified : true,
        status: userStatus,
        banned: existing?.banned || false,
        isBanned: existing?.isBanned || false,
        banReason: existing?.banReason || null,
        bannedAt: existing?.bannedAt || null,
        createdAt: existing?.createdAt || Date.now(),
        lastLoginAt: Date.now(),
        updatedAt: Date.now(),
      };
      delete unifiedCustomer.phone;

      await saveCustomerRecord(uid, unifiedCustomer, token);

      // If email changed and old UID exists, verify caller is authorized before deleting old account!
      if (oldUid && oldUid !== uid) {
        const isMasterAdmin = await isAuthorizedAdmin(req);
        const authHeader = req?.headers?.authorization || req?.headers?.Authorization || '';
        const clientToken = authHeader.replace(/^Bearer\s+/i, '').trim();

        let isAuthorizedSession = isMasterAdmin;
        if (!isAuthorizedSession && clientToken && clientToken.includes('.')) {
          const [expiresStr, sig] = clientToken.split('.');
          const secret = getAuthSecret();
          const expectedSig = crypto.createHmac('sha256', secret).update(`${oldEmail || email}:${expiresStr}`).digest('hex');
          if (Date.now() < Number(expiresStr) && sig === expectedSig) {
            isAuthorizedSession = true;
          }
        }

        if (!isAuthorizedSession) {
          return res.status(403).json({
            error: 'Unauthorized: Valid customer session token required to migrate or delete previous customer account.',
          });
        }

        await deleteCustomerRecord(oldUid, token);
      }

      return res.status(200).json({
        success: true,
        customer: unifiedCustomer,
        isNew: !existing,
      });
    } catch (err) {
      console.error('Customer handler error:', err);
      return res.status(500).json({ error: err.message || 'Internal server error resolving customer.' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
