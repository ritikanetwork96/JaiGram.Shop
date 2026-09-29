import crypto from 'node:crypto';
import { handleCors, getClientIp, isValidEmail, getFirebaseAdminToken, SELLER_MEMORY_STORE } from '../_utils.js';

const RTDB_URL = 'https://linkadda-cd1da-default-rtdb.firebaseio.com';

const applyIpRateLimitMap = globalThis.__LINKADDA_APPLY_IP_MAP || (globalThis.__LINKADDA_APPLY_IP_MAP = new Map());
const APPLY_WINDOW_MS = 60 * 60 * 1000; // 1 hour window
const MAX_APPLY_PER_IP = 5; // Max 5 applications per hour per IP

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST, OPTIONS')) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const clientIp = getClientIp(req);
    const now = Date.now();
    let ipHistory = (applyIpRateLimitMap.get(clientIp) || []).filter(t => now - t < APPLY_WINDOW_MS);
    if (ipHistory.length >= MAX_APPLY_PER_IP) {
      return res.status(429).json({
        error: 'Too many seller applications submitted from this network. Please try again in an hour.',
        retryAfter: 3600,
      });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    const applicantName = String(body.applicantName || body.name || '').trim();
    const storeName = String(body.storeName || '').trim();
    const telegram = String(body.telegram || body.phone || '').trim();
    const category = String(body.category || 'General').trim();
    const portfolioLink = String(body.portfolioLink || body.samples || '').trim();
    const reason = String(body.reason || '').trim();

    if (!applicantName) {
      return res.status(400).json({ error: 'Please enter your full name.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!storeName) {
      return res.status(400).json({ error: 'Please enter your desired store or brand name.' });
    }
    if (!telegram) {
      return res.status(400).json({ error: 'Please provide your Telegram handle or phone number for admin verification.' });
    }

    // Check memory store for duplicate
    for (const app of SELLER_MEMORY_STORE.applications.values()) {
      if (app && String(app.email || '').toLowerCase() === email) {
        if (app.status === 'pending') {
          return res.status(400).json({
            error: 'You already have a pending seller application under review. Please wait for admin approval.',
            status: 'pending',
          });
        } else if (app.status === 'approved') {
          return res.status(400).json({
            error: 'Your seller account has already been approved! Please log in at the Seller Hub.',
            status: 'approved',
          });
        }
      }
    }

    const adminToken = await getFirebaseAdminToken();
    const authQuery = adminToken ? `?auth=${encodeURIComponent(adminToken)}` : '';

    // Check RTDB for duplicate
    try {
      const checkRes = await fetch(`${RTDB_URL}/events/seller_applications.json${authQuery}`);
      if (checkRes.ok) {
        const existingApps = await checkRes.json();
        if (existingApps && typeof existingApps === 'object') {
          for (const [key, app] of Object.entries(existingApps)) {
            if (app && String(app.email || '').toLowerCase() === email) {
              if (app.status === 'pending') {
                return res.status(400).json({
                  error: 'You already have a pending seller application under review. Please wait for admin approval.',
                  status: 'pending',
                });
              } else if (app.status === 'approved') {
                return res.status(400).json({
                  error: 'Your seller account has already been approved! Please log in at the Seller Hub.',
                  status: 'approved',
                });
              }
            }
          }
        }
      }
    } catch (_) {}

    const idSuffix = crypto.randomBytes(4).toString('hex');
    const applicationId = `app_${Date.now().toString(36)}_${idSuffix}`;

    const applicationRecord = {
      id: applicationId,
      applicantName,
      email,
      storeName,
      telegram,
      category,
      portfolioLink,
      reason,
      status: 'pending',
      createdAt: Date.now(),
      clientIp: getClientIp(req),
    };

    // 1. Save to in-memory store immediately (capped to prevent heap exhaustion)
    SELLER_MEMORY_STORE.applications.set(applicationId, applicationRecord);
    if (SELLER_MEMORY_STORE.applications.size > 500) {
      const firstKey = SELLER_MEMORY_STORE.applications.keys().next().value;
      if (firstKey) SELLER_MEMORY_STORE.applications.delete(firstKey);
    }

    // Record rate limit timestamp
    ipHistory.push(now);
    applyIpRateLimitMap.set(clientIp, ipHistory);

    // 2. Persist to RTDB in background
    try {
      await fetch(`${RTDB_URL}/events/seller_applications/${encodeURIComponent(applicationId)}.json${authQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(applicationRecord),
      });

      if (adminToken) {
        fetch(`${RTDB_URL}/seller_applications/${encodeURIComponent(applicationId)}.json${authQuery}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(applicationRecord),
        }).catch(() => {});
      }
    } catch (dbErr) {
      console.warn('RTDB background sync notice:', dbErr.message);
    }

    return res.status(200).json({
      success: true,
      applicationId,
      message: 'Your seller application has been submitted successfully! JaiGram admin will review your profile.',
    });
  } catch (err) {
    console.error('Unexpected error in /api/seller/apply:', err);
    return res.status(500).json({ error: err.message || 'Server error processing application.' });
  }
}
