/**
 * LinkAdda Official Secure Payment Gateway (Authentic Razorpay Modal Replica)
 * - Desktop: Pure Centered Modal Popup with Royal Blue Brand Sidebar (Image 3 from User)
 * - Left Pane: White Price Summary card, White User Pill, 3D Isometric Coins & Card Graphic
 * - Right Pane: Methods Navigation Rail + Method Details + Solid Obsidian "Continue" Button
 * - Permanent Scrollbar Elimination: Zero clunky native Windows grey scrollbars
 * - Mobile: Direct fluid full-screen checkout flow with locked amount UPI app launcher
 * - Strictly NO adult keywords in UPI notes or package titles
 * - Zero Razorpay branding (100% LinkAdda Secure Pay)
 */

(function() {
  'use strict';

  const isLocalEnv = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:';
  const API_BASE = isLocalEnv ? 'https://jaigram.shop' : '';

  // Ensure QRCode script is loaded
  function loadQrCodeLibrary(callback) {
    if (typeof window.QRCode === 'function') {
      if (typeof callback === 'function') callback();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    script.onload = () => { if (typeof callback === 'function') callback(); };
    script.onerror = () => { if (typeof callback === 'function') callback(); };
    document.head.appendChild(script);
  }

  // Ensure Confetti library is loaded
  function loadConfettiLibrary(callback) {
    if (typeof window.confetti === 'function') {
      if (typeof callback === 'function') callback();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js';
    script.onload = () => { if (typeof callback === 'function') callback(); };
    script.onerror = () => { if (typeof callback === 'function') callback(); };
    document.head.appendChild(script);
  }

  // Ensure Gateway CSS stylesheet is loaded dynamically
  function loadGatewayStylesheet() {
    if (document.getElementById('linkaddaGatewayCss')) return;
    const existing = document.querySelector('link[href*="payment-gateway.css"]');
    if (existing) return;

    let cssHref = '../shared/payment-gateway.css';
    const scripts = document.querySelectorAll('script[src*="payment-gateway.js"]');
    if (scripts.length > 0) {
      const src = scripts[scripts.length - 1].getAttribute('src');
      if (src) cssHref = src.replace('payment-gateway.js', 'payment-gateway.css');
    }

    const link = document.createElement('link');
    link.id = 'linkaddaGatewayCss';
    link.rel = 'stylesheet';
    link.href = cssHref;
    document.head.appendChild(link);
  }

  loadGatewayStylesheet();
  loadQrCodeLibrary();
  loadConfettiLibrary();

  // Baseline Default Configuration
  const DEFAULT_CONFIG = {
    upiId: 'Ritikane@ptyes',
    bep20Address: '0x7186b11f8fD49fe472Af49Cda490f168e09Fef0a',
    ethAddress: '0x7186b11f8fD49fe472Af49Cda490f168e09Fef0a',
    binanceId: '1197561104',
    binanceGiftCardId: '969887942',
    paypalLink: 'https://paypal.me/Jayagupta601',
    telegramUrl: 'https://t.me/TRUSTED_BROTHER1234',
    recommendedMethod: 'upi',
    customMethods: {
      custom_bank: {
        id: 'custom_bank',
        name: 'Bank Transfer (IMPS / NEFT)',
        sub: 'Direct Account Transfer',
        tag: '₹ INR',
        accountNumber: '45231994969',
        ifsc: 'SBIN0002594',
        accountName: 'Pandit Bajpai',
        bankName: 'State Bank of India',
        upiId: 'PanditBajpai@sbi',
        instructions: 'Transfer to State Bank of India account. Instant processing.',
        status: 'active'
      },
      custom_btc: {
        id: 'custom_btc',
        name: 'Bitcoin (BTC)',
        sub: 'BTC Native Network',
        tag: 'CRYPTO',
        identifier: 'bc1q3vuldn6dz4jv5896gap27ngrtg7q4p6krtk9hu',
        instructions: 'Send exact BTC amount to address above on Bitcoin mainnet.',
        status: 'active'
      }
    }
  };

  // State
  let currentOrder = null;
  let activeMethodId = 'upi'; // Instant UPI payment default
  let activeUpiMode = 'apps'; // 'apps' | 'qr'
  let timerInterval = null;
  let remainingSecs = 900;
  let screenshotBase64 = null;
  let _uploadedScreenshotPromise = null;
  let _uploadedScreenshotUrl = '';
  let gatewayConfig = { ...DEFAULT_CONFIG };

  function parseMoney(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const cleaned = String(val).replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  // Strict Sanitizer: Ensures ZERO adult, explicit or suggestive names appear on gateway or bank statement
  function sanitizeProductTitle(rawTitle) {
    if (!rawTitle || typeof rawTitle !== 'string') return 'VIP Digital Media Pass';
    const lower = rawTitle.toLowerCase();
    if (lower.includes('wallet recharge') || lower.includes('wallet topup') || lower.includes('wallet top-up') || lower.includes('add money')) {
      return rawTitle.trim();
    }
    const adultTerms = [
      'desi', 'mal', 'maal', 'mom', 'son', 'bhabhi', 'aunty', 'mms', 'sex', 
      'sexy', 'hot', 'nude', 'nudes', 'porn', 'xxx', 'adult', 'nsfw', 'leak', 
      'leaked', 'viral', 'private', 'scandal', 'chut', 'randi', 'girl', 'babe', 
      'erotic', 'strip', 'boob', 'boobs', 'clip', 'video'
    ];
    const isSensitive = adultTerms.some(term => {
      const regex = new RegExp('\\b' + term + '\\b', 'i');
      return regex.test(lower) || lower.includes(term);
    });

    if (isSensitive) {
      return 'VIP Digital Media Pass';
    }
    const clean = rawTitle.trim();
    return clean.length > 28 ? clean.substring(0, 26) + '...' : clean;
  }

  function getCustomerSession() {
    try {
      const raw = localStorage.getItem('jaigram_customer_session') || localStorage.getItem('linkadda_customer_session');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function getCustomerWalletBalance() {
    const cust = getCustomerSession();
    if (!cust) return 0;
    const uid = cust.uid || cust.email || '';
    const saved = localStorage.getItem('jaigram_wallet_' + uid) || localStorage.getItem('linkadda_wallet_' + uid);
    if (saved !== null) {
      const num = parseFloat(saved);
      return (!isNaN(num) && num > 0) ? num : 0;
    }
    return cust.walletBalance ? parseFloat(cust.walletBalance) : 0;
  }

  function refreshGatewayConfig() {
    try {
      const cachedPayment = localStorage.getItem('linkadda_payment_payment');
      if (cachedPayment) mergeConfigData(JSON.parse(cachedPayment));
      const cachedConfig = localStorage.getItem('linkadda_payment_config');
      if (cachedConfig) mergeConfigData(JSON.parse(cachedConfig));
      if (window.__paymentPayment) mergeConfigData(window.__paymentPayment);
    } catch (_) {}

    try {
      if (window.__linkaddaDb && typeof window._fbRef === 'function' && typeof window._fbGet === 'function') {
        window._fbGet(window._fbRef(window.__linkaddaDb, 'payment')).then((snap) => {
          if (snap && snap.exists()) {
            mergeConfigData(snap.val());
            renderMethodRail();
            renderActiveMethodDetails();
          }
        }).catch(() => {});
      }
    } catch (_) {}
  }

  function mergeConfigData(data) {
    if (!data || typeof data !== 'object') return;
    if (data.upiId) gatewayConfig.upiId = data.upiId;
    if (data.merchantName) gatewayConfig.merchantName = data.merchantName;
    if (data.binanceId) gatewayConfig.binanceId = data.binanceId;
    if (data.bep20Address) gatewayConfig.bep20Address = data.bep20Address;
    if (data.ethAddress) gatewayConfig.ethAddress = data.ethAddress;
    if (data.paypalLink) gatewayConfig.paypalLink = data.paypalLink;
    if (data.telegramUrl) gatewayConfig.telegramUrl = data.telegramUrl;
    if (data.recommendedMethod) gatewayConfig.recommendedMethod = data.recommendedMethod;
    if (data.recommendationBadge) gatewayConfig.recommendationBadge = data.recommendationBadge;

    if (data.upiTitle || data.upiName) gatewayConfig.upiTitle = data.upiTitle || data.upiName;
    if (data.upiSub) gatewayConfig.upiSub = data.upiSub;
    if (data.upiLogo) gatewayConfig.upiLogo = data.upiLogo;

    if (data.binanceTitle || data.binancepayName) gatewayConfig.binanceTitle = data.binanceTitle || data.binancepayName;
    if (data.binanceSub || data.binancepaySub) gatewayConfig.binanceSub = data.binanceSub || data.binancepaySub;
    if (data.binanceLogo) gatewayConfig.binanceLogo = data.binanceLogo;

    if (data.cardsTitle || data.cardsName) gatewayConfig.cardsTitle = data.cardsTitle || data.cardsName;
    if (data.cardsSub) gatewayConfig.cardsSub = data.cardsSub;
    if (data.cardsLogo) gatewayConfig.cardsLogo = data.cardsLogo;

    if (data.netbankingTitle || data.netbankingName) gatewayConfig.netbankingTitle = data.netbankingTitle || data.netbankingName;
    if (data.netbankingSub) gatewayConfig.netbankingSub = data.netbankingSub;
    if (data.netbankingLogo) gatewayConfig.netbankingLogo = data.netbankingLogo;

    if (data.walletTitle || data.walletName) gatewayConfig.walletTitle = data.walletTitle || data.walletName;
    if (data.walletSub) gatewayConfig.walletSub = data.walletSub;

    if (data.bankTitle) gatewayConfig.bankTitle = data.bankTitle;
    if (data.bankSub) gatewayConfig.bankSub = data.bankSub;
    if (data.bankLogo) gatewayConfig.bankLogo = data.bankLogo;

    if (data.btcTitle) gatewayConfig.btcTitle = data.btcTitle;
    if (data.btcSub) gatewayConfig.btcSub = data.btcSub;
    if (data.btcLogo) gatewayConfig.btcLogo = data.btcLogo;

    if (data.btcAddress) gatewayConfig.btcAddress = data.btcAddress;
    if (data.btcQr) gatewayConfig.btcQr = data.btcQr;
    if (data.bankQr) gatewayConfig.bankQr = data.bankQr;

    if (data.customMethods && typeof data.customMethods === 'object') {
      Object.entries(data.customMethods).forEach(([cId, cVal]) => {
        if (!cVal || typeof cVal !== 'object') return;
        const prev = gatewayConfig.customMethods[cId] || {};
        gatewayConfig.customMethods[cId] = {
          ...prev,
          ...cVal,
          identifier: cVal.identifier || cVal.address || cVal.walletAddress || cVal.accountNumber || '',
          qrImage: cVal.qrImage || cVal.insideImage || '',
          insideImage: cVal.insideImage || cVal.qrImage || '',
        };
      });
    }
    if (data.disabledMethods && Array.isArray(data.disabledMethods)) {
      gatewayConfig.disabledMethods = data.disabledMethods;
    }
  }

  function createModalDOM() {
    if (document.getElementById('linkaddaGatewayBackdrop')) return;

    const backdrop = document.createElement('div');
    backdrop.id = 'linkaddaGatewayBackdrop';
    backdrop.className = 'lgw-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;background:rgba(15,23,42,0.65);z-index:9999999;display:none;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);';

    backdrop.innerHTML = `
      <div class="lgw-modal" role="dialog" aria-modal="true" id="linkaddaGatewayModal">
        
        <!-- ━━ LEFT COLUMN: BRAND SIDEBAR (DESKTOP - EXACT IMAGE 3 REPLICA) ━━ -->
        <div class="lgw-left-pane">
          <div class="lgw-left-top">
            <div class="lgw-left-brand">
              <div class="lgw-left-avatar">JG</div>
              <div class="lgw-left-merchant">JaiGram Shop</div>
            </div>

            <!-- Price Summary Floating White Card (Exact Image 3) -->
            <div class="lgw-price-card">
              <div class="lgw-price-card-label">Price Summary</div>
              <div class="lgw-price-card-row">
                <div class="lgw-price-card-amount" id="lgwSidebarAmount">₹0.00</div>
                <div class="lgw-price-card-sub" id="lgwSidebarSubTag">+Fee</div>
              </div>
            </div>

            <!-- User Info Floating White Pill (Exact Image 3) -->
            <div class="lgw-user-pill" title="Current session user">
              <div class="lgw-user-pill-left">
                <i class="fa-regular fa-user"></i>
                <span id="lgwUserEmailPill">Using as Customer</span>
              </div>
              <i class="fa-solid fa-chevron-right"></i>
            </div>
          </div>

          <!-- Bottom 3D Isometric Coins & Card Graphic (Exact Image 3) -->
          <div class="lgw-left-bottom">
            <div class="lgw-left-graphic">
              <svg width="220" height="96" viewBox="0 0 220 96" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="coinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#bfdbfe" />
                    <stop offset="40%" stop-color="#60a5fa" />
                    <stop offset="100%" stop-color="#1d4ed8" />
                  </linearGradient>
                  <linearGradient id="coinEdge" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#93c5fd" />
                    <stop offset="100%" stop-color="#1e40af" />
                  </linearGradient>
                  <linearGradient id="boxFront" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#3b82f6" />
                    <stop offset="100%" stop-color="#1d4ed8" />
                  </linearGradient>
                  <linearGradient id="boxSide" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#1e40af" />
                    <stop offset="100%" stop-color="#172554" />
                  </linearGradient>
                  <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#93c5fd" />
                    <stop offset="100%" stop-color="#3b82f6" />
                  </linearGradient>
                </defs>
                <!-- Isometric Box 1 (back) -->
                <path d="M125 32L155 16L185 32L155 48Z" fill="url(#boxFront)" opacity="0.65"/>
                <path d="M125 32L155 48V78L125 62Z" fill="url(#boxSide)" opacity="0.6"/>
                <path d="M185 32L155 48V78L185 62Z" fill="url(#boxSide)" opacity="0.85"/>
                <!-- Isometric Box 2 (middle) -->
                <path d="M105 40L135 24L165 40L135 56Z" fill="#60a5fa" opacity="0.75"/>
                <path d="M105 40L135 56V84L105 68Z" fill="#1e40af" opacity="0.7"/>
                <path d="M165 40L135 56V84L165 68Z" fill="#1d4ed8" opacity="0.9"/>
                <!-- 3D Stack of Coins -->
                <path d="M35 70C35 63 53 58 75 58C97 58 115 63 115 70V78C115 85 97 90 75 90C53 90 35 85 35 78V70Z" fill="url(#coinEdge)" />
                <ellipse cx="75" cy="70" rx="40" ry="12" fill="url(#coinGrad)" />
                <path d="M35 62C35 55 53 50 75 50C97 50 115 55 115 62V70C115 77 97 82 75 82C53 82 35 77 35 70V62Z" fill="url(#coinEdge)" />
                <ellipse cx="75" cy="62" rx="40" ry="12" fill="url(#coinGrad)" />
                <path d="M35 54C35 47 53 42 75 42C97 42 115 47 115 54V62C115 69 97 74 75 74C53 74 35 69 35 62V54Z" fill="url(#coinEdge)" />
                <ellipse cx="75" cy="54" rx="40" ry="12" fill="url(#coinGrad)" />
                <path d="M35 46C35 39 53 34 75 34C97 34 115 39 115 46V54C115 61 97 66 75 66C53 66 35 61 35 54V46Z" fill="url(#coinEdge)" />
                <ellipse cx="75" cy="46" rx="40" ry="12" fill="url(#coinGrad)" />
                <ellipse cx="75" cy="46" rx="33" ry="9" stroke="rgba(255,255,255,0.4)" stroke-width="2" fill="none" />
                <!-- Credit Card leaning in front right -->
                <g transform="matrix(0.86 -0.32 0 0.94 138 60)">
                  <rect x="0" y="0" width="58" height="36" rx="4" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>
                  <rect x="7" y="9" width="9" height="7" rx="1.5" fill="#fde047" opacity="0.95"/>
                  <line x1="7" y1="22" x2="34" y2="22" stroke="rgba(255,255,255,0.6)" stroke-width="2" stroke-linecap="round"/>
                  <line x1="7" y1="27" x2="22" y2="27" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"/>
                </g>
              </svg>
            </div>
            <div class="lgw-left-secured">
              <i class="fa-solid fa-lock" style="color:#ffffff;"></i>
              Secured by <span>JaiGram Secure Pay</span>
            </div>
          </div>
        </div>

        <!-- ━━ MOBILE HEADER (SHOWN ONLY ON MOBILE <= 768px) ━━ -->
        <div class="lgw-mobile-header">
          <div class="lgw-mobile-header-left">
            <div class="lgw-mob-avatar">JG</div>
            <div>
              <div class="lgw-mob-name">JaiGram Shop</div>
              <div class="lgw-mob-badge">
                <i class="fa-solid fa-shield-halved" style="color:#4ade80;"></i> Verified Business
              </div>
            </div>
          </div>
          <button type="button" class="lgw-mob-close-btn" onclick="window.LinkAddaGateway.close()" aria-label="Close Checkout">&times;</button>
        </div>

        <!-- Mobile Price Summary Strip -->
        <div class="lgw-mobile-price-strip">
          <div>
            <div class="lgw-mob-item-title" id="lgwMobItemTitle">VIP Digital Media Pass</div>
            <div class="lgw-mob-item-sub"><i class="fa-solid fa-bolt" style="color:#2563eb;"></i> Instant Digital Unlock</div>
          </div>
          <div class="lgw-mob-price-total" id="lgwMobTotalAmt">₹0.00</div>
        </div>

        <!-- ━━ RIGHT COLUMN: PAYMENT OPTIONS & DETAILS ━━ -->
        <div class="lgw-right-pane">
          <!-- Top Navigation Bar inside Modal (Image 3 Replica) -->
          <div class="lgw-right-topbar">
            <div class="lgw-topbar-title">Payment Options</div>
            <div class="lgw-topbar-actions">
              <span class="lgw-topbar-dots" title="Payment Options">&#8942;</span>
              <button type="button" class="lgw-close-btn" id="lgwCloseBtn" aria-label="Close Checkout">&times;</button>
            </div>
          </div>

          <!-- Views Container -->
          <div class="lgw-views-container">

            <!-- VIEW 1: SPLIT CHECKOUT (DEFAULT VIEW ON DESKTOP & MOBILE) -->
            <div class="lgw-view active" id="lgwViewCheckout" style="display:block;">
              <div class="lgw-split-checkout">
                <!-- Left Sub-Rail: Methods Navigation -->
                <div class="lgw-methods-rail" id="lgwMethodsRail">
                  <!-- Dynamically populated -->
                </div>

                <!-- Right Sub-Pane: Active Method Details & Continue Button -->
                <div class="lgw-method-details" id="lgwMethodDetails">
                  <!-- Dynamically populated -->
                </div>
              </div>

              <!-- Mobile Sticky Bottom Bar -->
              <div class="lgw-mobile-sticky-bar">
                <div>
                  <div style="font-size:11px; color:#64748b; font-weight:600;">Total Payable</div>
                  <div style="font-size:17px; font-weight:900; color:#0f172a;" id="lgwMobStickyAmt">₹0.00</div>
                </div>
                <button type="button" class="lgw-btn-continue-solid" onclick="window.LinkAddaGateway.handleContinueClick()">
                  Continue <i class="fa-solid fa-arrow-right"></i>
                </button>
              </div>
            </div>

            <!-- VIEW 2: PROOF UPLOAD SCREEN -->
            <div class="lgw-view" id="lgwViewProof" style="display:none;">
              <div class="lgw-proof-pane">
                <button type="button" class="lgw-back-link" onclick="window.LinkAddaGateway.showView('checkout')">
                  <i class="fa-solid fa-arrow-left"></i> Change Payment Method
                </button>

                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 16px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
                  <div>
                    <div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase;">Selected Method</div>
                    <div style="font-size:13.5px; font-weight:800; color:#0f172a;" id="lgwProofMethodLabel">UPI Instant Pay</div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:11px; color:#64748b; font-weight:700; text-transform:uppercase;">Total Payable</div>
                    <div style="font-size:16px; font-weight:900; color:#0f172a;" id="lgwProofAmountLabel">₹0.00</div>
                  </div>
                </div>

                <div class="lgw-upload-card" id="lgwUploadCard">
                  <input type="file" accept="image/*" id="lgwFileInput" onchange="window.LinkAddaGateway.handleFileInput(event)" />
                  <div class="lgw-upload-icon"><i class="fa-solid fa-cloud-arrow-up"></i></div>
                  <div class="lgw-upload-title" id="lgwUploadTitle">Upload Payment Screenshot</div>
                  <div class="lgw-upload-sub">Tap here to choose confirmation image (PNG, JPG, WEBP)</div>
                </div>

                <div class="lgw-preview-container" id="lgwPreviewContainer">
                  <img id="lgwPreviewImage" class="lgw-preview-image" alt="Screenshot Preview" />
                  <button type="button" class="lgw-preview-del" onclick="window.LinkAddaGateway.removePreview()" title="Remove image">
                    <i class="fa-solid fa-trash-can"></i>
                  </button>
                </div>

                <div class="lgw-form-group">
                  <label class="lgw-form-label" for="lgwUtrInput">
                    <i class="fa-solid fa-hashtag" style="color:#2563eb;"></i> 12-Digit UTR / UPI Reference Number (Optional)
                  </label>
                  <input type="text" id="lgwUtrInput" class="lgw-form-input" placeholder="e.g. 428190384729 or TxHash" maxlength="32" />
                </div>

                <div id="lgwProofAlert" style="display:none; padding:10px 14px; border-radius:8px; background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; font-size:12px; margin-bottom:12px;">
                  <i class="fa-solid fa-circle-exclamation"></i> Please upload your payment confirmation screenshot before continuing.
                </div>

                <button type="button" class="lgw-btn-continue-solid" id="lgwSubmitProofBtn" style="padding:13px;" onclick="window.LinkAddaGateway.submitOrder()">
                  <i class="fa-solid fa-lock"></i> Submit Payment &amp; Unlock Instant Access
                </button>
              </div>
            </div>

            <!-- VIEW 3: SUCCESS CONFIRMATION -->
            <div class="lgw-view" id="lgwViewSuccess" style="display:none;">
              <div class="lgw-success-pane">
                <div class="lgw-success-circle"><i class="fa-solid fa-check"></i></div>
                <div class="lgw-success-heading">Payment Submitted!</div>
                <div class="lgw-success-msg">
                  Your order is recorded securely. Tap below to claim your access immediately on Telegram.
                </div>

                <div class="lgw-success-card">
                  <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed #e2e8f0; font-size:12.5px;">
                    <span style="color:#64748b;">Order ID:</span>
                    <span style="font-weight:700; color:#0f172a;" id="lgwSuccessOrderId">—</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed #e2e8f0; font-size:12.5px;">
                    <span style="color:#64748b;">Package:</span>
                    <span style="font-weight:700; color:#0f172a;" id="lgwSuccessPackage">—</span>
                  </div>
                  <div style="display:flex; justify-content:space-between; padding:4px 0; font-size:12.5px;">
                    <span style="color:#64748b;">Amount:</span>
                    <span style="font-weight:800; color:#10b981;" id="lgwSuccessAmount">—</span>
                  </div>
                </div>

                <a href="#" target="_blank" rel="noopener" id="lgwSuccessTgBtn" class="lgw-btn-telegram">
                  <i class="fa-brands fa-telegram"></i> Open Telegram for Instant Access
                </a>

                <button type="button" class="lgw-btn-continue-solid" style="background:#f1f5f9; color:#334155; box-shadow:none; max-width:360px;" onclick="window.LinkAddaGateway.close()">
                  Done &amp; Return to Store
                </button>
              </div>
            </div>

          </div><!-- /lgw-views-container -->
        </div><!-- /lgw-right-pane -->

      </div><!-- /lgw-modal -->
    `;

    document.body.appendChild(backdrop);

    // Close button & outside click handler
    document.getElementById('lgwCloseBtn').onclick = () => window.LinkAddaGateway.close();

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) window.LinkAddaGateway.close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop.classList.contains('active')) {
        window.LinkAddaGateway.close();
      }
    });
  }

  function startTimer(durationSecs) {
    clearInterval(timerInterval);
    remainingSecs = durationSecs || 900;
    const el = document.getElementById('lgwUpiTimer');
    function update() {
      if (remainingSecs <= 0) {
        clearInterval(timerInterval);
        if (el) el.textContent = 'Expired';
        return;
      }
      const m = Math.floor(remainingSecs / 60).toString().padStart(2, '0');
      const s = (remainingSecs % 60).toString().padStart(2, '0');
      if (el) el.textContent = `${m}:${s}`;
      remainingSecs--;
    }
    update();
    timerInterval = setInterval(update, 1000);
  }

  function generateCleanQr(container, text, size) {
    if (!container || !text) return;
    container.innerHTML = '';
    size = size || 112;

    const fallbackUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=2&data=${encodeURIComponent(text)}`;

    if (typeof window.QRCode === 'function') {
      try {
        new QRCode(container, {
          text: text,
          width: size,
          height: size,
          colorDark: '#0b0f19',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
        const qrEl = container.querySelector('canvas, img');
        if (qrEl) {
          qrEl.style.borderRadius = '6px';
          qrEl.style.display = 'block';
          qrEl.style.margin = '0 auto';
          return;
        }
      } catch (err) {
        console.warn('QRCode JS error, using fallback API:', err);
      }
    }

    container.innerHTML = `<img src="${fallbackUrl}" alt="UPI QR Code" style="width:${size}px;height:${size}px;border-radius:6px;display:block;margin:0 auto;object-fit:contain;" />`;
  }

  // Render Methods on Left Rail of Right Pane (Image 3 Order & Styling)
  function renderMethodRail() {
    const rail = document.getElementById('lgwMethodsRail');
    if (!rail) return;

    const disabled = Array.isArray(gatewayConfig.disabledMethods) ? gatewayConfig.disabledMethods : [];
    let html = '';

    function buildRailItem(id, name, sub, logosHtml) {
      const isActive = activeMethodId === id;
      const activeClass = isActive ? 'active' : '';
      const detailsHtml = isActive ? getMethodDetailsHtml(id) : '';
      return `
        <div class="lgw-rail-item-wrap ${activeClass}">
          <div class="lgw-rail-item ${activeClass}" onclick="window.LinkAddaGateway.selectMethod('${id}')">
            <div class="lgw-rail-item-left">
              <div class="lgw-rail-title-row">
                <span class="lgw-rail-name">${name}</span>
                ${id === gatewayConfig.recommendedMethod ? `<span class="lgw-rec-badge"><i class="fa-solid fa-sparkles"></i> REC</span>` : ''}
              </div>
              ${sub ? `<span class="lgw-rail-sub">${sub}</span>` : ''}
            </div>
            <div class="lgw-rail-logos">
              ${logosHtml}
              <i class="fa-solid fa-chevron-right" style="font-size:10px; color:${isActive ? '#2563eb' : '#cbd5e1'}; margin-left:4px; transition:transform 0.2s; transform:${isActive ? 'rotate(90deg)' : 'none'};"></i>
            </div>
          </div>
          ${isActive ? `<div class="lgw-mobile-drawer">${detailsHtml}</div>` : ''}
        </div>
      `;
    }

    const methodEntries = [];

    // 1. Cards
    if (!disabled.includes('cards')) {
      methodEntries.push({
        id: 'cards',
        name: 'Cards',
        sub: 'Visa, Mastercard, RuPay',
        logos: `<div class="lgw-card-icons-row">
          <span class="lgw-card-icon-pill visa">VISA</span>
          <span class="lgw-card-icon-pill master">MC</span>
          <span class="lgw-card-icon-pill rupay">RuPay</span>
        </div>`
      });
    }

    // PayPal
    if (!disabled.includes('paypal')) {
      const inrVal = currentOrder ? (Number(currentOrder.inr || currentOrder.price) || 399) : 399;
      const usdVal = currentOrder && currentOrder.usd ? Number(currentOrder.usd) : Number((inrVal / 90).toFixed(2));
      methodEntries.push({
        id: 'paypal',
        name: gatewayConfig.paypalTitle || 'PayPal',
        sub: gatewayConfig.paypalSub || `₹${Math.round(inrVal)} / $${usdVal} USD • Cards`,
        logos: `<i class="fa-brands fa-paypal" style="color:#003087; font-size:15px;"></i>`
      });
    }

    // 2. UPI
    if (!disabled.includes('upi')) {
      methodEntries.push({
        id: 'upi',
        name: 'UPI',
        sub: 'GPay, PhonePe, Paytm',
        logos: `<span class="lgw-mini-badge gpay">G</span><span class="lgw-mini-badge phonepe">P</span><span class="lgw-mini-badge paytm">₹</span>`
      });
    }

    // 3. Scan QR Code
    if (!disabled.includes('qr')) {
      methodEntries.push({
        id: 'qr',
        name: 'Scan QR Code',
        sub: 'BHIM, Any App',
        logos: `<i class="fa-solid fa-qrcode" style="color:#2563eb; font-size:13px;"></i>`
      });
    }

    // 4. Wallet
    if (!disabled.includes('wallet')) {
      const bal = getCustomerWalletBalance();
      methodEntries.push({
        id: 'wallet',
        name: 'Wallet',
        sub: `Bal: ₹${bal.toFixed(2)}`,
        logos: `<i class="fa-solid fa-wallet" style="color:#2563eb; font-size:13px;"></i>`
      });
    }

    // 5. Binance Pay
    if (!disabled.includes('binancepay')) {
      methodEntries.push({
        id: 'binancepay',
        name: 'Binance Pay',
        sub: '0% Gas Fee',
        logos: `<span class="lgw-mini-badge crypto">B</span>`
      });
    }

    // 6. USDT BEP-20
    if (!disabled.includes('bep20')) {
      methodEntries.push({
        id: 'bep20',
        name: 'USDT (BEP-20)',
        sub: 'BNB Smart Chain',
        logos: `<i class="fa-brands fa-ethereum" style="color:#38bdf8; font-size:13px;"></i>`
      });
    }

    // 7. Bank Transfer & Admin Custom Methods
    if (gatewayConfig.customMethods && typeof gatewayConfig.customMethods === 'object') {
      Object.entries(gatewayConfig.customMethods).forEach(([cId, cMethod]) => {
        if (!cMethod || cMethod.status === 'disabled' || disabled.includes(cId)) return;
        const name = cMethod.name || 'Bank Transfer';
        methodEntries.push({
          id: cId,
          name: name,
          sub: cMethod.sub || 'Direct Account Transfer',
          logos: `<span class="lgw-mini-badge bank"><i class="fa-solid fa-building-columns" style="font-size:7px;"></i></span>`
        });
      });
    }

    // Sort: Explicit activeMethodId first, then recommendedMethod
    methodEntries.sort((a, b) => {
      const targetActive = (activeMethodId || '').toLowerCase().trim();
      const rec = (gatewayConfig.recommendedMethod || '').toLowerCase().trim();
      if (targetActive) {
        if (a.id.toLowerCase() === targetActive) return -1;
        if (b.id.toLowerCase() === targetActive) return 1;
      }
      if (rec) {
        if (a.id.toLowerCase() === rec) return -1;
        if (b.id.toLowerCase() === rec) return 1;
      }
      return 0;
    });

    methodEntries.forEach(m => {
      html += buildRailItem(m.id, m.name, m.sub, m.logos);
    });

    rail.innerHTML = html;
  }

  // Generate Detail Markup for any Payment Method (Matches Image 3)
  function getMethodDetailsHtml(methodId) {
    if (!currentOrder) return '';
    const inrVal = parseMoney(currentOrder.inr || currentOrder.price || currentOrder.amount || 399);
    const usdVal = currentOrder.usd ? parseMoney(currentOrder.usd) : Number((inrVal / 90).toFixed(2));
    const walletBal = getCustomerWalletBalance();
    const upiId = gatewayConfig.upiId || 'Ritikane@ptyes';
    const cleanAmt = inrVal.toFixed(2);
    const orderRef = 'LA' + Date.now().toString().slice(-8);
    const safeNote = 'LinkAdda Services'; // Strictly clean, safe corporate note (NO adult keywords)

    const continueBtnHtml = `
      <div class="lgw-details-actions">
        <button type="button" class="lgw-btn-continue-solid" onclick="window.LinkAddaGateway.handleContinueClick()">
          Continue
        </button>
        <div class="lgw-trust-footer-sub">
          <i class="fa-solid fa-shield-halved" style="color:#10b981;"></i> 100% Safe &amp; 256-bit Encrypted
        </div>
      </div>
    `;

    // 1. CARDS (Secure Compliant Notice - Zero raw card/CVV scraping)
    if (methodId === 'cards') {
      return `
        <div class="lgw-details-content">
          <div class="lgw-details-title">Pay via Debit / Credit Card</div>
          
          <div style="background: rgba(37, 99, 235, 0.05); border: 1px solid rgba(37, 99, 235, 0.18); border-radius: 14px; padding: 18px 16px; margin: 12px 0 16px;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
              <i class="fa-solid fa-shield-halved" style="color: #10b981; font-size: 18px;"></i>
              <span style="font-size: 13.5px; font-weight: 700; color: #1e293b;">100% Safe &amp; RBI Compliant Checkout</span>
            </div>
            <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0 0 10px;">
              For your financial security, LinkAdda never stores or asks for raw card CVV codes directly. You can complete your purchase securely via our verified instant UPI or Bank Transfer gateway.
            </p>
            <div style="display: flex; gap: 6px; align-items: center;">
              <span class="lgw-card-icon-pill visa">VISA</span>
              <span class="lgw-card-icon-pill master">MasterCard</span>
              <span class="lgw-card-icon-pill rupay">RuPay</span>
            </div>
          </div>

          <div style="font-size: 11.5px; color: #64748b; line-height: 1.4;">
            <i class="fa-solid fa-lock" style="color: #10b981;"></i> Click <b>Continue</b> below to proceed to fast secure authentication.
          </div>
        </div>
        ${continueBtnHtml}
      `;
    }

    // PayPal (Global & USD)
    if (methodId === 'paypal') {
      const pLink = gatewayConfig.paypalLink || 'https://paypal.me/Jayagupta601';
      return `
        <div class="lgw-details-content">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div>
              <div class="lgw-details-title" style="margin-bottom:2px;">${gatewayConfig.paypalTitle || 'PayPal Global'}</div>
              <div style="font-size:11.5px; color:#64748b;">International Debit / Credit Cards &amp; USD</div>
            </div>
            <i class="fa-brands fa-paypal" style="color:#003087; font-size:22px;"></i>
          </div>

          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px; text-align:center; margin-bottom:12px;">
            <div style="font-size:14px; font-weight:800; color:#0f172a; display:flex; align-items:center; justify-content:center; gap:8px; flex-wrap:wrap;">
              <span>Amount: <b>₹${cleanAmt}</b></span>
              <span style="color:#94a3b8; font-weight:400;">/</span>
              <span style="color:#003087; background:#eff6ff; padding:2px 8px; border-radius:6px; border:1px solid #bfdbfe;"><b>$${usdVal} USD</b></span>
            </div>
            <div style="font-size:11px; color:#64748b; margin-top:3px;">Zero international conversion fee on USD payment</div>
          </div>

          <div style="margin-bottom:12px;">
            <a href="${pLink}" target="_blank" rel="noopener noreferrer" class="lgw-btn-continue-solid" style="display:flex; align-items:center; justify-content:center; gap:8px; text-decoration:none; padding:12px; font-size:13px; background:linear-gradient(135deg, #003087, #0079c1);">
              <i class="fa-brands fa-paypal"></i> Pay $${usdVal} USD (₹${cleanAmt}) with PayPal
            </a>
          </div>

          <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:8px 12px; display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
            <span style="font-size:11.5px; color:#0f172a; word-break:break-all;">${pLink}</span>
            <button type="button" class="lgw-btn-copy" onclick="window.LinkAddaGateway.copyText('${pLink}', this)">Copy</button>
          </div>

          <div style="font-size:11px; color:#64748b; line-height:1.4;">
            <i class="fa-solid fa-circle-info" style="color:#2563eb;"></i> Complete payment via PayPal (<b>$${usdVal} USD / ₹${cleanAmt}</b>) &rarr; Click <b>Continue</b> below to submit confirmation.
          </div>
        </div>
        ${continueBtnHtml}
      `;
    }

    // 2. UPI
    if (methodId === 'upi') {
      return `
        <div class="lgw-details-content">
          <div class="lgw-details-title">Pay using UPI</div>
          
          <div class="lgw-upi-grid">
            <!-- Google Pay -->
            <div class="lgw-upi-app-card" onclick="window.LinkAddaGateway.openApp('Google Pay', event)">
              <div class="lgw-upi-app-icon gpay"><i class="fa-brands fa-google"></i></div>
              <div>
                <div class="lgw-upi-app-name">Google Pay</div>
                <div class="lgw-upi-app-desc">Auto-Fill ₹${cleanAmt}</div>
              </div>
            </div>

            <!-- PhonePe -->
            <div class="lgw-upi-app-card" onclick="window.LinkAddaGateway.openApp('PhonePe', event)">
              <div class="lgw-upi-app-icon phonepe"><i class="fa-solid fa-p"></i></div>
              <div>
                <div class="lgw-upi-app-name">PhonePe</div>
                <div class="lgw-upi-app-desc">Direct App Pay ₹${cleanAmt}</div>
              </div>
            </div>

            <!-- Paytm -->
            <div class="lgw-upi-app-card" onclick="window.LinkAddaGateway.openApp('Paytm', event)">
              <div class="lgw-upi-app-icon paytm"><i class="fa-solid fa-wallet"></i></div>
              <div>
                <div class="lgw-upi-app-name">Paytm</div>
                <div class="lgw-upi-app-desc">Direct App Pay ₹${cleanAmt}</div>
              </div>
            </div>

            <!-- Scan QR Code Toggle -->
            <div class="lgw-upi-app-card" style="background:#eff6ff; border-color:#bfdbfe;" onclick="window.LinkAddaGateway.toggleUpiMode()">
              <div class="lgw-upi-app-icon qr"><i class="fa-solid fa-qrcode"></i></div>
              <div>
                <div class="lgw-upi-app-name">${activeUpiMode === 'qr' ? 'Hide QR Code' : 'Scan QR Code'}</div>
                <div class="lgw-upi-app-desc">BHIM, Any UPI App</div>
              </div>
            </div>
          </div>

          <!-- Dynamic QR Box -->
          <div class="lgw-qr-box" style="display:${activeUpiMode === 'qr' ? 'block' : 'none'};">
            <div class="lgw-qr-white-frame">
              <div class="lgw-dynamic-qr-target"></div>
            </div>
            <div class="lgw-qr-countdown">
              <i class="fa-solid fa-clock"></i> Window active: <span id="lgwUpiTimer">15:00</span>
            </div>
            <div style="font-size:11px; color:#64748b;">Scan using any UPI App (GPay, PhonePe, Paytm, BHIM, CRED)</div>
            
            <div class="lgw-copy-strip">
              <span style="color:#64748b; font-size:11px; font-weight:600;">UPI ID:</span>
              <span class="lgw-copy-strip-val">${upiId}</span>
              <button type="button" class="lgw-btn-copy" onclick="window.LinkAddaGateway.copyText('${upiId}', this)">Copy</button>
            </div>
          </div>

          <div style="font-size:11px; color:#64748b; margin-top:2px;">
            <i class="fa-solid fa-shield-halved" style="color:#10b981;"></i> Complete payment in your UPI app, then click <b>Continue</b> below to confirm your order.
          </div>
        </div>
        ${continueBtnHtml}
      `;
    }

    // 3. SCAN QR CODE DIRECT TAB
    if (methodId === 'qr') {
      return `
        <div class="lgw-details-content">
          <div class="lgw-details-title">Scan UPI QR Code</div>
          
          <div class="lgw-qr-box" style="display:block;">
            <div class="lgw-qr-white-frame">
              <div class="lgw-dynamic-qr-target"></div>
            </div>
            <div class="lgw-qr-countdown">
              <i class="fa-solid fa-clock"></i> Window active: <span id="lgwUpiTimer">15:00</span>
            </div>
            <div style="font-size:11.5px; color:#475569; font-weight:600; margin-top:4px;">Pay exact <b>₹${cleanAmt}</b> using any UPI app</div>
            
            <div class="lgw-copy-strip" style="margin-top:10px;">
              <span style="color:#64748b; font-size:11px; font-weight:600;">UPI ID:</span>
              <span class="lgw-copy-strip-val">${upiId}</span>
              <button type="button" class="lgw-btn-copy" onclick="window.LinkAddaGateway.copyText('${upiId}', this)">Copy</button>
            </div>
          </div>
        </div>
        ${continueBtnHtml}
      `;
    }

    // 4. WALLET
    if (methodId === 'wallet') {
      const hasEnough = walletBal >= inrVal;
      return `
        <div class="lgw-details-content">
          <div class="lgw-details-title">LinkAdda Wallet Balance</div>
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-bottom:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:13px; color:#64748b;">Available Balance</span>
              <span style="font-size:18px; font-weight:900; color:#10b981;">₹${walletBal.toFixed(2)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:13px; color:#64748b;">Order Total</span>
              <span style="font-size:18px; font-weight:900; color:#0f172a;">₹${inrVal.toFixed(2)}</span>
            </div>
          </div>

          ${hasEnough ? `
            <button type="button" class="lgw-btn-continue-solid" style="background:#10b981; padding:14px;" onclick="window.LinkAddaGateway.payWithWallet()">
              <i class="fa-solid fa-bolt"></i> 1-Click Pay ₹${inrVal.toFixed(2)} from Wallet
            </button>
            <div style="font-size:11px; color:#64748b; text-align:center; margin-top:8px;">Zero proof required. Instant delivery to your account.</div>
          ` : `
            <div style="background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; border-radius:8px; padding:10px 12px; font-size:12px; margin-bottom:12px;">
              <i class="fa-solid fa-triangle-exclamation"></i> Insufficient balance in wallet. Please pay via UPI or recharge in your dashboard.
            </div>
            <button type="button" class="lgw-btn-continue-solid" style="background:#f1f5f9; color:#334155; box-shadow:none;" onclick="window.LinkAddaGateway.selectMethod('upi')">
              Switch to UPI Payment
            </button>
          `}
        </div>
      `;
    }

    // 5. BINANCE PAY
    if (methodId === 'binancepay') {
      return `
        <div class="lgw-details-content">
          <div class="lgw-details-title">Binance Pay Transfer</div>
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; margin-bottom:12px;">
            <div class="lgw-copy-strip" style="background:#ffffff; margin:0 0 8px 0;">
              <span style="color:#64748b; font-size:11px; font-weight:600;">Binance ID:</span>
              <span class="lgw-copy-strip-val">${gatewayConfig.binanceId}</span>
              <button type="button" class="lgw-btn-copy" onclick="window.LinkAddaGateway.copyText('${gatewayConfig.binanceId}', this)">Copy</button>
            </div>
            <div style="font-size:12px; color:#334155; line-height:1.5;">
              1. Open Binance App &rarr; Pay &rarr; Send &rarr; Enter Binance ID <b>${gatewayConfig.binanceId}</b>.<br>
              2. Send <b>$${usdVal} USDT</b> (0% Gas Fee).<br>
              3. Tap <b>Continue</b> below to submit screenshot.
            </div>
          </div>
        </div>
        ${continueBtnHtml}
      `;
    }

    // 6. USDT BEP-20
    if (methodId === 'bep20') {
      return `
        <div class="lgw-details-content">
          <div class="lgw-details-title">USDT (BEP-20) BNB Smart Chain</div>
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; margin-bottom:12px;">
            <div class="lgw-copy-strip" style="background:#ffffff; margin:0 0 8px 0;">
              <span style="color:#64748b; font-size:11px; font-weight:600;">Address:</span>
              <span class="lgw-copy-strip-val" style="font-size:11px;">${gatewayConfig.bep20Address}</span>
              <button type="button" class="lgw-btn-copy" onclick="window.LinkAddaGateway.copyText('${gatewayConfig.bep20Address}', this)">Copy</button>
            </div>
            <div style="background:#fef3c7; border:1px solid #fde68a; color:#92400e; padding:8px 10px; border-radius:6px; font-size:11px; margin-bottom:8px;">
              <i class="fa-solid fa-triangle-exclamation"></i> Only transfer USDT on <b>BNB Smart Chain (BEP-20)</b>.
            </div>
            <div style="font-size:12px; color:#334155;">Transfer Amount: <b>$${usdVal} USDT</b></div>
          </div>
        </div>
        ${continueBtnHtml}
      `;
    }

    // 7. BITCOIN & CRYPTO WALLET METHODS
    const isBtc = methodId === 'custom_btc' || (methodId && methodId.toLowerCase().includes('btc'));
    const isCryptoType = gatewayConfig.customMethods && gatewayConfig.customMethods[methodId] && (
      gatewayConfig.customMethods[methodId].type === 'crypto' ||
      isBtc ||
      /btc|bitcoin|usdt|eth|ton|sol|trx|crypto/i.test(gatewayConfig.customMethods[methodId].name || '')
    );

    if (isBtc || isCryptoType) {
      const c = (gatewayConfig.customMethods && gatewayConfig.customMethods[methodId]) || {};
      const btcTitle = c.name || gatewayConfig.btcTitle || 'Bitcoin (BTC)';
      const btcSub = c.sub || c.network || gatewayConfig.btcSub || 'BTC Native Network';
      const walletAddress = c.identifier || c.address || c.walletAddress || gatewayConfig.btcAddress || 'bc1q3vuldn6dz4jv5896gap27ngrtg7q4p6krtk9hu';
      const qrImgUrl = c.qrImage || c.insideImage || gatewayConfig.btcQr || '';
      const instructions = c.instructions || 'Send exact BTC amount to address above on Bitcoin mainnet.';

      return `
        <div class="lgw-details-content">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div>
              <div class="lgw-details-title" style="margin-bottom:2px;">${btcTitle}</div>
              <span style="font-size:11.5px; color:#64748b; font-weight:600;">Network: <b>${btcSub}</b></span>
            </div>
            <div class="lgw-logo-group">${REAL_LOGOS.btc}</div>
          </div>
          ${qrImgUrl ? `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; text-align:center; margin-bottom:12px;">
              <img src="${qrImgUrl}" alt="QR" style="width:124px;height:124px;object-fit:contain;border-radius:6px;display:block;margin:0 auto 8px;" />
              <div style="font-size:11px; color:#64748b;">Scan with any crypto wallet &bull; Amount: <b style="color:#0f172a;">$${usdVal} USD</b></div>
            </div>
          ` : ''}
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; margin-bottom:12px;">
            <div style="font-size:11px; font-weight:700; color:#64748b; margin-bottom:4px;">Deposit Address:</div>
            <div class="lgw-copy-strip" style="background:#ffffff; margin:0 0 10px 0;">
              <span class="lgw-copy-strip-val" style="word-break:break-all; font-size:11.5px;">${walletAddress}</span>
              <button type="button" class="lgw-btn-copy" onclick="window.LinkAddaGateway.copyText('${walletAddress}', this)">Copy</button>
            </div>
            <div style="background:#fef3c7; border:1px solid #fde68a; color:#92400e; padding:8px 10px; border-radius:6px; font-size:11px; margin-bottom:8px;">
              <i class="fa-solid fa-triangle-exclamation"></i> Only transfer on <b>${btcSub}</b>.
            </div>
            ${instructions ? `<div style="font-size:11.5px; color:#64748b; line-height:1.4;">${instructions}</div>` : ''}
          </div>
        </div>
        ${continueBtnHtml}
      `;
    }

    // 8. BANK TRANSFER / CUSTOM METHODS
    if (gatewayConfig.customMethods && gatewayConfig.customMethods[methodId]) {
      const c = gatewayConfig.customMethods[methodId];
      const accNum = c.accountNumber || c.identifier || '45231994969';
      const ifscVal = c.ifsc || 'SBIN0002594';
      return `
        <div class="lgw-details-content">
          <div class="lgw-details-title">${c.name || 'Bank Transfer'}</div>
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; margin-bottom:12px;">
            <table class="lgw-clean-table">
              ${c.bankName ? `<tr><td class="lbl">Bank Name:</td><td class="val">${c.bankName}</td></tr>` : ''}
              ${c.accountName ? `<tr><td class="lbl">Account Name:</td><td class="val">${c.accountName}</td></tr>` : ''}
              <tr>
                <td class="lbl">Account Number:</td>
                <td class="val">
                  ${accNum}
                  <button type="button" class="lgw-btn-copy" style="margin-left:6px; padding:1px 6px;" onclick="window.LinkAddaGateway.copyText('${accNum}', this)">Copy</button>
                </td>
              </tr>
              <tr>
                <td class="lbl">IFSC Code:</td>
                <td class="val">
                  ${ifscVal}
                  <button type="button" class="lgw-btn-copy" style="margin-left:6px; padding:1px 6px;" onclick="window.LinkAddaGateway.copyText('${ifscVal}', this)">Copy</button>
                </td>
              </tr>
              ${c.upiId ? `
                <tr>
                  <td class="lbl">Bank UPI ID:</td>
                  <td class="val">
                    ${c.upiId}
                    <button type="button" class="lgw-btn-copy" style="margin-left:6px; padding:1px 6px;" onclick="window.LinkAddaGateway.copyText('${c.upiId}', this)">Copy</button>
                  </td>
                </tr>
              ` : ''}
            </table>
            ${c.instructions ? `<div style="font-size:11.5px; color:#64748b; line-height:1.4;">${c.instructions}</div>` : ''}
          </div>
        </div>
        ${continueBtnHtml}
      `;
    }

    return '';
  }

  // Render Details of Active Selected Method on Desktop
  function renderActiveMethodDetails() {
    const details = document.getElementById('lgwMethodDetails');
    if (!details || !currentOrder) return;

    details.innerHTML = getMethodDetailsHtml(activeMethodId);

    // Render QR Code if UPI & activeUpiMode === 'qr' or methodId === 'qr'
    if ((activeMethodId === 'upi' && activeUpiMode === 'qr') || activeMethodId === 'qr') {
      const upiId = gatewayConfig.upiId || 'Ritikane@ptyes';
      const inrVal = parseMoney(currentOrder.inr || currentOrder.price || currentOrder.amount || 399);
      const cleanAmt = inrVal.toFixed(2);
      const orderRef = 'LA' + Date.now().toString().slice(-8);
      const safeNote = 'LinkAdda Services'; // Strictly clean, safe corporate note
      const upiParams = new URLSearchParams();
      upiParams.set('pa', upiId);
      upiParams.set('pn', 'LinkAdda Store');
      upiParams.set('mc', '5732'); // Digital Goods MCC
      upiParams.set('tr', orderRef); // Transaction Reference
      upiParams.set('mode', '02'); // Mode 02 locks amount in PhonePe & GPay
      upiParams.set('am', cleanAmt); // Fixed amount (cannot be edited)
      upiParams.set('cu', 'INR');
      upiParams.set('tn', safeNote); // NO adult names in UPI!
      const upiUri = `upi://pay?${upiParams.toString()}`;

      setTimeout(() => {
        document.querySelectorAll('.lgw-dynamic-qr-target').forEach((target) => {
          generateCleanQr(target, upiUri, 112);
        });
      }, 30);
    }
  }

  // Gateway API Controller
  window.LinkAddaGateway = {
    open: function(options) {
      refreshGatewayConfig();
      createModalDOM();

      this._orderSubmitting = false;
      const submitBtn = document.getElementById('lgwSubmitProofBtn');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '';
        submitBtn.style.pointerEvents = '';
        submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Payment Verification';
      }

      currentOrder = options || {};
      screenshotBase64 = null;
      activeMethodId = options.method || 'upi';
      activeUpiMode = 'apps';

      const rawTitle = currentOrder.title || currentOrder.name || currentOrder.productName || 'VIP Digital Access Pass';
      const displayTitle = sanitizeProductTitle(rawTitle);
      currentOrder.displayTitle = displayTitle;

      const inrVal = parseMoney(currentOrder.inr || currentOrder.price || currentOrder.amount || 399);
      const cust = getCustomerSession() || {};

      // Populate desktop sidebar info (Image 3 layout)
      const sideAmt = document.getElementById('lgwSidebarAmount');
      const userPill = document.getElementById('lgwUserEmailPill');
      const mobTitle = document.getElementById('lgwMobItemTitle');
      const mobTotal = document.getElementById('lgwMobTotalAmt');
      const mobSticky = document.getElementById('lgwMobStickyAmt');

      const userDisplay = cust.phone ? `Using as +91 ${cust.phone.replace(/[^0-9]/g, '').slice(-10)}` : (cust.email ? `Using as ${cust.email}` : 'Using as Customer');

      if (sideAmt) sideAmt.textContent = `₹${inrVal.toFixed(2)}`;
      if (userPill) userPill.textContent = userDisplay;
      if (mobTitle) mobTitle.textContent = displayTitle;
      if (mobTotal) mobTotal.textContent = `₹${inrVal.toFixed(2)}`;
      if (mobSticky) mobSticky.textContent = `₹${inrVal.toFixed(2)}`;

      const proofAmt = document.getElementById('lgwProofAmountLabel');
      const proofMethod = document.getElementById('lgwProofMethodLabel');
      if (proofAmt) proofAmt.textContent = `₹${inrVal.toFixed(2)}`;
      if (proofMethod) proofMethod.textContent = (activeMethodId || 'upi').toUpperCase();

      renderMethodRail();
      renderActiveMethodDetails();

      this.showView('checkout');
      startTimer(900);

      const backdrop = document.getElementById('linkaddaGatewayBackdrop');
      if (backdrop) {
        backdrop.style.display = 'flex';
        backdrop.classList.add('active');
      }
      document.body.style.overflow = 'hidden';
    },

    close: function() {
      this._orderSubmitting = false;
      const backdrop = document.getElementById('linkaddaGatewayBackdrop');
      if (backdrop) {
        backdrop.style.display = 'none';
        backdrop.classList.remove('active');
      }
      document.body.style.overflow = '';
      clearInterval(timerInterval);
    },

    showView: function(viewName) {
      const checkoutView = document.getElementById('lgwViewCheckout');
      const proofView = document.getElementById('lgwViewProof');
      const successView = document.getElementById('lgwViewSuccess');

      if (checkoutView) {
        checkoutView.classList.remove('active');
        checkoutView.style.display = 'none';
      }
      if (proofView) {
        proofView.classList.remove('active');
        proofView.style.display = 'none';
      }
      if (successView) {
        successView.classList.remove('active');
        successView.style.display = 'none';
      }

      if (viewName === 'checkout') {
        if (checkoutView) {
          checkoutView.classList.add('active');
          checkoutView.style.display = 'block';
        }
      } else if (viewName === 'proof') {
        if (proofView) {
          proofView.classList.add('active');
          proofView.style.display = 'block';
        }
      } else if (viewName === 'success') {
        if (successView) {
          successView.classList.add('active');
          successView.style.display = 'block';
        }
      }
    },

    selectMethod: function(methodId) {
      activeMethodId = methodId;
      renderMethodRail();
      renderActiveMethodDetails();
    },

    toggleUpiMode: function() {
      activeUpiMode = (activeUpiMode === 'qr') ? 'apps' : 'qr';
      renderActiveMethodDetails();
    },

    // Direct PhonePe / UPI App Opener with Locked Price
    openApp: function(appName, event) {
      if (event) {
        try { event.preventDefault(); event.stopPropagation(); } catch (_) {}
      }
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (!isMobile) {
        // Switch to QR mode on desktop so user can scan with mobile
        activeUpiMode = 'qr';
        renderActiveMethodDetails();
        return;
      }

      const upiId = gatewayConfig.upiId || 'Ritikane@ptyes';
      const inrVal = parseMoney(currentOrder?.inr || currentOrder?.price || currentOrder?.amount || 399);
      const cleanAmt = inrVal.toFixed(2);
      const orderRef = 'JG' + Date.now().toString().slice(-8);
      const safeNote = 'JaiGram Services'; // Strictly clean, safe corporate note (NO adult keywords)

      const upiParams = new URLSearchParams();
      upiParams.set('pa', upiId);
      upiParams.set('pn', 'JaiGram Store');
      upiParams.set('mc', '5732'); // Merchant Category Code (Digital Goods)
      upiParams.set('tr', orderRef); // Transaction Reference
      upiParams.set('mode', '02'); // Mode 02 locks amount in PhonePe & GPay
      upiParams.set('am', cleanAmt); // Fixed, non-editable amount
      upiParams.set('cu', 'INR');
      upiParams.set('tn', safeNote); // Fixed safe note

      const qStr = upiParams.toString();
      const isAndroid = /Android/i.test(navigator.userAgent);
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

      let targetUri = `upi://pay?${qStr}`;

      if (appName === 'PhonePe') {
        if (isAndroid) {
          // Direct PhonePe package intent on Android locks app & amount
          targetUri = `intent://pay?${qStr}#Intent;scheme=upi;package=com.phonepe.app;end`;
        } else if (isIOS) {
          targetUri = `phonepe://pay?${qStr}`;
        }
      } else if (appName === 'Google Pay') {
        if (isAndroid) {
          targetUri = `intent://pay?${qStr}#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end`;
        } else if (isIOS) {
          targetUri = `tez://upi/pay?${qStr}`;
        }
      } else if (appName === 'Paytm') {
        if (isAndroid) {
          targetUri = `intent://pay?${qStr}#Intent;scheme=upi;package=net.one97.paytm;end`;
        } else if (isIOS) {
          targetUri = `paytmmp://pay?${qStr}`;
        }
      }

      try {
        window.location.href = targetUri;
      } catch (_) {
        window.location.href = `upi://pay?${qStr}`;
      }

      // Android PhonePe deep link fallback in case package intent blocked
      if (appName === 'PhonePe' && isAndroid) {
        setTimeout(() => {
          try {
            window.location.href = `phonepe://pay?${qStr}`;
          } catch (_) {}
        }, 400);
      }
    },

    handleAppClick: function(appName, event) {
      this.openApp(appName, event);
    },

    handleContinueClick: function() {
      const inrVal = parseMoney(currentOrder?.inr || currentOrder?.price || currentOrder?.amount || 399);
      const nameEl = document.getElementById('lgwProofMethodLabel');
      const amtEl = document.getElementById('lgwProofAmountLabel');
      if (nameEl) nameEl.textContent = activeMethodId.toUpperCase();
      if (amtEl) amtEl.textContent = `₹${inrVal.toFixed(2)}`;

      const alertEl = document.getElementById('lgwProofAlert');
      if (alertEl) alertEl.style.display = 'none';

      this.showView('proof');
    },

    copyText: function(text, btn) {
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        if (btn) {
          const orig = btn.innerHTML;
          btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
          setTimeout(() => { btn.innerHTML = orig; }, 2000);
        }
      }).catch(() => {
        const temp = document.createElement('textarea');
        temp.value = text;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
        if (btn) {
          const orig = btn.innerHTML;
          btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
          setTimeout(() => { btn.innerHTML = orig; }, 2000);
        }
      });
    },

    handleFileInput: async function(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const previewImage = document.getElementById('lgwPreviewImage');
      const previewContainer = document.getElementById('lgwPreviewContainer');
      const uploadCard = document.getElementById('lgwUploadCard');
      const alertEl = document.getElementById('lgwProofAlert');

      // Fast Canvas compression (80KB-160KB in ~30ms)
      const compressedDataUrl = await new Promise((resolve) => {
        if (!file.type || !file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.onerror = () => resolve('');
          reader.readAsDataURL(file);
          return;
        }
        const img = new Image();
        const objUrl = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(objUrl);
          try {
            let width = img.width || 1200;
            let height = img.height || 1200;
            const maxDimension = 1200;
            if (width > maxDimension || height > maxDimension) {
              if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
              } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.80));
          } catch (_) {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target.result);
            reader.readAsDataURL(file);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(objUrl);
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.readAsDataURL(file);
        };
        img.src = objUrl;
      });

      if (!compressedDataUrl) return;

      screenshotBase64 = compressedDataUrl;
      if (previewImage) previewImage.src = compressedDataUrl;
      if (previewContainer) previewContainer.style.display = 'block';
      if (uploadCard) uploadCard.style.display = 'none';
      if (alertEl) alertEl.style.display = 'none';

      // ⚡ INSTANT BACKGROUND PRE-UPLOAD
      _uploadedScreenshotUrl = '';
      _uploadedScreenshotPromise = (async () => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 7000);
          const upRes = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              folder: 'orders',
              filename: `ss_${Date.now()}_proof.jpg`,
              base64: compressedDataUrl,
              contentType: 'image/jpeg'
            })
          });
          clearTimeout(timer);
          if (upRes.ok) {
            const upData = await upRes.json();
            _uploadedScreenshotUrl = upData.publicUrl || upData.url || '';
            return _uploadedScreenshotUrl;
          }
        } catch (uploadErr) {
          console.warn('Background screenshot upload note:', uploadErr);
        }
        return '';
      })();
    },

    removePreview: function() {
      screenshotBase64 = null;
      _uploadedScreenshotPromise = null;
      _uploadedScreenshotUrl = '';
      const previewContainer = document.getElementById('lgwPreviewContainer');
      const uploadCard = document.getElementById('lgwUploadCard');
      const fileInput = document.getElementById('lgwFileInput');

      if (previewContainer) previewContainer.style.display = 'none';
      if (uploadCard) uploadCard.style.display = 'block';
      if (fileInput) fileInput.value = '';
    },

    submitOrder: async function() {
      if (!screenshotBase64) {
        const alertEl = document.getElementById('lgwProofAlert');
        if (alertEl) alertEl.style.display = 'block';
        return;
      }

      // ━━ GUARD: Prevent duplicate submissions on multiple clicks ━━
      if (this._orderSubmitting) return;
      this._orderSubmitting = true;

      const submitBtn = document.getElementById('lgwSubmitProofBtn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.style.pointerEvents = 'none';
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting Order...';
      }

      // 1. Upload screenshot to media.jaigram.shop CDN via /api/upload (fast non-blocking)
      let uploadedScreenshotUrl = _uploadedScreenshotUrl || '';
      if (!uploadedScreenshotUrl && _uploadedScreenshotPromise) {
        try {
          uploadedScreenshotUrl = await Promise.race([
            _uploadedScreenshotPromise,
            new Promise((r) => setTimeout(() => r(''), 600))
          ]);
        } catch (_) {}
      }

      // If CDN url not immediately ready, use local base64 immediately for 0ms delay and let background upload proceed
      if (!uploadedScreenshotUrl && screenshotBase64) {
        try {
          fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              folder: 'orders',
              filename: `ss_${Date.now()}_proof.jpg`,
              base64: screenshotBase64,
              contentType: 'image/jpeg'
            })
          }).then(res => res.ok ? res.json() : null).then(upData => {
            if (upData && (upData.publicUrl || upData.url)) {
              _uploadedScreenshotUrl = upData.publicUrl || upData.url;
              // Update screenshot URL in RTDB asynchronously
              try {
                fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/orders/${encodeURIComponent(cleanOrderId)}/screenshot.json`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(_uploadedScreenshotUrl)
                }).catch(() => {});
                fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/order_approvals/${encodeURIComponent(cleanOrderId)}/screenshot.json`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(_uploadedScreenshotUrl)
                }).catch(() => {});
              } catch (_) {}
            }
          }).catch(() => {});
        } catch (_) {}
      }

      const finalScreenshot = uploadedScreenshotUrl || screenshotBase64;
      const rawTitle = currentOrder.title || currentOrder.name || currentOrder.productName || 'VIP Digital Access';
      const inrVal = parseMoney(currentOrder.inr || currentOrder.price || currentOrder.amount || 399);
      const amountText = `₹${inrVal.toFixed(2)}`;
      if (!currentOrder._lockedOrderId) {
        currentOrder._lockedOrderId = currentOrder.orderId || ('JG-' + Math.floor(100000 + Math.random() * 900000));
      }
      const rawId = currentOrder._lockedOrderId;
      const cleanOrderId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, '') || ('JG-' + Date.now());
      const displayOrderId = cleanOrderId.startsWith('#') ? cleanOrderId : ('#' + cleanOrderId);
      const orderId = cleanOrderId;
      const cust = getCustomerSession() || {};
      const now = Date.now();
      const utrVal = document.getElementById('lgwUtrInput')?.value?.trim() || '';

      const isTopup = currentOrder.type === 'wallet_topup' || currentOrder.pkg === 'wallet_topup' || currentOrder.productId === 'wallet_topup' ||
        String(rawTitle).toLowerCase().includes('wallet recharge') ||
        String(rawTitle).toLowerCase().includes('wallet topup') ||
        String(rawTitle).toLowerCase().includes('wallet top-up') ||
        String(currentOrder.name || '').toLowerCase().includes('wallet recharge');

      const title = isTopup ? (rawTitle.trim() || `JaiGram Wallet Recharge (₹${inrVal.toFixed(2)})`) : sanitizeProductTitle(rawTitle);
      const sellerName = isTopup ? 'Wallet Top-Up' : (currentOrder.sellerName || 'Trusted brother');
      const sellerId = isTopup ? 'system_wallet' : (currentOrder.sellerId || '');
      const custUid = cust.uid || cust.email || currentOrder.customerUid || 'guest';
      const custEmail = (cust.email || currentOrder.customerEmail || '').toLowerCase().trim();
      const custName = cust.displayName || cust.name || currentOrder.customerName || 'Customer';

      const orderPayload = {
        orderId: cleanOrderId,
        id: cleanOrderId,
        displayOrderId,
        productId: isTopup ? 'wallet_topup' : (currentOrder.productId || currentOrder.id || null),
        productName: title,
        title: title,
        name: title,
        type: isTopup ? 'wallet_topup' : (currentOrder.type || 'order'),
        pkg: isTopup ? 'wallet_topup' : (currentOrder.pkg || 'digital_pack'),
        isTopup: isTopup,
        amount: inrVal,
        amountDisplay: amountText,
        price: inrVal,
        currency: 'INR',
        paymentMethod: (activeMethodId || 'UPI').toUpperCase(),
        method: (activeMethodId || 'UPI').toUpperCase(),
        status: 'pending',
        orderStatus: 'pending',
        paymentStatus: 'pending',
        customerUid: custUid,
        customerEmail: custEmail,
        customerName: custName,
        sellerId: sellerId,
        sellerName: sellerName,
        utr: utrVal,
        screenshot: finalScreenshot,
        screenshotUrl: finalScreenshot,
        paymentProof: finalScreenshot,
        proofUrl: finalScreenshot,
        createdAt: now,
        timestamp: now,
        date: new Date(now).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      };

      // 1. Submit to localStorage across all customer order keys
      try {
        const uid = custUid !== 'guest' ? custUid : '';
        const email = custEmail;
        const targetKeys = [
          'jaigram_user_orders',
          'linkadda_user_orders',
          'jaigram_customer_orders',
          'linkadda_customer_orders',
          'linkadda_admin_orders_local'
        ];
        if (uid) {
          targetKeys.push('jaigram_customer_orders_' + uid);
          targetKeys.push('linkadda_customer_orders_' + uid);
        }
        if (email) {
          targetKeys.push('jaigram_customer_orders_' + email);
          targetKeys.push('linkadda_customer_orders_' + email);
        }

        targetKeys.forEach(key => {
          let list = [];
          try {
            const raw = localStorage.getItem(key);
            if (raw) list = JSON.parse(raw);
          } catch (_) {}
          if (!Array.isArray(list)) list = [];
          list = list.filter(item => String(item.orderId || item.id) !== cleanOrderId && String(item.orderId || item.id) !== displayOrderId);
          list.unshift(orderPayload);
          localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
        });

        // Dedicated persistent order IDs tracker
        let myIds = [];
        try {
          const rawIds = localStorage.getItem('jaigram_my_order_ids') || localStorage.getItem('linkadda_my_order_ids');
          if (rawIds) myIds = JSON.parse(rawIds);
        } catch (_) {}
        if (!Array.isArray(myIds)) myIds = [];
        if (!myIds.includes(cleanOrderId)) myIds.unshift(cleanOrderId);
        localStorage.setItem('jaigram_my_order_ids', JSON.stringify(myIds.slice(0, 100)));
        localStorage.setItem('linkadda_my_order_ids', JSON.stringify(myIds.slice(0, 100)));
      } catch (_) {}

      // If this is a wallet top-up, immediately record a pending transaction
      if (isTopup && custUid && custUid !== 'guest') {
        try {
          const pendingTxId = `tx_topup_${cleanOrderId}`;
          const pendingTx = {
            id: pendingTxId,
            orderId: displayOrderId,
            type: 'topup',
            amount: inrVal,
            desc: `Wallet Top-up (${displayOrderId}) - Verification Pending`,
            description: `Wallet Top-up (${displayOrderId}) - Verification Pending`,
            date: new Date(now).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            timestamp: now,
            status: 'pending'
          };
          fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(custUid)}/wallet_transactions/${pendingTxId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pendingTx)
          }).catch(() => {});
          fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/events/customers/${encodeURIComponent(custUid)}/wallet_transactions/${pendingTxId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pendingTx)
          }).catch(() => {});
          ['linkadda_wallet_tx_' + custUid, 'jaigram_wallet_tx_' + custUid].forEach(txKey => {
            let txs = [];
            try { const r = localStorage.getItem(txKey); if (r) txs = JSON.parse(r); } catch(_) {}
            if (!Array.isArray(txs)) txs = [];
            txs = txs.filter(t => t.id !== pendingTxId && t.orderId !== displayOrderId);
            txs.unshift(pendingTx);
            localStorage.setItem(txKey, JSON.stringify(txs.slice(0, 50)));
          });
        } catch (_) {}
      }

      // 2. Submit canonically to Firebase RTDB (Orders & public Order Approvals)
      try {
        fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/orders/${encodeURIComponent(cleanOrderId)}.json`, {
          method: 'PUT',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload)
        }).catch(() => {});
        fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/order_approvals/${encodeURIComponent(cleanOrderId)}.json`, {
          method: 'PUT',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: cleanOrderId,
            id: cleanOrderId,
            displayOrderId,
            productId: isTopup ? 'wallet_topup' : (currentOrder.productId || currentOrder.id || null),
            productName: title,
            title: title,
            name: title,
            type: isTopup ? 'wallet_topup' : 'order',
            isTopup: isTopup,
            amount: inrVal,
            amountDisplay: amountText,
            price: inrVal,
            currency: 'INR',
            paymentMethod: (activeMethodId || 'UPI').toUpperCase(),
            method: (activeMethodId || 'UPI').toUpperCase(),
            status: 'pending',
            orderStatus: 'pending',
            paymentStatus: 'pending',
            customerUid: custUid,
            customerEmail: custEmail,
            customerName: custName,
            sellerName: sellerName,
            sellerId: sellerId,
            utr: utrVal,
            screenshot: finalScreenshot,
            screenshotUrl: finalScreenshot,
            createdAt: now,
            timestamp: now,
            date: new Date(now).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          })
        }).catch(() => {});
      } catch (_) {}

      // 3. Fire to serverless backend asynchronously (keeps submission under 200ms)
      try {
        fetch(`${API_BASE}/api/orders`, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload)
        }).catch(() => {});
      } catch (_) {}

      // 3. Prepare Telegram direct contact link
      const tgSellerText = isTopup ? 'JaiGram Support' : (currentOrder.sellerName || 'JaiGram Verified');
      const tgMsg = isTopup
        ? `Hello JaiGram Support! I have requested a Wallet Recharge:%0A%0A💰 Amount: ${encodeURIComponent(amountText)}%0A💳 Method: ${encodeURIComponent((activeMethodId || 'UPI').toUpperCase())}%0A🆔 Top-up Order: ${encodeURIComponent(orderId)}${utrVal ? `%0A🔢 UTR / UPI Ref: ${encodeURIComponent(utrVal)}` : ''}%0A👤 Account: ${encodeURIComponent(custName)} (${encodeURIComponent(custEmail)})%0A%0APlease verify my screenshot and approve funds to my wallet balance.`
        : `Hello JaiGram Support! I have completed payment for my order:%0A%0A📦 Product: ${encodeURIComponent(title)}%0A🏪 Seller: ${encodeURIComponent(tgSellerText)}%0A💰 Amount: ${encodeURIComponent(amountText)}%0A💳 Method: ${encodeURIComponent((activeMethodId || 'UPI').toUpperCase())}%0A🆔 Order ID: ${encodeURIComponent(orderId)}${utrVal ? `%0A🔢 UTR / UPI Ref: ${encodeURIComponent(utrVal)}` : ''}%0A👤 Buyer: ${encodeURIComponent(orderPayload.customerName || cust.displayName || 'Customer')}%0A%0APlease verify my screenshot and provide instant access.`;
      const tgBase = gatewayConfig.telegramUrl || 'https://t.me/TRUSTED_BROTHER1234';
      const tgClean = tgBase.startsWith('http') ? tgBase.replace(/\/$/, '') : `https://t.me/${tgBase.replace(/^@/, '')}`;
      const tgUrl = `${tgClean}?text=${tgMsg}`;

      // Update success screen
      const idEl = document.getElementById('lgwSuccessOrderId');
      const pkgEl = document.getElementById('lgwSuccessPackage');
      const amtEl = document.getElementById('lgwSuccessAmount');
      const tgBtn = document.getElementById('lgwSuccessTgBtn');

      if (idEl) idEl.textContent = orderId;
      if (pkgEl) pkgEl.textContent = title;
      if (amtEl) amtEl.textContent = amountText;
      if (tgBtn) tgBtn.href = tgUrl;

      // Keep button disabled after successful submission (prevent re-submit)
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
        submitBtn.style.pointerEvents = 'none';
        submitBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Order Submitted Successfully';
      }

      this.showView('success');

      if (typeof window.confetti === 'function') {
        try {
          window.confetti({ particleCount: 90, spread: 80, origin: { y: 0.6 } });
        } catch (_) {}
      }

      window.dispatchEvent(new CustomEvent('jaigram:order-placed', { detail: orderPayload }));
      window.dispatchEvent(new CustomEvent('linkadda:order-placed', { detail: orderPayload }));
    },

    payWithWallet: async function() {
      const cust = getCustomerSession();
      if (!cust || !cust.email) {
        alert('Please login with your customer account to pay using wallet balance.');
        return;
      }
      const inrVal = parseMoney(currentOrder.inr || currentOrder.price || currentOrder.amount || 399);
      const uid = cust.uid || cust.email || '';

      // Live Anti-Tampering Check: Verify authoritative balance directly from Firebase RTDB
      let realServerBal = getCustomerWalletBalance();
      if (uid) {
        try {
          const snap = await fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(uid)}.json?_t=${Date.now()}`);
          if (snap.ok) {
            const dbCust = await snap.json();
            if (dbCust && dbCust.walletBalance !== undefined) {
              realServerBal = parseFloat(dbCust.walletBalance) || 0;
            }
          }
        } catch (_) {}
      }

      if (realServerBal < inrVal) {
        alert(`Insufficient wallet balance.\n\nYour Verified Balance: ₹${realServerBal.toFixed(2)}\nRequired for Purchase: ₹${inrVal.toFixed(2)}\n\nPlease recharge your wallet to continue.`);
        // Sync local storage back to real server balance so client cannot fake balance
        localStorage.setItem('jaigram_wallet_' + uid, realServerBal.toFixed(2));
        localStorage.setItem('linkadda_wallet_' + uid, realServerBal.toFixed(2));
        cust.walletBalance = realServerBal;
        localStorage.setItem('jaigram_customer_session', JSON.stringify(cust));
        localStorage.setItem('linkadda_customer_session', JSON.stringify(cust));
        return;
      }

      // Calculate exact balance after deduction (e.g. 500 - 300 = 200)
      const newBal = Number(Math.max(0, realServerBal - inrVal).toFixed(2));

      // 1. Immediately sync updated balance to Firebase RTDB nodes
      if (uid) {
        try {
          fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(uid)}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletBalance: newBal, updatedAt: Date.now() })
          }).catch(() => {});
          fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/events/customers/${encodeURIComponent(uid)}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletBalance: newBal, updatedAt: Date.now() })
          }).catch(() => {});
        } catch (_) {}
      }

      // 2. Update local storage and session
      localStorage.setItem('jaigram_wallet_' + uid, newBal.toFixed(2));
      localStorage.setItem('linkadda_wallet_' + uid, newBal.toFixed(2));
      cust.walletBalance = newBal;
      localStorage.setItem('jaigram_customer_session', JSON.stringify(cust));
      localStorage.setItem('linkadda_customer_session', JSON.stringify(cust));

      // Create instant completed order
      const orderId = '#JG-' + Math.floor(100000 + Math.random() * 900000);
      const cleanOrderId = orderId.replace(/^#+/, '').replace(/[^a-zA-Z0-9_-]/g, '').trim();
      const rawTitle = currentOrder.title || currentOrder.name || currentOrder.productName || 'VIP Digital Access';
      const title = sanitizeProductTitle(rawTitle);
      const now = Date.now();

      // 3. Record permanent DEBIT transaction in Firebase RTDB
      const debitTxId = `tx_debit_${cleanOrderId}`;
      const debitTx = {
        id: debitTxId,
        orderId: orderId,
        type: 'debit',
        amount: inrVal,
        balanceAfter: newBal,
        desc: `Purchased ${title} (${orderId})`,
        description: `Purchased ${title} (${orderId})`,
        date: new Date(now).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        timestamp: now,
        status: 'completed'
      };

      if (uid) {
        try {
          fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(uid)}/wallet_transactions/${debitTxId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(debitTx)
          }).catch(() => {});
          fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/events/customers/${encodeURIComponent(uid)}/wallet_transactions/${debitTxId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(debitTx)
          }).catch(() => {});
        } catch (_) {}
      }

      // Record transaction locally
      try {
        ['linkadda_wallet_tx_' + uid, 'jaigram_wallet_tx_' + uid].forEach(txKey => {
          let txs = [];
          const raw = localStorage.getItem(txKey);
          if (raw) txs = JSON.parse(raw);
          if (!Array.isArray(txs)) txs = [];
          txs = txs.filter(t => t.id !== debitTxId);
          txs.unshift(debitTx);
          localStorage.setItem(txKey, JSON.stringify(txs.slice(0, 50)));
        });
      } catch (_) {}

      // 4. Record customer notification in RTDB
      const notifId = `notif_order_${cleanOrderId}`;
      const orderNotif = {
        id: notifId,
        type: 'wallet_debited',
        orderId: orderId,
        title: `🛍️ Order Placed via Wallet (₹${inrVal.toFixed(2)})`,
        message: `₹${inrVal.toFixed(2)} debited for "${title}". Remaining wallet balance: ₹${newBal.toFixed(2)}.`,
        desc: `₹${inrVal.toFixed(2)} debited for "${title}". Remaining wallet balance: ₹${newBal.toFixed(2)}.`,
        actionUrl: 'user/index.html#orders',
        actionText: 'View Order',
        timestamp: now,
        date: new Date(now).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        read: false,
        unread: true
      };
      if (uid) {
        try {
          fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/customers/${encodeURIComponent(uid)}/notifications/${notifId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderNotif)
          }).catch(() => {});
          fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/events/customers/${encodeURIComponent(uid)}/notifications/${notifId}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderNotif)
          }).catch(() => {});
          ['jaigram_user_notifications', 'linkadda_user_notifications', 'jaigram_user_notifications_' + uid, 'linkadda_user_notifications_' + uid].forEach(nk => {
            let nList = [];
            try { const r = localStorage.getItem(nk); if (r) nList = JSON.parse(r); } catch(_) {}
            if (!Array.isArray(nList)) nList = [];
            nList.unshift(orderNotif);
            localStorage.setItem(nk, JSON.stringify(nList.slice(0, 50)));
          });
        } catch (_) {}
      }

      const orderPayload = {
        orderId,
        id: cleanOrderId,
        displayOrderId: orderId,
        productId: currentOrder.productId || currentOrder.id || null,
        productName: title,
        title: title,
        name: title,
        amount: inrVal,
        amountDisplay: `₹${inrVal.toFixed(2)}`,
        currency: 'INR',
        paymentMethod: 'JaiGram Wallet',
        method: 'JaiGram Wallet',
        status: 'completed',
        orderStatus: 'completed',
        paymentStatus: 'completed',
        customerUid: uid,
        customerEmail: cust.email,
        customerName: cust.displayName || cust.name || 'Customer',
        sellerId: currentOrder.sellerId || '',
        sellerName: currentOrder.sellerName || 'Trusted brother',
        createdAt: now,
        timestamp: now,
        date: new Date(now).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      };

      // Submit completed order to RTDB
      try {
        fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/orders/${encodeURIComponent(cleanOrderId)}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload)
        }).catch(() => {});
        fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/events/orders/${encodeURIComponent(cleanOrderId)}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload)
        }).catch(() => {});
        fetch(`https://linkadda-cd1da-default-rtdb.firebaseio.com/order_approvals/${encodeURIComponent(cleanOrderId)}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload)
        }).catch(() => {});
        fetch(`${API_BASE}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload)
        }).catch(() => {});
      } catch (_) {}

      // Save to customer order history
      try {
        ['jaigram_user_orders', 'jaigram_customer_orders', 'jaigram_customer_orders_' + uid, 'linkadda_user_orders', 'linkadda_customer_orders', 'linkadda_customer_orders_' + uid].forEach(key => {
          let list = [];
          try {
            const raw = localStorage.getItem(key);
            if (raw) list = JSON.parse(raw);
          } catch (_) {}
          if (!Array.isArray(list)) list = [];
          list.unshift(orderPayload);
          localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
        });
      } catch (_) {}

      // Update success screen
      const idEl = document.getElementById('lgwSuccessOrderId');
      const pkgEl = document.getElementById('lgwSuccessPackage');
      const amtEl = document.getElementById('lgwSuccessAmount');
      const tgBtn = document.getElementById('lgwSuccessTgBtn');

      if (idEl) idEl.textContent = orderId;
      if (pkgEl) pkgEl.textContent = title;
      if (amtEl) amtEl.textContent = `₹${inrVal.toFixed(2)}`;
      if (tgBtn) tgBtn.href = gatewayConfig.telegramUrl || 'https://t.me/TRUSTED_BROTHER1234';

      this.showView('success');

      if (typeof window.confetti === 'function') {
        try {
          window.confetti({ particleCount: 90, spread: 80, origin: { y: 0.6 } });
        } catch (_) {}
      }

      window.dispatchEvent(new CustomEvent('jaigram:order-placed', { detail: orderPayload }));
      window.dispatchEvent(new CustomEvent('linkadda:order-placed', { detail: orderPayload }));
    }
  };

  // Expose both JaiGramGateway and LinkAddaGateway for 100% backward & forward compatibility
  window.JaiGramGateway = window.LinkAddaGateway;

  // Immediate initialize on script load
  refreshGatewayConfig();
})();
