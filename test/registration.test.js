// Registration used to copy `role` and `status` from the request body. The User
// schema accepts "admin" and "superAdmin", so POST /register {"role":"admin"}
// created an admin that requireAdmin and every consumer of /me trusted, and
// leaving `status` out skipped the approval gate for applications that need it.
//
// Both register implementations are live (/register -> controllers/user.js,
// /auth/register -> controllers/auth.js), so each case runs against both.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { FakeUser, FakeBlogUser, saved } = vi.hoisted(() => {
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
  FakeUser.findOneAndUpdate = vi.fn();
  class FakeBlogUser extends FakeUser {}
  return { FakeUser, FakeBlogUser, saved };
});

vi.mock('../src/models/user.js', () => ({ default: FakeUser }));
vi.mock('../src/models/blogUser.js', () => ({ default: FakeBlogUser }));
vi.mock('../src/models/unregisteredUser.js', () => ({ default: class {} }));
vi.mock('../src/utils/email.js', () => ({
  sendApprovalEmail: vi.fn(async () => true),
  sendRegistrationPendingEmail: vi.fn(async () => true),
  sendPasswordResetEmail: vi.fn(),
}));

const authCtrl = (await import('../src/controllers/auth.js')).default;
const userCtrl = (await import('../src/controllers/user.js')).default;
const {
  resolveRegistrationStatus,
  approvalRequiredApplications,
  stripProtectedUserFields,
} = await import('../src/utils/registration.js');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.cookie = vi.fn(() => res);
  res.clearCookie = vi.fn(() => res);
  return res;
}

const signup = (extra = {}) => ({
  body: { name: 'New User', email: 'new@example.com', password: 'long-enough-password', ...extra },
});

let savedEnv;
beforeEach(() => {
  vi.clearAllMocks();
  saved.length = 0;
  savedEnv = process.env.APPROVAL_REQUIRED_APPLICATIONS;
  delete process.env.APPROVAL_REQUIRED_APPLICATIONS;
  process.env.ACCESS_TOKEN_SECRET = 'test-secret';
  process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
  delete process.env.JWT_SIGNING_ALG;
  FakeUser.findOne.mockResolvedValue(null);
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.APPROVAL_REQUIRED_APPLICATIONS;
  else process.env.APPROVAL_REQUIRED_APPLICATIONS = savedEnv;
});

describe.each([
  ['POST /register (controllers/user.js)', () => userCtrl.register],
  ['POST /auth/register (controllers/auth.js)', () => authCtrl.register],
])('%s', (_name, getRegister) => {
  it.each(['admin', 'superAdmin'])('ignores a client-supplied role of %s', async (role) => {
    const res = mockRes();
    await getRegister()(signup({ role }), res);

    expect(saved).toHaveLength(1);
    expect(saved[0].role).toBe('basic');
    expect(res.statusCode).toBe(200);
  });

  it('cannot approve itself for an application that requires approval', async () => {
    const res = mockRes();
    await getRegister()(signup({ application: 'blog', status: 'APPROVED' }), res);

    expect(saved[0].status).toBe('PENDING');
    expect(res.body).toMatchObject({ status: 'PENDING', requiresApproval: true });
    expect(res.body.accesstoken).toBeUndefined();
  });

  it('puts approval-required applications in PENDING even when status is omitted', async () => {
    const res = mockRes();
    await getRegister()(signup({ application: 'blog' }), res);

    expect(saved[0].status).toBe('PENDING');
  });

  it('cannot set a DENIED or APPROVED status for other applications either', async () => {
    const res = mockRes();
    await getRegister()(signup({ application: 'manifestathletics', status: 'DENIED' }), res);

    expect(saved[0].status).toBe('APPROVED');
  });

  it('still honours a client asking for PENDING', async () => {
    const res = mockRes();
    await getRegister()(signup({ application: 'manifestathletics', status: 'PENDING' }), res);

    expect(saved[0].status).toBe('PENDING');
  });

  it('approves a normal sign-up and returns an access token', async () => {
    const res = mockRes();
    await getRegister()(signup({ application: 'manifestathletics' }), res);

    expect(saved[0]).toMatchObject({ role: 'basic', status: 'APPROVED' });
    expect(res.body.accesstoken).toEqual(expect.any(String));
  });
});

describe('resolveRegistrationStatus', () => {
  it('defaults the approval list to the blog', () => {
    expect(approvalRequiredApplications()).toEqual(['blog']);
  });

  it('reads APPROVAL_REQUIRED_APPLICATIONS when set', () => {
    process.env.APPROVAL_REQUIRED_APPLICATIONS = ' blog , opsatlas ,';
    expect(approvalRequiredApplications()).toEqual(['blog', 'opsatlas']);
    expect(resolveRegistrationStatus({ application: 'opsatlas' })).toBe('PENDING');
    expect(resolveRegistrationStatus({ application: 'manifestathletics' })).toBe('APPROVED');
  });

  it('lets an empty setting turn approval off entirely', () => {
    process.env.APPROVAL_REQUIRED_APPLICATIONS = '';
    expect(resolveRegistrationStatus({ application: 'blog' })).toBe('APPROVED');
  });
});

describe('profile updates', () => {
  it('strips privilege, identity and credential fields', () => {
    const { allowed, removed } = stripProtectedUserFields({
      name: 'Renamed',
      bio: 'hi',
      role: 'admin',
      status: 'APPROVED',
      email: 'attacker@example.com',
      password: 'plaintext',
    });

    expect(allowed).toEqual({ name: 'Renamed', bio: 'hi' });
    expect(removed).toEqual(['role', 'status', 'email', 'password']);
  });

  it('PUT /api/user/:id never writes role, status, email or password', async () => {
    FakeUser.findOne.mockResolvedValue({ notifications: [], favoriteArticles: [], savedArticles: [], likedArticles: [] });
    FakeUser.findOneAndUpdate.mockResolvedValue({ _id: 'user-1' });
    const res = mockRes();

    await userCtrl.updateProfile(
      { params: { id: 'user-1' }, body: { name: 'Renamed', role: 'admin', status: 'APPROVED', email: 'x@example.com', password: 'p' } },
      res,
    );

    const [, update] = FakeUser.findOneAndUpdate.mock.calls.at(-1);
    expect(update).toEqual({ name: 'Renamed' });
    expect(res.body).toMatchObject({ status: 'Successful' });
  });
});
