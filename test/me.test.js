// /me is how consuming apps learn who the bearer is. It now also reports the
// application the account was created for, so an app can refuse accounts that
// belong to another one (ambitious-admin had been admitting every approved
// Storm Gate account).
import { describe, expect, it, vi, beforeEach } from 'vitest';

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
const userCtrl = (await import('../src/controllers/user.js')).default;

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}

const stored = (overrides = {}) => ({
  _id: 'user-1',
  name: 'Admin',
  email: 'admin@example.com',
  role: 'admin',
  status: 'APPROVED',
  application: 'ambitious-admin',
  ...overrides,
});

async function me(user) {
  User.findById.mockReturnValue({ select: vi.fn().mockResolvedValue(user) });
  const res = mockRes();
  await userCtrl.getMe({ user: { id: 'user-1' } }, res);
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /me', () => {
  it('includes the application alongside the existing fields', async () => {
    const res = await me(stored());

    expect(res.body.user).toMatchObject({
      id: 'user-1',
      email: 'admin@example.com',
      role: 'admin',
      status: 'APPROVED',
      application: 'ambitious-admin',
    });
  });

  it('reports null for a legacy account without an application', async () => {
    const res = await me(stored({ application: undefined }));

    expect(res.body.user.application).toBeNull();
  });
});
