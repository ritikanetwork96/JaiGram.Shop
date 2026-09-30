export const APP_CONFIG = {
  appName: 'JaiGram Admin',
  appSlug: 'jaigram-admin',
  themeKey: 'linkadda_admin_theme',
  sessionKey: 'linkadda_admin_session',
  commandKey: 'linkadda_admin_commands',
  publicBaseUrl: '/',
};

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCD_cZXyfYd01FNg-DmRpyKKBIGR3NqeT4',
  authDomain: 'linkadda-cd1da.firebaseapp.com',
  databaseURL: 'https://linkadda-cd1da-default-rtdb.firebaseio.com',
  projectId: 'linkadda-cd1da',
  storageBucket: 'linkadda-cd1da.firebasestorage.app',
  messagingSenderId: '989651324387',
  appId: '1:989651324387:web:f6e44be3daa9f4fc0c24d6',
  measurementId: 'G-PCH50PK2N7',
};

// Cloudflare R2 S3-compatible public config (No secrets on frontend!)
export const RUSTFS_CONFIG = {
  endpoint: 'https://media.jaigram.shop',
  bucket: 'linkadda-media',
  region: 'auto',
  publicUrl: 'https://media.jaigram.shop',
};
export const R2_CONFIG = RUSTFS_CONFIG;

// Supabase config retained for zero-downtime transition & backward compatibility
export const SUPABASE_CONFIG = {
  url: 'https://noecylfqhtfwbjfkjxoo.supabase.co',
  anonKey: 'sb_publishable_HHXzUZGaMXTpCXQVqiNBwQ_ZEbe_E2z',
  bucket: 'media',
};

export const RTDB_NODES = {
  hero: 'hero',
  categories: 'categories',
  products: 'products',
  events: 'events',
  banner: 'banner',
  faq: 'faq',
  testimonials: 'testimonials',
  settings: 'settings',
  payment: 'payment',
  orders: 'orders',
  analytics: 'analytics',
  media: 'media',
  visitors: 'visitors',
  reviews: 'reviews',
  customers: 'customers',
  sellers: 'events/sellers',
  seller_applications: 'events/seller_applications',
  public_sellers: 'public_sellers',
  reports: 'reports',
};

export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
  { key: 'catalog', label: 'Catalog', icon: 'package' },
  { key: 'orders', label: 'Orders', icon: 'receipt-text' },
  { key: 'reports', label: 'Reports', icon: 'flag' },
  { key: 'reviews', label: 'Reviews', icon: 'star' },
  { key: 'media', label: 'Media', icon: 'image-plus' },
  { key: 'hero', label: 'Hero', icon: 'sparkles' },
  { key: 'banner', label: 'Banner', icon: 'badge-percent' },
  { key: 'faq', label: 'FAQ', icon: 'help-circle' },
  { key: 'testimonials', label: 'Testimonials', icon: 'messages-square' },
  { key: 'settings', label: 'Settings', icon: 'settings-2' },
  { key: 'payment', label: 'Payment', icon: 'credit-card' },
  { key: 'users', label: 'Users', icon: 'users' },
  { key: 'sellers', label: 'Sellers', icon: 'store' },
  { key: 'screenshots', label: 'Screenshots', icon: 'image' },
  { key: 'analytics', label: 'Analytics', icon: 'bar-chart-3' },
];

export const DEFAULT_EMPTY = {
  title: '',
  slug: '',
  description: '',
  category: '',
  sellerName: 'JaiGram Official',
  priceINR: '',
  priceUSD: '',
  originalPriceINR: '',
  originalPriceUSD: '',
  rating: '4.9',
  reviewsCount: '',
  badge: '',
  image: '',
  images: [],
  galleryImages: [],
  video: '',
  videos: [],
  tiers: [],
  showTrustAssurance: true,
  trustTitle: 'Trust & Discrete Billing Assurance',
  trustPoint1Title: '100% Discrete Billing',
  trustPoint1Desc: 'Your bank statement or UPI app will show a neutral business descriptor. Zero adult keywords or references. 100% anonymous.',
  trustPoint2Title: 'Instant Cloud Access',
  trustPoint2Desc: 'Direct high-speed Mega.nz & Google Drive cloud folders delivered on-screen and via Telegram bot instantly.',
  trustPoint3Title: 'Lifetime Link Replacement',
  trustPoint3Desc: 'If any cloud folder ever gets expired or blocked, our 24/7 VIP helpdesk refreshes your link free forever.',
  trustPoint4Title: '',
  trustPoint4Desc: '',
  showSpecsTable: true,
  specsTitle: 'Pack Specifications',
  specResolution: '4K 2160p Ultra HD (60 FPS HDR)',
  specAudio: 'Original Studio Stereo Clear Audio',
  specDelivery: 'Mega.nz & Google Drive Direct Fast Links',
  specDevices: 'Android, iPhone (iOS), Windows PC, Mac, Smart TV',
  specAccess: 'Lifetime Cloud Access + Free Link Replacement',
  specSupport: '24/7 Instant Telegram VIP Helpdesk',
  specMediaCount: '',
  status: 'active',
  displayOrder: 0,
};
