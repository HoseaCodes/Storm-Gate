// Reset links were built from one BASE_URL: Storm Gate's own API address in
// production (no page there, so every link 404'd) and localhost on staging.
// They now point at the web app the account belongs to, configured for every
// application the same way through APP_BASE_URLS.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const sendPasswordReset = vi.fn(async () => ({ success: true, messageId: 'm-1' }));
vi.mock('../src/emailIntegrator/deletage.js', () => ({
  default: { sendPasswordReset: (...args) => sendPasswordReset(...args) },
}));

const { appBaseUrl } = await import('../src/utils/appUrls.js');
const { sendPasswordResetEmail } = await import('../src/utils/email.js');

const APPS = {
  manifestathletics: 'https://manifestathletics.com',
  blog: 'https://blog.example.com/',
  'ambitious-admin': 'https://admin.example.com',
};

let env;
beforeEach(() => {
  env = { ...process.env };
  process.env.APP_BASE_URLS = JSON.stringify(APPS);
  delete process.env.BASE_URL;
  vi.clearAllMocks();
});
afterEach(() => { process.env = env; });

describe('appBaseUrl', () => {
  it.each(Object.entries(APPS))('sends %s accounts to their own origin', (application, origin) => {
    expect(appBaseUrl(application)).toBe(origin.replace(/\/$/, ''));
  });

  it('special-cases no application: an unlisted one falls back to BASE_URL', () => {
    delete process.env.APP_BASE_URLS;
    process.env.BASE_URL = 'https://fallback.example.com';

    expect(appBaseUrl('manifestathletics')).toBe('https://fallback.example.com');
    expect(appBaseUrl('something-else')).toBe('https://fallback.example.com');
    expect(appBaseUrl(undefined)).toBe('https://fallback.example.com');
  });

  it('keeps no application-specific URLs in the code', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/utils/appUrls.js'), 'utf8');
    const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

    expect(code).not.toMatch(/https?:\/\/(?!localhost)/);
  });

  it('ignores APP_BASE_URLS that is not valid JSON', () => {
    process.env.APP_BASE_URLS = '{not json';
    process.env.BASE_URL = 'https://fallback.example.com';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(appBaseUrl('blog')).toBe('https://fallback.example.com');
    spy.mockRestore();
  });
});

describe('sendPasswordResetEmail', () => {
  it.each(Object.entries(APPS))('links %s accounts to their own app', async (application, origin) => {
    await sendPasswordResetEmail({ email: 'a@example.com', name: 'A', resetToken: 'tok123', application });

    expect(sendPasswordReset).toHaveBeenCalledWith(expect.objectContaining({
      resetUrl: `${origin.replace(/\/$/, '')}/reset-password/tok123`,
      expiryTime: '20 minutes',
    }));
  });
});
