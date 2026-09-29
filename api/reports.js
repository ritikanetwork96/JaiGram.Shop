import { handleCors, getFirebaseAdminToken, verifyAdminRequest, getClientIp } from './_utils.js';

const RTDB_URL = 'https://linkadda-cd1da-default-rtdb.firebaseio.com';

const reportRateLimitMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60000;
  let history = (reportRateLimitMap.get(ip) || []).filter(ts => now - ts < windowMs);
  if (history.length >= 6) return true;
  history.push(now);
  reportRateLimitMap.set(ip, history);
  if (reportRateLimitMap.size > 2000) {
    for (const [k, arr] of reportRateLimitMap.entries()) {
      if (!arr.length || now - arr[arr.length - 1] > windowMs) reportRateLimitMap.delete(k);
    }
  }
  return false;
}

export default async function handler(req, res) {
  if (handleCors(req, res, 'GET, POST, PATCH, DELETE, OPTIONS')) return;

  // ━━ 1. SUBMIT NEW REPORT (PUBLIC ACCESS WITH RATE LIMITING) ━━
  if (req.method === 'POST') {
    const clientIp = getClientIp(req);
    if (isRateLimited(clientIp)) {
      return res.status(429).json({ error: 'Too many report submissions. Please wait a moment before trying again.' });
    }

    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const targetType = String(body.targetType || 'product').toLowerCase().trim();
      const targetId = String(body.targetId || '').trim();
      const targetName = String(body.targetName || body.productName || body.sellerName || 'Untitled Item').trim();
      const reporterName = String(body.reporterName || 'Anonymous User').trim();
      const reporterEmail = String(body.reporterEmail || '').trim().toLowerCase();
      const reason = String(body.reason || 'Other').trim();
      const details = String(body.details || '').trim();

      if (!targetId && !targetName) {
        return res.status(400).json({ error: 'Target product or seller information is required.' });
      }

      if (!reason) {
        return res.status(400).json({ error: 'A valid reason must be selected.' });
      }

      const reportId = `rep_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
      const now = Date.now();

      const reportRecord = {
        id: reportId,
        targetType: targetType === 'seller' ? 'seller' : 'product',
        targetId,
        targetName,
        reporterName: reporterName || 'Guest User',
        reporterEmail: reporterEmail || 'N/A',
        reporterUid: String(body.reporterUid || body.uid || '').trim(),
        reporterIp: clientIp,
        reason,
        details: details || 'No additional details provided.',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };

      const adminToken = await getFirebaseAdminToken();
      const authQuery = adminToken ? `?auth=${encodeURIComponent(adminToken)}` : '';

      const saveRes = await fetch(`${RTDB_URL}/reports/${encodeURIComponent(reportId)}.json${authQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportRecord),
        signal: AbortSignal.timeout(10000),
      });

      if (!saveRes.ok) {
        throw new Error(`Failed to save report to database: ${saveRes.status}`);
      }

      return res.status(200).json({
        success: true,
        reportId,
        report: reportRecord,
        message: 'Your report has been submitted to the LinkAdda Trust & Safety admin team for priority review.',
      });
    } catch (err) {
      console.error('Report submission error:', err);
      return res.status(500).json({ error: 'Failed to submit report. Please try again or contact Telegram VIP support.' });
    }
  }

  // Helper to extract query params safely
  const query = (() => {
    if (req.query && typeof req.query === 'object') return req.query;
    try {
      const url = new URL(req.url || '', 'http://localhost');
      return Object.fromEntries(url.searchParams.entries());
    } catch (_) {
      return {};
    }
  })();

  const reporterUid = String(query.reporterUid || query.uid || '').trim();
  const reporterEmail = String(query.reporterEmail || query.email || '').toLowerCase().trim();
  const isAdmin = await verifyAdminRequest(req);

  // ━━ 2. GET REPORTS (ADMIN OR CURRENT REPORTER) ━━
  if (req.method === 'GET') {
    if (!isAdmin && !reporterUid && !reporterEmail) {
      return res.status(401).json({ error: 'Unauthorized: Master administrator credentials or reporter verification required.' });
    }

    const adminToken = await getFirebaseAdminToken();
    const authQuery = adminToken ? `?auth=${encodeURIComponent(adminToken)}` : '';

    try {
      const getRes = await fetch(`${RTDB_URL}/reports.json${authQuery}`, {
        signal: AbortSignal.timeout(12000),
      });

      if (!getRes.ok) {
        throw new Error(`Database error: ${getRes.status}`);
      }

      const data = await getRes.json();
      let reports = [];
      if (data && typeof data === 'object') {
        for (const [key, val] of Object.entries(data)) {
          if (val && typeof val === 'object') {
            reports.push({
              id: key,
              ...val,
            });
          }
        }
      }

      // If caller is NOT master admin, strictly filter for only this reporter's submitted reports!
      if (!isAdmin) {
        reports = reports.filter(r => 
          (reporterUid && r.reporterUid === reporterUid) || 
          (reporterEmail && String(r.reporterEmail || '').toLowerCase() === reporterEmail)
        );
      }

      // Sort newest first
      reports.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

      return res.status(200).json({
        success: true,
        reports,
        total: reports.length,
        pending: reports.filter(r => r.status === 'pending').length,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load reports from database.' });
    }
  }

  // ━━ MASTER ADMIN AUTHENTICATION REQUIRED FOR MANAGEMENT ━━
  if (!isAdmin) {
    return res.status(401).json({ error: 'Unauthorized: Master administrator authentication required.' });
  }

  const adminToken = await getFirebaseAdminToken();
  const authQuery = adminToken ? `?auth=${encodeURIComponent(adminToken)}` : '';

  // ━━ 3. UPDATE REPORT STATUS (ADMIN ONLY) ━━
  if (req.method === 'PATCH') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const reportId = String(body.reportId || '').trim();
      const status = String(body.status || 'resolved').toLowerCase().trim();
      const adminNotes = String(body.adminNotes || '').trim();

      if (!reportId) {
        return res.status(400).json({ error: 'reportId is required.' });
      }

      const updates = {
        status,
        updatedAt: Date.now(),
      };
      if (adminNotes) updates.adminNotes = adminNotes;

      const patchRes = await fetch(`${RTDB_URL}/reports/${encodeURIComponent(reportId)}.json${authQuery}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        signal: AbortSignal.timeout(8000),
      });

      if (!patchRes.ok) {
        throw new Error(`Database patch error: ${patchRes.status}`);
      }

      return res.status(200).json({
        success: true,
        reportId,
        status,
        message: `Report marked as ${status}.`,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update report status.' });
    }
  }

  // ━━ 4. DELETE REPORT (ADMIN ONLY) ━━
  if (req.method === 'DELETE') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const queryId = req.query?.reportId || body.reportId;
      const reportId = String(queryId || '').trim();

      if (!reportId) {
        return res.status(400).json({ error: 'reportId is required.' });
      }

      const delRes = await fetch(`${RTDB_URL}/reports/${encodeURIComponent(reportId)}.json${authQuery}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(8000),
      });

      if (!delRes.ok) {
        throw new Error(`Database delete error: ${delRes.status}`);
      }

      return res.status(200).json({
        success: true,
        reportId,
        message: 'Report deleted successfully.',
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to delete report.' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
