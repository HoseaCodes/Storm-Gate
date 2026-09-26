// Login answered "User does not exist." for unknown emails and "Invalid password"
// for known ones, skipped bcrypt for unknown emails (a timing tell), and revealed
// DENIED status before checking the password. /check-status returned the name
// and sign-up date for any email, unauthenticated.
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

const User = (await import('../src/models/user.js')).default;
const authCtrl = (await import('../src/controllers/auth.js')).default;
const userCtrl = (await import('../src/controllers/user.js')).default;
const { INVALID_CREDENTIALS, verifyCredentials } = await import('../src/utils/credentials.js');

const PASSWORD = 'correct-horse-battery';
const passwordHash = await bcrypt.hash(PASSWORD, 4);

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.cookie = vi.fn(() => res);
  res.clearCookie = vi.fn(() => res);
  return res;
}

const account = (overrides = {}) => ({
  _id: 'user-1',
  email: 'real@example.com',
  name: 'Real Person',
  password: passwordHash,
  status: 'APPROVED',
  createdAt: new Date('2025-01-01'),
  ...overrides,
});

const login = (ctrl, password = PASSWORD) =>
  ctrl.login({ body: { email: 'someone@example.com', password } }, mockRes());

beforeEach(() => {
  vi.restoreAllMocks();
  User.findOne.mockReset();
  process.env.ACCESS_TOKEN_SECRET = 'test-secret';
  process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
  delete process.env.JWT_SIGNING_ALG;
});

describe.each([
  ['POST /login (controllers/user.js)', () => userCtrl],
  ['POST /auth/login (controllers/auth.js)', () => authCtrl],
])('%s', (_name, getCtrl) => {
  async function attempt(user, password) {
    User.findOne.mockResolvedValue(user);
    const res = mockRes();
    await getCtrl().login({ body: { email: 'someone@example.com', password } }, res);
    return res;
  }

  it('answers an unknown email exactly like a wrong password', async () => {
    const unknown = await attempt(null, 'anything-at-all');
    const wrong = await attempt(account(), 'not-the-password');

    expect(unknown.statusCode).toBe(400);
    expect(unknown.body).toEqual({ msg: INVALID_CREDENTIALS });
    expect(wrong.statusCode).toBe(unknown.statusCode);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('still runs bcrypt when the email is unknown', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');

    await attempt(null, 'anything-at-all');

    expect(compare).toHaveBeenCalledTimes(1);
  });

  it('does not reveal a DENIED account to someone without the password', async () => {
    const res = await attempt(account({ status: 'DENIED' }), 'not-the-password');

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ msg: INVALID_CREDENTIALS });
  });

  it('tells a DENIED account holder with the right password', async () => {
    const res = await attempt(account({ status: 'DENIED' }), PASSWORD);

    expect(res.statusCode).toBe(403);
    expect(res.body.status).toBe('DENIED');
  });

  it('rejects an account with no local password instead of erroring', async () => {
    const res = await attempt(account({ password: undefined }), 'anything-at-all');

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ msg: INVALID_CREDENTIALS });
  });

  it('never passes a query-operator email to the database', async () => {
    User.findOne.mockResolvedValue(account());
    const res = mockRes();

    await getCtrl().login({ body: { email: { $ne: null }, password: PASSWORD } }, res);

    expect(User.findOne).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ msg: INVALID_CREDENTIALS });
  });

  it('logs in with the right password', async () => {
    const res = await attempt(account(), PASSWORD);

    expect(res.statusCode).toBe(200);
    expect(res.body.accesstoken).toEqual(expect.any(String));
  });
});

describe('verifyCredentials', () => {
  it('rejects a missing or non-string password', async () => {
    expect(await verifyCredentials(account(), undefined)).toBe(false);
    expect(await verifyCredentials(account(), { $ne: null })).toBe(false);
  });
});

describe('POST /check-status', () => {
  it('returns only email and status, not the name or sign-up date', async () => {
    User.findOne.mockReturnValue({ select: vi.fn().mockResolvedValue(account({ status: 'PENDING' })) });
    const res = mockRes();

    await userCtrl.checkUserStatus({ body: { email: 'real@example.com' } }, res);

    expect(res.body).toEqual({
      status: 'success',
      user: { email: 'real@example.com', status: 'PENDING' },
    });
  });

  it('rejects a query-operator email instead of searching with it', async () => {
    const res = mockRes();

    await userCtrl.checkUserStatus({ body: { email: { $regex: '^a' } } }, res);

    expect(User.findOne).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });
});
