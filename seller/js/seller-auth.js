// seller/js/seller-auth.js
// Handles JaiGram Seller Session, Authentication, Remember Me & Forgot Password

const SELLER_SESSION_KEY = 'jaigram_seller_session';
const LEGACY_SELLER_SESSION_KEY = 'linkadda_seller_session';
const SELLER_REMEMBER_KEY = 'jaigram_seller_remember';
const LEGACY_SELLER_REMEMBER_KEY = 'linkadda_seller_remember';

export function getSellerSession() {
  try {
    const raw = localStorage.getItem(SELLER_SESSION_KEY) || localStorage.getItem(LEGACY_SELLER_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.token || !session.seller || !session.seller.id) {
      return null;
    }
    return session;
  } catch (_) {
    return null;
  }
}

export function setSellerSession(sessionData) {
  try {
    const str = JSON.stringify(sessionData);
    localStorage.setItem(SELLER_SESSION_KEY, str);
    localStorage.setItem(LEGACY_SELLER_SESSION_KEY, str);
  } catch (err) {
    console.warn('Failed to save seller session in localStorage:', err);
  }
}

export function clearSellerSession() {
  try {
    localStorage.removeItem(SELLER_SESSION_KEY);
    localStorage.removeItem(LEGACY_SELLER_SESSION_KEY);
  } catch (_) {}
}

export function getRememberedEmail() {
  try {
    return localStorage.getItem(SELLER_REMEMBER_KEY) || localStorage.getItem(LEGACY_SELLER_REMEMBER_KEY) || '';
  } catch (_) {
    return '';
  }
}

export function setRememberedEmail(email, remember = true) {
  try {
    if (remember && email) {
      const val = String(email).trim().toLowerCase();
      localStorage.setItem(SELLER_REMEMBER_KEY, val);
      localStorage.setItem(LEGACY_SELLER_REMEMBER_KEY, val);
    } else {
      localStorage.removeItem(SELLER_REMEMBER_KEY);
      localStorage.removeItem(LEGACY_SELLER_REMEMBER_KEY);
    }
  } catch (_) {}
}

/**
 * Returns candidate endpoints for seller API calls.
 * If running locally on a non-backend port (e.g. VS Code Live Server on 5500),
 * uses http://localhost:8899 as primary candidate to avoid Live Server 405 Method Not Allowed!
 */
export function getApiCandidates(path) {
  if (typeof window !== 'undefined' && window.location) {
    const { hostname, port } = window.location;
    // When on localhost or 127.0.0.1 on a port other than 8899 (e.g. 5500 Live Server)
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && port !== '8899') {
      return [`http://localhost:8899${path}`, path];
    }
  }
  return [path];
}

export function getApiUrl(path) {
  return getApiCandidates(path)[0];
}

/**
 * Safe API request dispatcher that tries candidate URLs, bypasses static server 404/405 errors,
 * and never throws JSON parse syntax errors.
 */
async function callSellerAuthApi(payload) {
  const endpoints = getApiCandidates('/api/seller/auth');
  let lastError = null;

  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[i];
    const isLast = i === endpoints.length - 1;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const rawText = await res.text();
      let data = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch (_) {}

      // If response is HTML (static server 404/405) and we have more candidates, try next
      if (rawText.trim().startsWith('<') && !isLast) {
        continue;
      }

      // If Live Server 405 or 404, try next candidate
      if ((res.status === 405 || res.status === 404) && !isLast) {
        continue;
      }

      if (res.ok && data) {
        return data;
      }

      // If server returned a business error (e.g. wrong password or account not found)
      if (data && data.error) {
        throw new Error(data.error);
      }

      throw new Error(data?.error || `Server request failed (Status ${res.status}).`);
    } catch (err) {
      // If it's a real business error from server, rethrow immediately
      if (err.message && !err.message.includes('Failed to fetch') && !err.message.includes('Status 404') && !err.message.includes('Status 405')) {
        throw err;
      }
      lastError = err;
    }
  }

  if (lastError && lastError.message && !lastError.message.includes('Failed to fetch')) {
    throw lastError;
  }

  throw new Error('Could not connect to backend server. Please ensure the local server is running at http://localhost:8899.');
}

export async function loginSeller(email, password, remember = false) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '').trim();

  if (!cleanEmail) {
    throw new Error('Please enter your registered partner email.');
  }
  if (!cleanPassword) {
    throw new Error('Please enter your password.');
  }

  const data = await callSellerAuthApi({
    action: 'login',
    email: cleanEmail,
    password: cleanPassword,
  });

  if (!data || !data.token || !data.seller) {
    throw new Error(data?.error || 'Login failed. Invalid credentials.');
  }

  setSellerSession(data);
  setRememberedEmail(cleanEmail, remember);
  return data;
}

export async function requestPasswordReset(email) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error('Please enter your registered partner email.');
  }

  return await callSellerAuthApi({
    action: 'forgot_password_request',
    email: cleanEmail,
  });
}

export async function verifyPasswordReset(email, otp, newPassword) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanOtp = String(otp || '').trim();
  const cleanNewPass = String(newPassword || '').trim();

  if (!cleanEmail) throw new Error('Email is required.');
  if (!cleanOtp) throw new Error('Verification code is required.');
  if (!cleanNewPass || cleanNewPass.length < 6) throw new Error('New password must be at least 6 characters long.');

  return await callSellerAuthApi({
    action: 'forgot_password_verify',
    email: cleanEmail,
    otp: cleanOtp,
    newPassword: cleanNewPass,
  });
}

export async function changeSellerPassword(oldPassword, newPassword) {
  const session = getSellerSession();
  if (!session || !session.token || !session.seller) {
    throw new Error('You must be logged in to change your password.');
  }

  const data = await callSellerAuthApi({
    action: 'change_password',
    sellerId: session.seller.id,
    token: session.token,
    oldPassword: String(oldPassword || '').trim(),
    newPassword: String(newPassword || '').trim(),
  });

  if (!data || !data.success) {
    throw new Error(data?.error || 'Password update failed.');
  }

  // Update local session flag
  session.seller.mustChangePassword = false;
  setSellerSession(session);
  return data;
}

export async function updateSellerProfile(profileData) {
  const session = getSellerSession();
  if (!session || !session.token || !session.seller) {
    throw new Error('You must be logged in to update your profile.');
  }

  const data = await callSellerAuthApi({
    action: 'update_profile',
    sellerId: session.seller.id,
    token: session.token,
    ...profileData,
  });

  if (!data || !data.success) {
    throw new Error(data?.error || 'Failed to update profile.');
  }

  if (data.seller) {
    session.seller = { ...session.seller, ...data.seller };
    setSellerSession(session);
  }

  return data;
}

export async function validateSellerSession() {
  const session = getSellerSession();
  if (!session || !session.token || !session.seller) return null;

  try {
    const data = await callSellerAuthApi({
      action: 'get_session',
      sellerId: session.seller.id,
      token: session.token,
    });

    if (data && data.valid && data.seller) {
      session.seller = data.seller;
      setSellerSession(session);
      return session;
    } else {
      clearSellerSession();
      return null;
    }
  } catch (_) {
    return session;
  }
}

export function logoutSeller() {
  clearSellerSession();
  window.location.href = '/seller/login';
}

export async function requireSellerAuth() {
  const session = getSellerSession();
  if (!session || !session.token || !session.seller) {
    window.location.href = '/seller/login?redirect=' + encodeURIComponent(window.location.pathname);
    return null;
  }

  const validSession = await validateSellerSession();
  if (!validSession) {
    window.location.href = '/seller/login?expired=true&redirect=' + encodeURIComponent(window.location.pathname);
    return null;
  }

  return validSession;
}
