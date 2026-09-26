// New passwords (sign-up and reset) must be 8 characters to 72 bytes. The old
// minimum was 6, sign-up answered a short password with 401 (which clients read
// as an expired session), and bcrypt silently ignored everything past 72 bytes.
// Emails and usernames must be strings so they cannot become query operators.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/models/user.js', () => ({
  default: { findOne: vi.fn(), findById: vi.fn() },
}));
vi.mock('../src/models/blogUser.js', () => ({ default: class {} }));
vi.mock('../src/models/unregisteredUser.js', () => ({ default: class {} }));
vi.mock('../src/utils/email.js', () => ({
  sendApprovalEmail: vi.fn(),
  sendRegistrationPendingEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

const User = (await import('../src/models/user.js')).default;
const authCtrl = (await import('../src/controllers/auth.js')).default;
const userCtrl = (await import('../src/controllers/user.js')).default;
const { validateNewPassword } = await import('../src/utils/credentials.js');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.cookie = vi.fn(() => res);
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe('validateNewPassword', () => {
  it.each([
    ['7 characters', 'abcdefg', /at least 8/],
    ['missing', undefined, /required/],
    ['a non-string', { $ne: null }, /required/],
    ['73 bytes', 'a'.repeat(73), /at most 72 bytes/],
    ['19 four-byte characters (76 bytes)', '🔒'.repeat(19), /at most 72 bytes/],
  ])('rejects %s', (_label, password, message) => {
    expect(validateNewPassword(password)).toMatch(message);
  });

  it.each([
    ['8 characters', 'abcdefgh'],
    ['72 bytes', 'a'.repeat(72)],
    ['8 multi-byte characters', '🔒'.repeat(8)],
  ])('accepts %s', (_label, password) => {
    expect(validateNewPassword(password)).toBeNull();
  });
});

describe.each([
  ['controllers/user.js', () => userCtrl],
  ['controllers/auth.js', () => authCtrl],
])('%s', (_name, getCtrl) => {
  const register = async (body) => {
    const res = mockRes();
    await getCtrl().register({ body: { name: 'N', email: 'n@example.com', password: 'long-enough-pw', ...body } }, res);
    return res;
  };

  it('rejects a short sign-up password with 400, not 401, before any lookup', async () => {
    const res = await register({ password: 'short7!' });

    expect(res.statusCode).toBe(400);
    expect(res.body.msg).toMatch(/at least 8/);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it.each([
    ['email', { email: { $ne: null } }],
    ['username', { username: { $ne: null } }],
  ])('rejects a query-operator %s at sign-up', async (_field, body) => {
    const res = await register(body);

    expect(res.statusCode).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('rejects a short password on reset', async () => {
    const res = mockRes();
    await getCtrl().resetPassword({ params: { token: 'abc123' }, body: { password: 'short7!' } }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.msg).toMatch(/at least 8/);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('rejects a query-operator email on forgot-password', async () => {
    const res = mockRes();
    await getCtrl().requestPasswordReset({ body: { email: { $ne: null } } }, res);

    expect(res.statusCode).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });
});
