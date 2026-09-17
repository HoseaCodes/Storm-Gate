// The OIDC login store. These cover the two properties that let these routes
// run on Lambda at all: state is single-use across containers, and no secret is
// held in a form a database read could use.
import { describe, expect, it, vi, beforeEach } from 'vitest';

function makeCollection() {
  const rows = new Map();
  return {
    rows,
    create: vi.fn(async (doc) => { rows.set(doc.stateHash, { ...doc }); return doc; }),
    findOneAndDelete: vi.fn((filter) => {
      const row = rows.get(filter.stateHash) ?? null;
      rows.delete(filter.stateHash);
      return { lean: async () => row };
    }),
    deleteOne: vi.fn(async (filter) => {
      rows.delete(filter.stateHash ?? filter.userId);
      return { deletedCount: 1 };
    }),
  };
}

const sessions = makeCollection();
const refreshRows = new Map();

vi.mock('../src/models/oidcAuthSession.js', () => ({
  default: {
    create: (...a) => sessions.create(...a),
    findOneAndDelete: (...a) => sessions.findOneAndDelete(...a),
    deleteOne: (...a) => sessions.deleteOne(...a),
  },
}));
vi.mock('../src/models/oidcRefreshToken.js', () => ({
  default: {
    findOneAndUpdate: vi.fn(async (filter, update) => {
      refreshRows.set(filter.userId, { userId: filter.userId, ...update.$set });
    }),
    findOne: vi.fn((filter) => ({ lean: async () => refreshRows.get(filter.userId) ?? null })),
    deleteOne: vi.fn(async (filter) => { refreshRows.delete(filter.userId); }),
  },
}));

const {
  createAuthSession, consumeAuthSession, discardAuthSession,
  storeRefreshToken, isCurrentRefreshToken, invalidateRefreshToken, digest,
} = await import('../src/utils/oidcSessionStore.js');

beforeEach(() => { sessions.rows.clear(); refreshRows.clear(); });

describe('OIDC auth sessions', () => {
  it('round-trips the data the callback needs', async () => {
    await createAuthSession('state-abc', {
      codeVerifier: 'verifier', application: 'blog', returnUrl: 'https://app.test/cb',
    });
    const entry = await consumeAuthSession('state-abc');
    expect(entry).toEqual({ codeVerifier: 'verifier', application: 'blog', returnUrl: 'https://app.test/cb' });
  });

  // `state` exists to prevent replay; reading it must destroy it.
  it('makes state single-use', async () => {
    await createAuthSession('state-abc', { codeVerifier: 'v' });
    expect(await consumeAuthSession('state-abc')).not.toBeNull();
    expect(await consumeAuthSession('state-abc')).toBeNull();
  });

  it('returns null for unknown or missing state', async () => {
    expect(await consumeAuthSession('never-issued')).toBeNull();
    expect(await consumeAuthSession(undefined)).toBeNull();
  });

  // A database read must not yield anything that could forge a callback.
  it('stores state only as a digest', async () => {
    await createAuthSession('state-abc', { codeVerifier: 'v' });
    const stored = [...sessions.rows.values()][0];
    expect(stored.stateHash).toBe(digest('state-abc'));
    expect(stored.stateHash).not.toContain('state-abc');
  });

  it('discards a session without consuming it', async () => {
    await createAuthSession('state-abc', { codeVerifier: 'v' });
    await discardAuthSession('state-abc');
    expect(await consumeAuthSession('state-abc')).toBeNull();
  });

  it('defaults application and returnUrl', async () => {
    await createAuthSession('s', { codeVerifier: 'v' });
    const entry = await consumeAuthSession('s');
    expect(entry.application).toBe('default');
    expect(entry.returnUrl).toBeNull();
  });
});

describe('OIDC refresh tokens', () => {
  it('recognises the current token', async () => {
    await storeRefreshToken('user-1', 'token-a');
    expect(await isCurrentRefreshToken('user-1', 'token-a')).toBe(true);
  });

  it('rejects a different token', async () => {
    await storeRefreshToken('user-1', 'token-a');
    expect(await isCurrentRefreshToken('user-1', 'token-b')).toBe(false);
  });

  // One row per user: a new login supersedes the old token.
  it('replaces the previous token on re-login', async () => {
    await storeRefreshToken('user-1', 'token-a');
    await storeRefreshToken('user-1', 'token-b');
    expect(await isCurrentRefreshToken('user-1', 'token-a')).toBe(false);
    expect(await isCurrentRefreshToken('user-1', 'token-b')).toBe(true);
  });

  it('stores only a digest', async () => {
    await storeRefreshToken('user-1', 'token-a');
    const row = refreshRows.get('user-1');
    expect(row.tokenHash).toBe(digest('token-a'));
    expect(JSON.stringify(row)).not.toContain('token-a');
  });

  it('invalidates on logout', async () => {
    await storeRefreshToken('user-1', 'token-a');
    await invalidateRefreshToken('user-1');
    expect(await isCurrentRefreshToken('user-1', 'token-a')).toBe(false);
  });

  it('fails closed for an unknown user or missing token', async () => {
    expect(await isCurrentRefreshToken('nobody', 'token')).toBe(false);
    expect(await isCurrentRefreshToken('user-1', undefined)).toBe(false);
  });
});
