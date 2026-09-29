import crypto from 'node:crypto';
import { getAuthSecret, isValidEmail, getClientIp, handleCors } from '../_utils.js';

// In-memory rate limiting map: email -> timestamp of last request
const otpCooldownMap = globalThis.__LINKADDA_OTP_COOLDOWN || (globalThis.__LINKADDA_OTP_COOLDOWN = new Map());
const COOLDOWN_SECONDS = 60;

// Shared IP rate limiting across warm serverless executions
const ipRateLimitMap = globalThis.__LINKADDA_IP_LIMIT || (globalThis.__LINKADDA_IP_LIMIT = new Map());
const IP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_PER_IP = 6; // Max 6 OTP requests per 10 mins per IP

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

export function renderLuxuryEmailHtml(otp, userEmail) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your JaiGram Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #07060c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #07060c; padding: 40px 15px;">
    <tr>
      <td align="center">
        <!-- Container Card -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background: linear-gradient(165deg, #161226 0%, #0d0b17 100%); border-radius: 24px; border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 25px 60px rgba(0,0,0,0.7), 0 0 40px rgba(255, 42, 141, 0.15); overflow: hidden;">
          
          <!-- Brand Header -->
          <tr>
            <td style="padding: 36px 32px 24px; text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); background: rgba(255, 255, 255, 0.02);">
              <div style="font-size: 26px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">
                JaiGram <span style="color: #ff2a8d; font-size: 26px; margin: 0 4px;">&#9819;</span> <span style="background: linear-gradient(135deg, #ff2a8d 0%, #ff7bb0 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Shop</span>
              </div>
              <div style="margin-top: 6px; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #94a3b8; font-weight: 700;">
                Authentic Premium Marketplace
              </div>
            </td>
          </tr>

          <!-- Main Content Body -->
          <tr>
            <td style="padding: 40px 32px 30px; text-align: center;">
              <div style="display: inline-block; padding: 6px 16px; border-radius: 9999px; background: rgba(255, 42, 141, 0.12); border: 1px solid rgba(255, 42, 141, 0.3); color: #ff65a3; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 18px;">
                &#128274; One-Time Verification Code
              </div>

              <h1 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px;">
                Sign in to your account
              </h1>
              
              <p style="margin: 0 0 28px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                Use this single-use 6-digit code to securely authenticate for <strong style="color: #ffffff;">${userEmail}</strong>.
              </p>

              <!-- Prominent OTP Box -->
              <div style="margin: 10px auto 26px; max-width: 320px; padding: 20px 24px; background: linear-gradient(135deg, rgba(255, 42, 141, 0.16) 0%, rgba(225, 29, 72, 0.08) 100%); border: 2px solid #ff2a8d; border-radius: 18px; box-shadow: 0 10px 35px rgba(255, 42, 141, 0.3);">
                <span style="font-size: 40px; font-weight: 800; letter-spacing: 10px; color: #ffffff; font-family: 'Courier New', Courier, monospace; display: block; margin-left: 10px;">${otp}</span>
              </div>

              <!-- Expiry Alert -->
              <p style="margin: 0; font-size: 13px; color: #fb7185; font-weight: 600;">
                &#9201; Code expires in <strong>5 minutes</strong>.
              </p>
            </td>
          </tr>

          <!-- Security Advisory Box -->
          <tr>
            <td style="padding: 20px 32px; background: rgba(255, 255, 255, 0.03); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: left;">
              <p style="margin: 0; font-size: 12px; line-height: 1.6; color: #94a3b8;">
                <strong style="color: #cbd5e1;">Security Notice:</strong> JaiGram staff will never ask you for this verification code. If you didn't attempt to sign in, please ignore this email.
              </p>
            </td>
          </tr>

          <!-- Official Footer -->
          <tr>
            <td style="padding: 24px 32px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.04);">
              <p style="margin: 0; font-size: 12px; color: #64748b;">
                &copy; ${new Date().getFullYear()} JaiGram Shop &bull; <a href="https://jaigram.shop" style="color: #ff2a8d; text-decoration: none; font-weight: 600;">jaigram.shop</a>
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
  // CORS configuration
  if (handleCors(req, res, 'POST, OPTIONS')) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    const now = Date.now();
    const lastSent = otpCooldownMap.get(email);
    if (lastSent && (now - lastSent) < COOLDOWN_SECONDS * 1000) {
      const remainingSec = Math.ceil((COOLDOWN_SECONDS * 1000 - (now - lastSent)) / 1000);
      return res.status(429).json({
        error: `Please wait ${remainingSec}s before requesting another verification code.`,
        retryAfter: remainingSec,
      });
    }

    const clientIp = getClientIp(req);
    let ipHistory = (ipRateLimitMap.get(clientIp) || []).filter(ts => now - ts < IP_WINDOW_MS);
    if (ipHistory.length >= MAX_OTP_PER_IP) {
      return res.status(429).json({
        error: 'Too many verification code requests from this network. Please try again in 10 minutes.',
        retryAfter: 600,
      });
    }

    const apiKey = (process.env.BREVO_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(500).json({ error: 'Brevo API key is not configured on the server.' });
    }

    const senderEmail = (process.env.BREVO_SENDER_EMAIL || 'ritikanetwork96@gmail.com').trim();
    const senderName = (process.env.BREVO_SENDER_NAME || 'JaiGram Shop').trim();

    // Generate 6-digit OTP and signed token (valid for 5 minutes)
    const otp = generateOtp();
    const expires = Date.now() + 5 * 60 * 1000;
    const secret = getAuthSecret();
    const hashData = `${email}:${otp}:${expires}`;
    const signature = crypto.createHmac('sha256', secret).update(hashData).digest('hex');
    const token = `${expires}.${signature}`;

    // Send email via Brevo REST API
    const brevoPayload = {
      sender: {
        name: senderName,
        email: senderEmail,
      },
      to: [
        {
          email: email,
        },
      ],
      subject: `${otp} is your JaiGram verification code`,
      htmlContent: renderLuxuryEmailHtml(otp, email),
    };

    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(brevoPayload),
    });

    if (!brevoResponse.ok) {
      const errorText = await brevoResponse.text();
      console.error('Brevo API dispatch failed:', brevoResponse.status, errorText);
      return res.status(502).json({
        error: 'Failed to dispatch verification email. Please ensure your sender email is verified in Brevo.',
        details: errorText,
      });
    }

    // Record rate limit timestamp
    otpCooldownMap.set(email, now);
    ipHistory.push(now);
    ipRateLimitMap.set(clientIp, ipHistory);
    if (otpCooldownMap.size > 2000) {
      for (const [k, ts] of otpCooldownMap.entries()) {
        if (now - ts > 300000) otpCooldownMap.delete(k);
      }
    }
    if (ipRateLimitMap.size > 2000) {
      for (const [k, arr] of ipRateLimitMap.entries()) {
        if (!arr.length || now - arr[arr.length - 1] > IP_WINDOW_MS) ipRateLimitMap.delete(k);
      }
    }

    return res.status(200).json({
      success: true,
      email,
      token,
      expires,
      message: `A 6-digit code has been sent to ${email}.`,
    });
  } catch (err) {
    console.error('Unexpected error in /api/auth/send-otp:', err);
    return res.status(500).json({
      error: err?.message || 'Internal server error processing OTP request.',
    });
  }
}
