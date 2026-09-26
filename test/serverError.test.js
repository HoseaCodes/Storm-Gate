// 500 responses used to carry `err.message`, and refreshToken returned the whole
// error object, so database errors (collection names, query shapes, connection
// strings in driver messages) reached the client. Clients now get a fixed
// message; the detail is logged.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const INTERNAL = 'MongoServerError: connection to stormGate.users refused at cluster0-shard-00';

vi.mock('../src/models/user.js', () => ({
  default: { findOne: vi.fn(), findById: vi.fn() },
}));
vi.mock('../src/models/blogUser.js', () => ({ default: class {} }));
vi.mock('../src/models/unregisteredUser.js', () => ({ default: class {} }));
vi.mock('../src/utils/sessionRefreshStore.js', () => ({
  SESSION_REFRESH_TTL_SECONDS: 30 * 24 * 60 * 60,
  rotateRefreshToken: vi.fn(async () => { throw new Error(INTERNAL); }),
}));
vi.mock('../src/utils/email.js', () => ({
  sendVerificationCodeEmail: vi.fn(async () => true),
  sendApprovalEmail: vi.fn(),
  sendRegistrationPendingEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

const User = (await import('../src/models/user.js')).default;
const authCtrl = (await import('../src/controllers/auth.js')).default;
const userCtrl = (await import('../src/controllers/user.js')).default;
const { sendServerError, GENERIC_SERVER_ERROR } = await import('../src/utils/serverError.js');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.cookie = vi.fn(() => res);
  res.clearCookie = vi.fn(() => res);
  return res;
}

const expectNoLeak = (res) => {
  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({ msg: GENERIC_SERVER_ERROR });
  expect(JSON.stringify(res.body)).not.toContain('stormGate');
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
});

describe('sendServerError', () => {
  it('logs the real error and answers with a generic message', () => {
    const logger = { error: vi.fn() };
    const res = mockRes();

    sendServerError(res, new Error(INTERNAL), logger, 'login failed');

    expectNoLeak(res);
    expect(logger.error).toHaveBeenCalledWith('login failed', expect.objectContaining({
      message: INTERNAL,
      stack: expect.any(String),
    }));
  });

  it('falls back to console.error when no logger is given', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();

    sendServerError(res, new Error(INTERNAL), null);

    expectNoLeak(res);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe.each([
  ['controllers/user.js', () => userCtrl],
  ['controllers/auth.js', () => authCtrl],
])('%s', (_name, getCtrl) => {
  it('login does not leak a database error', async () => {
    User.findOne.mockRejectedValue(new Error(INTERNAL));
    const res = mockRes();

    await getCtrl().login({ body: { email: 'a@example.com', password: 'whatever-pass' } }, res);

    expectNoLeak(res);
  });

  it('refreshToken no longer returns the error object', async () => {
    const res = mockRes();

    // The token store fails while rotating the cookie's refresh token.
    await getCtrl().refreshToken({ cookies: { refreshtoken: 'some-token' } }, res);

    expectNoLeak(res);
    expect(res.body).not.toHaveProperty('err');
  });
});
