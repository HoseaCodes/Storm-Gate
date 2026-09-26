// Both login controllers hand out refresh tokens through utils/session.js: in
// the body only when the client asks, and as a cookie only for remember-me.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';

vi.mock('../src/models/user.js', () => ({
  default: { findOne: vi.fn(), findById: vi.fn() },
}));
vi.mock('../src/models/blogUser.js', () => ({ default: class {} }));
vi.mock('../src/models/unregisteredUser.js', () => ({ default: class {} }));
vi.mock('../src/utils/email.js', () => ({
  sendVerificationCodeEmail: vi.fn(async () => true),
  sendApprovalEmail: vi.fn(),
  sendRegistrationPendingEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock('../src/utils/sessionRefreshStore.js', () => ({
  SESSION_REFRESH_TTL_SECONDS: 30 * 24 * 60 * 60,
  issueRefreshToken: vi.fn(async () => 'issued-refresh-token'),
  rotateRefreshToken: vi.fn(),
  revokeRefreshFamily: vi.fn(),
  revokeAllForUser: vi.fn(),
}));

const User = (await import('../src/models/user.js')).default;
const { issueRefreshToken } = await import('../src/utils/sessionRefreshStore.js');
const authCtrl = (await import('../src/controllers/auth.js')).default;
const userCtrl = (await import('../src/controllers/user.js')).default;

const PASSWORD = 'correct-horse-battery';
const passwordHash = await bcrypt.hash(PASSWORD, 4);

function mockRes() {
  const res = { statusCode: 200, body: null, cookies: {} };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.cookie = vi.fn((name, value) => { res.cookies[name] = value; return res; });
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ACCESS_TOKEN_SECRET = 'test-secret';
  delete process.env.JWT_SIGNING_ALG;
  User.findOne.mockResolvedValue({ _id: 'user-1', email: 'a@example.com', password: passwordHash, status: 'APPROVED' });
});

describe.each([
  ['POST /login (controllers/user.js)', () => userCtrl],
  ['POST /auth/login (controllers/auth.js)', () => authCtrl],
])('%s', (_name, getCtrl) => {
  const login = async (extra = {}) => {
    const res = mockRes();
    await getCtrl().login({ body: { email: 'a@example.com', password: PASSWORD, ...extra } }, res);
    return res;
  };

  it('keeps the old response for clients that do not ask for a refresh token', async () => {
    const res = await login();

    expect(res.body).toEqual({ accesstoken: expect.any(String), status: 'Successful', emailVerified: true });
    expect(issueRefreshToken).not.toHaveBeenCalled();
    expect(res.cookies.refreshtoken).toBeUndefined();
  });

  it('returns a refresh token in the body when asked', async () => {
    const res = await login({ includeRefreshToken: true });

    expect(res.body).toMatchObject({ status: 'Successful', refreshToken: 'issued-refresh-token' });
  });

  it('sets the refresh cookie for remember-me without adding it to the body', async () => {
    const res = await login({ rememberMe: true });

    expect(res.cookies.refreshtoken).toBe('issued-refresh-token');
    expect(res.body.refreshToken).toBeUndefined();
  });
});
