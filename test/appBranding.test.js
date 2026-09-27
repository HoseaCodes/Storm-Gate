// Every email used to say "Storm Gate / User Management System", whatever app
// the account belonged to. Emails now carry the branding configured for the
// account's application in APP_NAMES; no app is named in code.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const delegate = vi.hoisted(() => {
  const ok = async () => ({ success: true, messageId: 'm-1' });
  return {
    sendApprovalRequest: vi.fn(ok),
    sendAccountApproved: vi.fn(ok),
    sendAccountDenied: vi.fn(ok),
    sendRegistrationPending: vi.fn(ok),
    sendPasswordReset: vi.fn(ok),
    sendEmailVerification: vi.fn(ok),
  };
});
vi.mock('../src/emailIntegrator/deletage.js', () => ({ default: delegate }));

const { appBranding } = await import('../src/utils/appUrls.js');
const email = await import('../src/utils/email.js');

let env;
beforeEach(() => {
  env = { ...process.env };
  process.env.APP_NAMES = JSON.stringify({
    physiquepro: 'PhysiquePro AI',
    blog: { name: 'HoseaCodes', tagline: 'Engineering blog' },
  });
  process.env.ADMIN_EMAIL = 'admin@example.com';
  vi.clearAllMocks();
});
afterEach(() => { process.env = env; });

describe('appBranding', () => {
  it('uses a plain name for both header and tagline', () => {
    expect(appBranding('physiquepro')).toEqual({ appName: 'PhysiquePro AI', appDisplayName: 'PhysiquePro AI' });
  });

  it('uses an explicit tagline when given', () => {
    expect(appBranding('blog')).toEqual({ appName: 'HoseaCodes', appDisplayName: 'Engineering blog' });
  });

  it('keeps the Storm Gate wording for unlisted apps and bad config', () => {
    const storm = { appName: 'Storm Gate', appDisplayName: 'User Management System' };
    expect(appBranding('unlisted')).toEqual(storm);
    expect(appBranding(undefined)).toEqual(storm);

    process.env.APP_NAMES = '{not json';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(appBranding('physiquepro')).toEqual(storm);
    spy.mockRestore();
  });
});

describe('every email carries the account\'s branding', () => {
  const user = { email: 'u@example.com', name: 'U', application: 'physiquepro' };
  const branded = expect.objectContaining({ appName: 'PhysiquePro AI', appDisplayName: 'PhysiquePro AI' });

  it.each([
    ['verification code', () => email.sendVerificationCodeEmail({ ...user, code: '123456' }), 'sendEmailVerification'],
    ['password reset', () => email.sendPasswordResetEmail({ ...user, resetToken: 't' }), 'sendPasswordReset'],
    ['registration pending', () => email.sendRegistrationPendingEmail(user), 'sendRegistrationPending'],
    ['account approved', () => email.sendAccountApprovedEmail(user), 'sendAccountApproved'],
    ['account denied', () => email.sendAccountDeniedEmail(user), 'sendAccountDenied'],
  ])('%s', async (_label, send, method) => {
    await send();

    expect(delegate[method]).toHaveBeenCalledWith(branded);
  });
});
