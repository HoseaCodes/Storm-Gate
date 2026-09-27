// Where each application's web app lives, for links Storm Gate emails
// (currently the password-reset link).
//
// Reset links used to be built from a single BASE_URL. In production that was
// Storm Gate's own API address, which serves no page at /reset-password/<token>,
// so every reset link 404'd in a browser; on staging it was unset and links
// pointed at http://localhost:3001. One URL also cannot serve several apps.
//
// Links now go to the app the account was created for (its `application`),
// configured per deployment with APP_BASE_URLS, a JSON object of
// application -> origin:
//   APP_BASE_URLS={"manifestathletics":"https://manifestathletics.com","blog":"https://blog.example.com"}
// No application is special-cased in code; adding one is a config change.
// BASE_URL remains the fallback for applications not listed.
//
// Contract for every app: serve a page at `<origin>/reset-password/<token>`
// that calls POST /verify-reset-token/<token> and POST /reset-password/<token>.

function configuredAppBaseUrls() {
  const raw = process.env.APP_BASE_URLS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    console.error('APP_BASE_URLS is not valid JSON; ignoring it');
    return {};
  }
}

/** The web origin for `application`, without a trailing slash. */
export function appBaseUrl(application) {
  const urls = configuredAppBaseUrls();
  const base = (application && urls[application]) || process.env.BASE_URL || 'http://localhost:3001';
  return String(base).replace(/\/+$/, '');
}

// Branding for the emails an application's users receive (verification codes,
// password resets, approval notices). Every email used to say "Storm Gate /
// User Management System", which a customer of one of the apps would not
// recognise. Configured like APP_BASE_URLS, with APP_NAMES:
//   APP_NAMES={"manifestathletics":"Manifest Athletics","blog":{"name":"HoseaCodes","tagline":"Blog"}}
// A plain string is the name; an object may also set a tagline shown under it.
// Applications not listed keep the old Storm Gate wording.
const DEFAULT_BRANDING = { appName: 'Storm Gate', appDisplayName: 'User Management System' };

function configuredAppNames() {
  const raw = process.env.APP_NAMES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    console.error('APP_NAMES is not valid JSON; ignoring it');
    return {};
  }
}

/** { appName, appDisplayName } for the emails of `application`. */
export function appBranding(application) {
  const entry = application ? configuredAppNames()[application] : undefined;
  if (typeof entry === 'string' && entry.trim()) {
    // With no tagline, repeat the name rather than fall back to the
    // integrator's own default ("Email Integrator Service").
    return { appName: entry.trim(), appDisplayName: entry.trim() };
  }
  if (entry && typeof entry === 'object' && typeof entry.name === 'string' && entry.name.trim()) {
    const name = entry.name.trim();
    const tagline = typeof entry.tagline === 'string' && entry.tagline.trim() ? entry.tagline.trim() : name;
    return { appName: name, appDisplayName: tagline };
  }
  return { ...DEFAULT_BRANDING };
}
