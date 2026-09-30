/**
 * JaiGram Shop — Progressive Web App (PWA) Controller
 * Handles Service Worker, App Install Prompts, Splash Screen, and Persistent Auth
 */

(function () {
  'use strict';

  let deferredInstallPrompt = null;
  const DISMISS_KEY = 'jaigram_pwa_dismissed';
  const INSTALLED_KEY = 'jaigram_pwa_installed';
  const USER_BANNER_DISMISS_KEY = 'jaigram_user_banner_dismissed';
  const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours dismissal cooldown

  // 1. Detect Standalone / Already Installed PWA Mode
  function isRunningStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://') ||
      window.location.search.includes('source=pwa') ||
      localStorage.getItem(INSTALLED_KEY) === 'true'
    );
  }

  // 2. Detect iOS Safari
  function isIosDevice() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !window.MSStream &&
      !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)
    );
  }

  // 3. Register Service Worker (HTTP/HTTPS only)
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('PWA: Service Worker registered, scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('PWA: Service Worker registration notice:', err);
        });
    });
  }

  // 4. Clean up any installed banners if already running in standalone or marked installed
  function cleanUpInstalledUi() {
    if (isRunningStandalone()) {
      const banner = document.getElementById('userDashboardPwaBanner');
      if (banner) banner.remove();
      const navBtn = document.getElementById('navInstallAppBtn');
      if (navBtn) navBtn.remove();
      const card = document.getElementById('jaigramPwaPopupCard');
      if (card) card.remove();
    }
    if (localStorage.getItem(USER_BANNER_DISMISS_KEY) === 'true') {
      const banner = document.getElementById('userDashboardPwaBanner');
      if (banner) banner.remove();
    }
  }

  // 5. Capture native beforeinstallprompt event
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent mini-infobar from appearing on mobile
    e.preventDefault();
    deferredInstallPrompt = e;
    window.jaigramInstallPromptReady = true;
    window.dispatchEvent(new CustomEvent('jaigram_install_ready'));
    console.log('PWA: Native install prompt captured & ready.');
  });

  // 6. Handle appinstalled event (User downloaded app -> Completely disappear)
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    localStorage.setItem(INSTALLED_KEY, 'true');
    hideInstallPopup();
    cleanUpInstalledUi();
    console.log('PWA: JaiGram Shop app installed successfully!');
  });

  // 7. Universal Trigger for App Installation
  window.triggerPwaInstall = async function () {
    if (deferredInstallPrompt) {
      try {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        console.log('PWA: User choice:', choice.outcome);
        if (choice.outcome === 'accepted') {
          localStorage.setItem(INSTALLED_KEY, 'true');
          hideInstallPopup();
          cleanUpInstalledUi();
        }
        deferredInstallPrompt = null;
      } catch (err) {
        console.warn('PWA install prompt error:', err);
      }
    } else if (isIosDevice()) {
      showIosGuide();
    } else {
      // Direct instructions for Android Chrome / Desktop
      alert('To install JaiGram Shop App:\n1. Tap the three dots (⋮) menu in your browser\n2. Select "Add to Home screen" or "Install App"');
    }
  };

  // 8. Inject & Show First-Visit Install Popup (Ultra-sleek native floating banner)
  function injectInstallPopup() {
    if (document.getElementById('jaigramPwaPopupCard')) return;

    // Compact floating app install pill / bar
    const card = document.createElement('div');
    card.id = 'jaigramPwaPopupCard';
    card.className = 'jaigram-pwa-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-label', 'Install JaiGram App');
    card.innerHTML = `
      <div class="pwa-card-main-row">
        <div class="pwa-card-brand">
          <div class="pwa-card-icon-wrap">
            <img src="/images/pwa-icon.svg" alt="JaiGram App" class="pwa-card-icon" onerror="this.src='/images/pwa-icon-192.jpg'" />
          </div>
          <div class="pwa-card-meta">
            <div class="pwa-card-title">
              <span>JaiGram App</span>
              <span class="pwa-badge-verified"><i class="fa-solid fa-circle-check"></i> Free</span>
            </div>
            <div class="pwa-card-sub">Instant Vault &bull; 1-Tap Downloads &bull; 2 MB</div>
          </div>
        </div>
        <div class="pwa-card-actions">
          <button type="button" class="pwa-btn-install" id="pwaCardInstallBtn">
            <i class="fa-solid fa-download"></i> Install
          </button>
          <button type="button" class="pwa-close-btn" id="pwaCloseCardBtn" aria-label="Dismiss">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(card);

    // Event listeners
    document.getElementById('pwaCardInstallBtn')?.addEventListener('click', () => {
      window.triggerPwaInstall();
    });

    const closeHandler = () => {
      hideInstallPopup();
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    };

    document.getElementById('pwaCloseCardBtn')?.addEventListener('click', closeHandler);
  }

  function showInstallPopup() {
    if (isRunningStandalone()) return;
    if (localStorage.getItem(INSTALLED_KEY) === 'true') return;

    // Check dismissal cooldown
    const lastDismissed = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (Date.now() - lastDismissed < DISMISS_DURATION_MS) {
      return;
    }

    injectInstallPopup();
    setTimeout(() => {
      const card = document.getElementById('jaigramPwaPopupCard');
      if (card) card.classList.add('active');
    }, 100);
  }

  function hideInstallPopup() {
    const card = document.getElementById('jaigramPwaPopupCard');
    if (card) {
      card.classList.remove('active');
      setTimeout(() => card.remove(), 400);
    }
  }

  // 9. iOS Add to Home Screen Modal Guide
  function showIosGuide() {
    let guide = document.getElementById('jaigramIosModal');
    if (!guide) {
      guide = document.createElement('div');
      guide.id = 'jaigramIosModal';
      guide.className = 'pwa-ios-modal';
      guide.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <strong style="font-size:16px;">Install JaiGram on iPhone</strong>
          <button type="button" class="pwa-close-btn" id="iosGuideClose" style="width:28px;height:28px;"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="pwa-ios-step">
          <div class="pwa-ios-step-num">1</div>
          <div>Tap the <strong>Share</strong> button <i class="fa-solid fa-arrow-up-from-bracket" style="color:#ff2a85;margin-left:4px;"></i> at the bottom of Safari.</div>
        </div>
        <div class="pwa-ios-step">
          <div class="pwa-ios-step-num">2</div>
          <div>Scroll down and select <strong>"Add to Home Screen"</strong> <i class="fa-regular fa-square-plus" style="color:#ff2a85;margin-left:4px;"></i></div>
        </div>
        <div class="pwa-ios-step">
          <div class="pwa-ios-step-num">3</div>
          <div>Tap <strong>Add</strong> in the top right corner. Enjoy full screen access!</div>
        </div>
      `;
      document.body.appendChild(guide);
      document.getElementById('iosGuideClose')?.addEventListener('click', () => {
        guide.classList.remove('active');
      });
    }
    guide.classList.add('active');
  }

  // 10. Native App Splash Screen (Luxury Cinematic Experience)
  function createSplashElement() {
    const splash = document.createElement('div');
    splash.id = 'jaigramPwaSplash';
    splash.className = 'jaigram-pwa-splash';
    splash.innerHTML = `
      <div class="splash-ambient-aura primary"></div>
      <div class="splash-ambient-aura secondary"></div>
      
      <div class="splash-particles">
        <span class="p-dot p1"></span>
        <span class="p-dot p2"></span>
        <span class="p-dot p3"></span>
        <span class="p-dot p4"></span>
        <span class="p-dot p5"></span>
        <span class="p-dot p6"></span>
      </div>

      <div class="pwa-splash-content">
        <div class="pwa-splash-icon-wrapper">
          <div class="splash-ripple ring-1"></div>
          <div class="splash-ripple ring-2"></div>
          <div class="splash-ripple ring-3"></div>
          
          <div class="splash-icon-card">
            <img src="/images/pwa-icon-512.jpg" alt="JaiGram" class="pwa-splash-icon" onerror="this.src='/images/pwa-icon.svg'" />
            <div class="splash-icon-glint"></div>
          </div>
        </div>

        <div class="pwa-splash-brand">
          <div class="pwa-splash-kicker">
            <span class="kicker-pulse-dot"></span>
            <span>OFFICIAL DIGITAL MARKETPLACE</span>
          </div>
          <h1 class="pwa-splash-title">
            JAI<span class="brand-gradient">GRAM</span> <span class="brand-subtag">SHOP</span>
          </h1>
          <p class="pwa-splash-sub">VIP CONTENT VAULT • 100% PRIVATE &amp; ENCRYPTED</p>
        </div>

        <div class="pwa-splash-loader-box">
          <div class="splash-progress-track">
            <div class="splash-progress-bar" id="splashProgressBar"></div>
            <div class="splash-progress-laser" id="splashProgressLaser"></div>
          </div>
          <div class="splash-loader-meta">
            <span class="splash-status-text" id="splashStatusText">Initializing secure vault...</span>
            <span class="splash-percent-text" id="splashPercentText">0%</span>
          </div>
        </div>
      </div>

      <div class="pwa-splash-footer">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <span>End-to-End Encrypted Cloud Infrastructure</span>
      </div>
    `;
    return splash;
  }

  function runSplashProgress(splash, duration = 1400, onComplete) {
    const bar = splash.querySelector('#splashProgressBar');
    const laser = splash.querySelector('#splashProgressLaser');
    const statusText = splash.querySelector('#splashStatusText');
    const percentText = splash.querySelector('#splashPercentText');
    
    let currentPercent = 0;
    const startTime = performance.now();

    function updateProgress(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Smooth ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      currentPercent = Math.min(Math.round(eased * 100), 100);

      if (bar) bar.style.width = currentPercent + '%';
      if (laser) laser.style.left = currentPercent + '%';
      if (percentText) percentText.textContent = currentPercent + '%';

      if (statusText) {
        if (currentPercent < 28) {
          statusText.textContent = 'Connecting to secure cloud...';
        } else if (currentPercent < 64) {
          statusText.textContent = 'Decrypting premium collections...';
        } else if (currentPercent < 95) {
          statusText.textContent = 'Verifying VIP credentials...';
        } else {
          statusText.textContent = 'Vault unlocked • Welcome!';
        }
      }

      if (progress < 1) {
        requestAnimationFrame(updateProgress);
      } else {
        setTimeout(() => {
          splash.classList.add('hide-splash');
          setTimeout(() => {
            splash.remove();
            if (typeof onComplete === 'function') onComplete();
          }, 500);
        }, 180);
      }
    }

    requestAnimationFrame(updateProgress);
  }

  function showJaiGramSplash(customDuration = 1400, callback) {
    const existing = document.getElementById('jaigramPwaSplash');
    if (existing) existing.remove();

    const splash = createSplashElement();
    document.body.appendChild(splash);
    runSplashProgress(splash, customDuration, callback);
    return splash;
  }

  window.showJaiGramSplash = showJaiGramSplash;

  function initSplashScreen() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         window.navigator.standalone === true ||
                         document.referrer.includes('android-app://') ||
                         window.location.search.includes('source=pwa');
    const isPreview = window.location.search.includes('splash') || window.location.hash.includes('splash');

    if (!isStandalone && !isPreview) return;

    const splash = createSplashElement();
    document.body.appendChild(splash);

    // Let page load while running progress
    let pageLoaded = document.readyState === 'complete';
    if (!pageLoaded) {
      window.addEventListener('load', () => { pageLoaded = true; });
    }

    runSplashProgress(splash, 1300, () => {
      try { sessionStorage.setItem('jaigram_splash_shown', 'true'); } catch (_) {}
    });
  }

  // 11. Dual-Key Auth Synchronization Watchdog (Permanent Login Guarantee)
  function syncCustomerSessions() {
    try {
      const jg = localStorage.getItem('jaigram_customer_session');
      const la = localStorage.getItem('linkadda_customer_session');
      if (jg && !la) {
        localStorage.setItem('linkadda_customer_session', jg);
      } else if (la && !jg) {
        localStorage.setItem('jaigram_customer_session', la);
      }
    } catch (_) {}
  }

  window.cleanUpInstalledUi = cleanUpInstalledUi;

  // 12. Auto-Initialize on DOM Ready
  document.addEventListener('DOMContentLoaded', () => {
    syncCustomerSessions();
    cleanUpInstalledUi();
    initSplashScreen();

    const path = (window.location.pathname || '').toLowerCase();
    const isRootStorefront = (path === '/' || path === '' || path.endsWith('/index.html')) &&
      !path.includes('/user') &&
      !path.includes('/admin') &&
      !path.includes('/seller') &&
      !path.includes('/payment');

    // Direct standalone PWA users with active customer session to User Dashboard
    if (isRootStorefront && isRunningStandalone()) {
      try {
        const rawCust = localStorage.getItem('jaigram_customer_session') || localStorage.getItem('linkadda_customer_session');
        const parsed = rawCust ? JSON.parse(rawCust) : null;
        const allowShowcase = window.location.search.includes('showcase=1') || window.location.search.includes('browse=1');
        if (parsed && (parsed.email || parsed.uid) && !allowShowcase) {
          window.location.replace('/user/index.html' + (window.location.hash || ''));
          return;
        }
      } catch (_) {}
    }

    // Trigger first-visit popup after 2 seconds on ROOT STOREFRONT ONLY (Never inside user portal or admin!)
    if (isRootStorefront) {
      setTimeout(showInstallPopup, 2000);
    }
  });

})();
