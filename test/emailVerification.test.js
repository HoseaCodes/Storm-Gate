// Email verification (6-digit code) and the email integrator's API key.
//
// Sign-up approved addresses without checking them. New accounts now start
// unverified and are emailed a code; accounts created before this have no
// `emailVerified` value and count as verified. Separately, the integrator began
// requiring an X-API-Key header that Storm Gate never sent, so every email
// since 2026-09-25 was rejected.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

const { FakeUser, saved } = vi.hoisted(() => {
  const saved = [];
  class FakeUser {
    constructor(data) {
      Object.assign(this, data);
      this._id = 'new-user-id';
    }
    async save() {
      saved.push(this);
      return this;
    }
  }
  FakeUser.findOne = vi.fn();
  return { FakeUser, saved };
});

const sendVerificationCodeEmail = vi.fn(async () => true);

vi.mock('../src/models/user.js', () => ({ default: FakeUser }));
vi.mock('../src/models/blogUser.js', () => ({ default: class extends FakeUser {} }));
vi.mock('../src/models/unregisteredUser.js', () => ({ default: class {} }));
vi.mock('../src/utils/email.js', () => ({
  sendVerificationCodeEmail: (...args) => sendVerificationCodeEmail(...args),
  sendApprovalEmail: vi.fn(async () => true),
  sendRegistrationPendingEmail: vi.fn(async () => true),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('../src/utils/sessionRefreshStore.js', () => ({
  SESSION_REFRESH_TTL_SECONDS: 30 * 24 * 60 * 60,
  issueRefreshToken: vi.fn(async () => 'issued-refresh-token'),
  rotateRefreshToken: vi.fn(),
  revokeRefreshFamily: vi.fn(),
  revokeAllForUser: vi.fn(async () => 0),
}));

const verification = await import('../src/utils/emailVerification.js');
const { verifyEmail, resendVerification, INVALID_CODE, RESEND_ACK } = await import('../src/controllers/emailVerification.js');
const authCtrl = (await import('../src/controllers/auth.js')).default;
const userCtrl = (await import('../src/controllers/user.js')).default;
const { integratorHeaders, integratorBaseUrl } = await import('../src/emailIntegrator/deletage.js');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.cookie = vi.fn(() => res);
  return res;
}

/** An unverified user holding a known code, as sign-up would leave them. */
function pendingUser(overrides = {}) {
  const { code, fields } = verification.newVerificationCode();
  const user = new FakeUser({ email: 'new@example.com', name: 'New', ...fields, ...overrides });
  return { user, code };
}

let env;
beforeEach(() => {
  env = { ...process.env };
  saved.length = 0;
  vi.clearAllMocks();
  FakeUser.findOne.mockReset();
  process.env.ACCESS_TOKEN_SECRET = 'test-secret';
  process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
  delete process.env.JWT_SIGNING_ALG;
  delete process.env.APPROVAL_REQUIRED_APPLICATIONS;
});
afterEach(() => { process.env = env; });

describe('codes', () => {
  it('are six digits and stored only as a keyed hash', () => {
    const { code, fields } = verification.newVerificationCode();

    expect(code).toMatch(/^\d{6}$/);
    expect(fields.emailVerified).toBe(false);
    expect(fields.emailVerificationCodeHash).not.toContain(code);
    expect(fields.emailVerificationCodeHash).not.toBe(crypto.createHash('sha256').update(code).digest('hex'));
  });

  it('verify the right code and clear it', () => {
    const { user, code } = pendingUser();

    expect(verification.checkVerificationCode(user, code)).toBe('verified');
    expect(user).toMatchObject({ emailVerified: true, emailVerificationCodeHash: null, emailVerificationAttempts: 0 });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('count wrong attempts and stop accepting after five, even the right code', () => {
    const { user, code } = pendingUser();
    for (let i = 0; i < verification.MAX_CODE_ATTEMPTS; i += 1) {
      expect(verification.checkVerificationCode(user, '000000' === code ? '111111' : '000000')).toBe('invalid');
    }

    expect(verification.checkVerificationCode(user, code)).toBe('invalid');
    expect(user.emailVerified).toBe(false);
  });

  it('expire after 15 minutes', () => {
    const { user, code } = pendingUser();

    expect(verification.checkVerificationCode(user, code, Date.now() + verification.CODE_TTL_MS + 1)).toBe('invalid');
  });

  it('treat accounts from before verification existed as verified', () => {
    expect(verification.isEmailVerified({ email: 'old@example.com' })).toBe(true);
    expect(verification.isEmailVerified({ emailVerified: false })).toBe(false);
  });
});

describe('POST /auth/verify-email', () => {
  const verify = async (body) => {
    const res = mockRes();
    await verifyEmail({ body }, res);
    return res;
  };

  it('verifies with the right code', async () => {
    const { user, code } = pendingUser();
    FakeUser.findOne.mockResolvedValue(user);

    const res = await verify({ email: user.email, code });

    expect(res.statusCode).toBe(200);
    expect(res.body.emailVerified).toBe(true);
    expect(saved).toContain(user);
  });

  it('records a failed attempt', async () => {
    const { user, code } = pendingUser();
    FakeUser.findOne.mockResolvedValue(user);

    const res = await verify({ email: user.email, code: code === '000000' ? '111111' : '000000' });

    expect(res.statusCode).toBe(400);
    expect(user.emailVerificationAttempts).toBe(1);
    expect(saved).toContain(user);
  });

  it.each([
    ['an unknown email', null],
    ['an already-verified account', new FakeUser({ email: 'v@example.com', emailVerified: true })],
    ['a legacy account', new FakeUser({ email: 'old@example.com' })],
  ])('answers %s exactly like a wrong code', async (_label, user) => {
    FakeUser.findOne.mockResolvedValue(user);

    const res = await verify({ email: 'someone@example.com', code: '123456' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ msg: INVALID_CODE });
  });

  it('rejects a query-operator email without looking it up', async () => {
    const res = await verify({ email: { $ne: null }, code: '123456' });

    expect(res.statusCode).toBe(400);
    expect(FakeUser.findOne).not.toHaveBeenCalled();
  });
});

describe('POST /auth/resend-verification', () => {
  const resend = async (email) => {
    const res = mockRes();
    await resendVerification({ body: { email } }, res);
    return res;
  };

  it('sends a fresh code to an unverified account and resets its attempts', async () => {
    const { user } = pendingUser({ emailVerificationAttempts: 5 });
    const oldHash = user.emailVerificationCodeHash;
    FakeUser.findOne.mockResolvedValue(user);

    const res = await resend(user.email);

    expect(res.body).toEqual({ msg: RESEND_ACK });
    expect(user.emailVerificationCodeHash).not.toBe(oldHash);
    expect(user.emailVerificationAttempts).toBe(0);
    expect(sendVerificationCodeEmail).toHaveBeenCalledWith(expect.objectContaining({
      email: user.email,
      code: expect.stringMatching(/^\d{6}$/),
    }));
  });

  it.each([
    ['an unknown email', null],
    ['a verified account', new FakeUser({ email: 'v@example.com', emailVerified: true })],
  ])('acknowledges %s the same way without sending anything', async (_label, user) => {
    FakeUser.findOne.mockResolvedValue(user);

    const res = await resend('someone@example.com');

    expect(res.body).toEqual({ msg: RESEND_ACK });
    expect(sendVerificationCodeEmail).not.toHaveBeenCalled();
  });
});

describe.each([
  ['controllers/user.js', () => userCtrl],
  ['controllers/auth.js', () => authCtrl],
])('%s', (_name, getCtrl) => {
  it('sign-up creates an unverified account and emails its code', async () => {
    FakeUser.findOne.mockResolvedValue(null);
    const res = mockRes();

    await getCtrl().register({ body: { name: 'N', email: 'n@example.com', password: 'long-enough-pw', application: 'manifestathletics' } }, res);

    expect(saved[0].emailVerified).toBe(false);
    expect(saved[0].emailVerificationCodeHash).toEqual(expect.any(String));
    expect(res.body).toMatchObject({ emailVerified: false, emailVerificationRequired: true });
    expect(sendVerificationCodeEmail).toHaveBeenCalledWith(expect.objectContaining({ email: 'n@example.com' }));
  });

  it('a pending sign-up is also asked to verify', async () => {
    FakeUser.findOne.mockResolvedValue(null);
    const res = mockRes();

    await getCtrl().register({ body: { name: 'N', email: 'n@example.com', password: 'long-enough-pw', application: 'blog' } }, res);

    expect(res.body).toMatchObject({ status: 'PENDING', emailVerificationRequired: true });
    expect(sendVerificationCodeEmail).toHaveBeenCalled();
  });

  it('a successful password reset marks the email verified', async () => {
    const token = 'reset-token';
    const { user } = pendingUser({
      password: 'old-hash',
      resetPasswordToken: crypto.createHash('sha256').update(token).digest('hex'),
      resetPasswordExpires: Date.now() + 60_000,
    });
    FakeUser.findOne.mockResolvedValue(user);
    const res = mockRes();

    await getCtrl().resetPassword({ params: { token }, body: { password: 'brand-new-password' } }, res);

    expect(res.statusCode).toBe(200);
    expect(user.emailVerified).toBe(true);
  });
});

describe('email integrator requests', () => {
  it('carry the X-API-Key header when configured', () => {
    process.env.EMAIL_INTEGRATOR_API_KEY = 'integrator-key';

    expect(integratorHeaders()).toEqual({ 'X-API-Key': 'integrator-key' });
  });

  it('send no header (and log it) when the key is missing', () => {
    delete process.env.EMAIL_INTEGRATOR_API_KEY;

    expect(integratorHeaders()).toEqual({});
  });

  it('use EMAIL_INTEGRATOR_BASE_URL when set', () => {
    process.env.EMAIL_INTEGRATOR_BASE_URL = 'https://email.example.com/';

    expect(integratorBaseUrl()).toBe('https://email.example.com');
  });
});
