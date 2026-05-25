import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createRequireAuth } from '../src/requireAuth.js';

const SECRET = 'test-secret-do-not-use-in-prod';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function mockReq(authHeader) {
  return {
    headers: { authorization: authHeader },
    header(name) {
      return this.headers[name.toLowerCase()];
    },
  };
}

describe('createRequireAuth', () => {
  it('throws if secret is missing', () => {
    expect(() => createRequireAuth()).toThrow(/secret/);
    expect(() => createRequireAuth({})).toThrow(/secret/);
  });

  it('calls next() and populates req.user on valid token (raw format)', () => {
    const requireAuth = createRequireAuth({ secret: SECRET });
    const token = jwt.sign({ id: 'user-123' }, SECRET, { expiresIn: '1h' });
    const req = mockReq(token);
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 'user-123' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts Bearer prefix', () => {
    const requireAuth = createRequireAuth({ secret: SECRET });
    const token = jwt.sign({ id: 'user-456' }, SECRET, { expiresIn: '1h' });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 'user-456' });
  });

  it('returns 401 (NOT 400) on expired token — fixes the upstream contract bug', () => {
    const requireAuth = createRequireAuth({ secret: SECRET });
    const token = jwt.sign({ id: 'user-789' }, SECRET, { expiresIn: '-1s' });
    const req = mockReq(token);
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TokenExpiredError', msg: 'Token expired' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 on invalid signature', () => {
    const requireAuth = createRequireAuth({ secret: SECRET });
    const token = jwt.sign({ id: 'user-999' }, 'a-different-secret');
    const req = mockReq(token);
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'Invalid authentication token' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 on missing token', () => {
    const requireAuth = createRequireAuth({ secret: SECRET });
    const req = mockReq(undefined);
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'Missing authentication token' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects tokens signed with disallowed algorithms', () => {
    const requireAuth = createRequireAuth({ secret: SECRET, algorithms: ['HS256'] });
    const token = jwt.sign({ id: 'user-abc' }, SECRET, { algorithm: 'HS512' });
    const req = mockReq(token);
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
