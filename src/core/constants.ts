// Centralized constant collections used across the reflector++ workflow
// Keeping both array and Set forms where membership tests occur frequently.

export const COMMON_WORDS = [
  "null",
  "true",
  "false",
  "undefined",
  "invalid"
];
export const COMMON_WORDS_SET = new Set(COMMON_WORDS);

export const KEY_WORDS = [
  '\",\"',
  '<script',
  '<div',
  '""',
  '[]'
];
export const KEY_WORDS_SET = new Set(KEY_WORDS);

export const COMMON_ANALYTICS_HOSTS = [
  'google-analytics.com',
  'optimizely.com',
  'intercom.io',
  'hotjar.com',
  'segment.com',
  'facebook.com',
  'sentry.io',
  'doubleclick.net',
  'adservice.google.com',
  'heapanalytics.com',
  'ping.chartbeat.net',
  'scripts.kissmetrics.com',
  'optimizely.com',
  '2.rto.microsoft.com',
  '0stats.com',
  'ucs.query.yahoo.com',
  'udc.yahoo.com',
  'shavar.services.mozilla.com',
  'download.mozilla.org',
  'services.addons.mozilla.org',
  'classify-client.services.mozilla.com',
  'location.services.mozilla.com',
  'download-stats.mozilla.org',
  'firefox.settings.services.mozilla.com',
  'firefox-settings-attachments.cdn.mozilla.net',
  'detectportal.firefox.com',
  'versioncheck.addons.mozilla.org',
  'aus5.mozilla.org',
  'incoming.telemetry.mozilla.org',
  'fhr.cdn.mozilla.net',
  'analytics.tiktok.com',
  'mssdk-va.tiktok.com'
];
export const COMMON_ANALYTICS_HOSTS_SET = new Set(COMMON_ANALYTICS_HOSTS);

export const COMMON_ANALYTICS_ENDPOINTS = ['/socket.io/'];
export const COMMON_ANALYTICS_ENDPOINTS_SET = new Set(COMMON_ANALYTICS_ENDPOINTS);

export const NO_SNIFF_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
  'image/svg+xml',
  'text/xsl',
  'application/vnd.wap.xhtml+xml',
  'multipart/x-mixed-replace',
  'application/rdf+xml',
  'application/rdf+xml',
  'application/mathml+xml',
  'text/vtt',
  'text/cache-manifest',
  'model/vnd.usdz+zip',
  'video/mp2t'
]);
