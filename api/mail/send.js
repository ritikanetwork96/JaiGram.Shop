import { handleCors, verifyAdminRequest } from '../_utils.js';

export default async function handler(req, res) {
  if (handleCors(req, res, 'POST, OPTIONS')) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const isAuthorized = await verifyAdminRequest(req);
    if (!isAuthorized) {
      return res.status(401).json({ error: 'Unauthorized: Master administrator authentication required.' });
    }

    const apiKey = (process.env.BREVO_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(500).json({ error: 'Brevo API key is not configured on the server.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const to = body.to;
    const subject = String(body.subject || '').trim();
    const htmlContent = String(body.htmlContent || '').trim();

    if (!to || !subject || !htmlContent) {
      return res.status(400).json({ error: 'Missing to, subject, or htmlContent in payload.' });
    }

    const senderEmail = (process.env.BREVO_SENDER_EMAIL || 'ritikanetwork96@gmail.com').trim();
    const senderName = (process.env.BREVO_SENDER_NAME || 'JaiGram Shop').trim();

    const brevoPayload = {
      sender: body.sender || { name: senderName, email: senderEmail },
      to: Array.isArray(to) ? to : [{ email: String(to).trim() }],
      subject,
      htmlContent,
    };

    const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(brevoPayload),
    });

    if (!brevoRes.ok) {
      const errText = await brevoRes.text();
      console.warn('Brevo server dispatch notice:', brevoRes.status, errText);
      return res.status(brevoRes.status || 502).json({ error: 'Failed to send email via Brevo.', details: errText });
    }

    const data = await brevoRes.json().catch(() => ({}));
    return res.status(200).json({ success: true, message: 'Email dispatched successfully.', data });
  } catch (err) {
    console.error('Error in /api/mail/send:', err);
    return res.status(500).json({ error: err.message || 'Internal server error dispatching email.' });
  }
}
