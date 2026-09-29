/**
 * JaiGram Shop — Progressive Web App (PWA) Controller
 * Handles Service Worker, App Install Prompts, Splash Screen, and Persistent Auth
 */

(function () {
  'use strict';

  let deferredInstallPrompt = null;
  const DISMISS_KEY = 'jaigram_pwa_dismissed';
  const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours dismissal cooldown

  // 1. Detect Standalone / Already Installed PWA Mode
  function isRunningStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://') ||
      window.location.search.includes('source=pwa')
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

  // 3. Register Service Worker
  if ('serviceWorker' in navigator) {
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

  // 4. Capture native beforeinstallprompt event
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    deferredInstallPrompt = e;
    window.jaigramInstallPromptReady = true;
    window.dispatchEvent(new CustomEvent('jaigram_install_ready'));
    console.log('PWA: Native install prompt captured & ready.');
  });

  // 5. Handle appinstalled event
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    localStorage.setItem('jaigram_pwa_installed', 'true');
    hideInstallPopup();
    const banner = document.getElementById('jaigramUserPwaBanner');
    if (banner) banner.style.display = 'none';
    console.log('PWA: JaiGram Shop app installed successfully!');
  });

  // 6. Universal Trigger for App Installation
  window.triggerPwaInstall = async function () {
    if (deferredInstallPrompt) {
      try {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        console.log('PWA: User choice:', choice.outcome);
        if (choice.outcome === 'accepted') {
          hideInstallPopup();
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

  // 7. Inject & Show First-Visit Install Popup
  function injectInstallPopup() {
    if (document.getElementById('jaigramPwaPopupCard')) return;

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'jaigramPwaBackdrop';
    backdrop.className = 'jaigram-pwa-popup-backdrop';

    // Card
    const card = document.createElement('div');
    card.id = 'jaigramPwaPopupCard';
    card.className = 'jaigram-pwa-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.innerHTML = `
      <div class="pwa-card-header">
        <div class="pwa-card-brand">
          <img src="/images/pwa-icon.svg" alt="JaiGram App" class="pwa-card-icon" onerror="this.src='/images/pwa-icon-192.jpg'" />
          <div class="pwa-card-meta">
            <div class="pwa-card-title">
              JaiGram Shop <span class="pwa-badge-verified">OFFICIAL</span>
            </div>
            <div class="pwa-card-sub">Fast, Secure & Discrete Digital Vault</div>
          </div>
        </div>
        <button type="button" class="pwa-close-btn" id="pwaCloseCardBtn" aria-label="Cancel">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="pwa-card-features">
        <div class="pwa-feature-item">
          <i class="fa-solid fa-bolt"></i> 1-Tap Cloud Downloads
        </div>
        <div class="pwa-feature-item">
          <i class="fa-solid fa-shield-halved"></i> 100% Discrete Vault
        </div>
        <div class="pwa-feature-item">
          <i class="fa-solid fa-bell"></i> VIP Drop Notifications
        </div>
        <div class="pwa-feature-item">
          <i class="fa-solid fa-lock"></i> Permanent Saved Login
        </div>
      </div>

      <div class="pwa-card-actions">
        <button type="button" class="pwa-btn-install" id="pwaCardInstallBtn">
          <i class="fa-solid fa-download"></i> Install App
        </button>
        <button type="button" class="pwa-btn-cancel" id="pwaCardCancelBtn">
          Not Now
        </button>
      </div>
    `;

    document.body.appendChild(backdrop);
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
    document.getElementById('pwaCardCancelBtn')?.addEventListener('click', closeHandler);
    backdrop.addEventListener('click', closeHandler);
  }

  function showInstallPopup() {
    if (isRunningStandalone()) return;
    if (localStorage.getItem('jaigram_pwa_installed') === 'true') return;

    // Check dismissal cooldown
    const lastDismissed = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (Date.now() - lastDismissed < DISMISS_DURATION_MS) {
      return;
    }

    injectInstallPopup();
    setTimeout(() => {
      const backdrop = document.getElementById('jaigramPwaBackdrop');
      const card = document.getElementById('jaigramPwaPopupCard');
      if (backdrop) backdrop.classList.add('active');
      if (card) card.classList.add('active');
    }, 100);
  }

  function hideInstallPopup() {
    const backdrop = document.getElementById('jaigramPwaBackdrop');
    const card = document.getElementById('jaigramPwaPopupCard');
    if (card) card.classList.remove('active');
    if (backdrop) backdrop.classList.remove('active');
  }

  // 8. iOS Add to Home Screen Modal Guide
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

  // 9. Post-Login Dashboard Banner Injection
  window.initUserDashboardPwaBanner = function (containerSelector) {
    if (isRunningStandalone()) return;
    if (localStorage.getItem('jaigram_pwa_installed') === 'true') return;

    const container = document.querySelector(containerSelector || '#dashboardMainContent, .user-content-area, .user-overview');
    if (!container || document.getElementById('jaigramUserPwaBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'jaigramUserPwaBanner';
    banner.className = 'jaigram-pwa-user-banner';
    banner.innerHTML = `
      <div class="pwa-user-banner-left">
        <img src="/images/pwa-icon.svg" alt="App" class="pwa-user-banner-icon" onerror="this.src='/images/pwa-icon-192.jpg'" />
        <div class="pwa-user-banner-text">
          <h4>Download JaiGram Shop App</h4>
          <p>Get faster 1-tap vault access and never lose your digital library.</p>
        </div>
      </div>
      <button type="button" class="pwa-user-banner-btn" id="pwaDashboardInstallBtn">
        <i class="fa-solid fa-download"></i> Install App
      </button>
    `;

    container.prepend(banner);

    document.getElementById('pwaDashboardInstallBtn')?.addEventListener('click', () => {
      window.triggerPwaInstall();
    });
  };

  // 10. Native App Splash Screen (Triggers on initial boot in standalone mode)
  function initSplashScreen() {
    if (!isRunningStandalone()) return;

    const splash = document.createElement('div');
    splash.id = 'jaigramPwaSplash';
    splash.className = 'jaigram-pwa-splash';
    splash.innerHTML = `
      <div class="pwa-splash-content">
        <img src="/images/pwa-icon.svg" alt="JaiGram" class="pwa-splash-icon" onerror="this.src='/images/pwa-icon-512.jpg'" />
        <div class="pwa-splash-title">Jai<span>Gram</span> Shop</div>
        <div class="pwa-splash-sub">SECURE • DISCRETE • CLOUD VAULT</div>
        <div class="pwa-splash-spinner"></div>
      </div>
    `;
    document.body.appendChild(splash);

    // Dismiss splash once page is ready
    window.addEventListener('load', () => {
      setTimeout(() => {
        splash.classList.add('hide-splash');
        setTimeout(() => splash.remove(), 500);
      }, 650);
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

  // 12. Auto-Initialize on DOM Ready
  document.addEventListener('DOMContentLoaded', () => {
    syncCustomerSessions();
    initSplashScreen();

    // Trigger first-visit popup after 2 seconds on storefront
    const isStorefront = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';
    if (isStorefront) {
      setTimeout(showInstallPopup, 2000);
    }
  });

})();
