// Password reset was broken end to end. Four separate defects, all of which
// this file would have caught:
//
//   1. `crypto` was never imported, so requestPasswordReset threw a
//      ReferenceError on its first statement — every reset returned 500.
//   2. The expiry was written to `resetPasswordExpire`; the schema field is
//      `resetPasswordExpires`. Mongoose runs strict by default, so the value was
//      silently discarded.
//   3. resetPassword's lookup filtered on the same misspelling, matching nothing.
//   4. verifyResetToken treated the token as a JWT, then bcrypt-compared it
//      against a SHA-256 digest — two incompatible schemes in one function.
//
// The model is mocked so these stay fast and need no database. What they verify
// is the part that was actually wrong: that the token minted by a request is the
// token the later steps accept, and that the fields written are the fields read.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const sendPasswordResetEmail = vi.fn();

vi.mock('../src/models/user.js', () => ({
  default: { findOne: vi.fn(), findById: vi.fn() },
}));
vi.mock('../src/models/blogUser.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../src/utils/sessionRefreshStore.js', () => ({
  SESSION_REFRESH_TTL_SECONDS: 30 * 24 * 60 * 60,
  issueRefreshToken: vi.fn(async () => 'issued-refresh-token'),
  rotateRefreshToken: vi.fn(async () => ({ status: 'invalid' })),
  revokeRefreshFamily: vi.fn(async () => 0),
  revokeAllForUser: vi.fn(async () => 0),
}));
vi.mock('../src/utils/email.js', () => ({
  sendPasswordResetEmail: (...args) => sendPasswordResetEmail(...args),
  sendApprovalEmail: vi.fn(),
  sendRegistrationPendingEmail: vi.fn(),
}));

const User = (await import('../src/models/user.js')).default;
const { revokeAllForUser } = await import('../src/utils/sessionRefreshStore.js');
const authCtrl = (await import('../src/controllers/auth.js')).default;

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}

// A stand-in user document that records what was assigned and saved.
function mockUser(overrides = {}) {
  return {
    _id: 'user-1',
    email: 'player@example.com',
    name: 'Player',
    authProvider: 'local',
    password: 'old-hash',
    resetPasswordToken: null,
    resetPasswordExpires: null,
    save: vi.fn(async function () { return this; }),
    ...overrides,
  };
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ACCESS_TOKEN_SECRET = 'test-secret';
});

describe('requestPasswordReset', () => {
  it('mints a token and stores its digest without throwing', async () => {
    const user = mockUser();
    User.findOne.mockResolvedValue(user);

    const res = mockRes();
    await authCtrl.requestPasswordReset({ body: { email: user.email } }, res);

    // Previously a ReferenceError on `crypto.randomBytes` — a 500 on every call.
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(user.save).toHaveBeenCalled();
  });

  it('stores the SHA-256 digest, never the token itself', async () => {
    const user = mockUser();
    User.findOne.mockResolvedValue(user);

    await authCtrl.requestPasswordReset({ body: { email: user.email } }, mockRes());

    const [{ resetToken }] = sendPasswordResetEmail.mock.calls[0];
    expect(resetToken).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex

    // A stolen database must not be usable to reset anyone's password.
    expect(user.resetPasswordToken).not.toBe(resetToken);
    expect(user.resetPasswordToken).toBe(sha256(resetToken));
  });

  it('persists the expiry under the field the schema actually declares', async () => {
    const user = mockUser();
    User.findOne.mockResolvedValue(user);

    await authCtrl.requestPasswordReset({ body: { email: user.email } }, mockRes());

    // The bug: written as `resetPasswordExpire`, which Mongoose dropped in
    // strict mode, so every later expiry check read undefined.
    expect(user.resetPasswordExpire).toBeUndefined();
    expect(user.resetPasswordExpires).toBeGreaterThan(Date.now());
  });

  it('does not reveal whether the email exists', async () => {
    User.findOne.mockResolvedValue(null);

    const res = mockRes();
    await authCtrl.requestPasswordReset({ body: { email: 'nobody@example.com' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.msg).toMatch(/if an account with that email exists/i);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('refuses accounts managed by Azure AD', async () => {
    User.findOne.mockResolvedValue(mockUser({ authProvider: 'azure-ad' }));

    const res = mockRes();
    await authCtrl.requestPasswordReset({ body: { email: 'x@example.com' } }, res);

    expect(res.statusCode).toBe(400);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

describe('verifyResetToken', () => {
  it('accepts the token that requestPasswordReset actually issued', async () => {
    const user = mockUser();
    User.findOne.mockResolvedValue(user);
    await authCtrl.requestPasswordReset({ body: { email: user.email } }, mockRes());
    const [{ resetToken }] = sendPasswordResetEmail.mock.calls[0];

    // The whole point: the token from step one must work in step two. It never
    // did — verify ran jwt.verify on a random hex string and failed immediately.
    User.findOne.mockResolvedValue(user);
    const res = mockRes();
    await authCtrl.verifyResetToken({ params: { token: resetToken } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.email).toBe(user.email);
  });

  it('looks the token up by digest and a live expiry', async () => {
    const user = mockUser();
    User.findOne.mockResolvedValue(user);

    await authCtrl.verifyResetToken({ params: { token: 'abc123' } }, mockRes());

    const [filter] = User.findOne.mock.calls.at(-1);
    expect(filter.resetPasswordToken).toBe(sha256('abc123'));
    expect(filter).toHaveProperty('resetPasswordExpires');
    // The misspelled key matched no documents, so every reset failed.
    expect(filter).not.toHaveProperty('resetPasswordExpire');
  });

  it('rejects an unknown or expired token', async () => {
    User.findOne.mockResolvedValue(null);

    const res = mockRes();
    await authCtrl.verifyResetToken({ params: { token: 'nope' } }, res);

    expect(res.statusCode).toBe(400);
  });

  it('requires a token', async () => {
    const res = mockRes();
    await authCtrl.verifyResetToken({ params: {} }, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('resetPassword', () => {
  it('accepts the issued token and replaces the password', async () => {
    const user = mockUser();
    User.findOne.mockResolvedValue(user);
    await authCtrl.requestPasswordReset({ body: { email: user.email } }, mockRes());
    const [{ resetToken }] = sendPasswordResetEmail.mock.calls[0];

    User.findOne.mockResolvedValue(user);
    const res = mockRes();
    await authCtrl.resetPassword(
      { params: { token: resetToken }, body: { password: 'new-password' } },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(user.password).not.toBe('old-hash');
    // Single use: the token must not survive its own redemption.
    expect(user.resetPasswordToken).toBeNull();
    expect(user.resetPasswordExpires).toBeNull();
    expect(revokeAllForUser).toHaveBeenCalledWith(user._id);
  });

  it('queries on the declared expiry field', async () => {
    User.findOne.mockResolvedValue(mockUser());

    await authCtrl.resetPassword(
      { params: { token: 'abc123' }, body: { password: 'new-password' } },
      mockRes(),
    );

    const [filter] = User.findOne.mock.calls.at(-1);
    expect(filter.resetPasswordToken).toBe(sha256('abc123'));
    expect(filter).toHaveProperty('resetPasswordExpires');
    expect(filter).not.toHaveProperty('resetPasswordExpire');
  });

  it('rejects an unknown token without touching the password', async () => {
    User.findOne.mockResolvedValue(null);

    const res = mockRes();
    await authCtrl.resetPassword(
      { params: { token: 'forged' }, body: { password: 'new-password' } },
      res,
    );

    expect(res.statusCode).toBe(400);
  });

  it.each([
    ['missing password', { password: undefined }],
    ['too short', { password: 'abc' }],
  ])('refuses a %s', async (_label, body) => {
    const res = mockRes();
    await authCtrl.resetPassword({ params: { token: 'abc123' }, body }, res);

    expect(res.statusCode).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });
});
