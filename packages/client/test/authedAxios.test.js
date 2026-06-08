import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createStormGateClient } from '../src/client.js';
import { BASE_URL, server } from './server.js';

const CONSUMER_BACKEND = 'http://localhost:3003';

describe('createAuthedAxios', () => {
  beforeEach(() => {
    document.cookie = 'accesstoken=consumer-token; path=/';
  });

  it('attaches the same cookie token to requests against a different baseURL', async () => {
    let captured;
    server.use(
      http.get(`${CONSUMER_BACKEND}/api/articles`, ({ request }) => {
        captured = { authHeader: request.headers.get('Authorization') };
        return HttpResponse.json([{ id: 1 }]);
      }),
    );

    const auth = createStormGateClient({ baseURL: BASE_URL });
    const api = auth.createAuthedAxios({ baseURL: CONSUMER_BACKEND });
    await api.get('/api/articles');

    expect(captured.authHeader).toBe('consumer-token');
  });

  it('uses withCredentials by default', () => {
    const auth = createStormGateClient({ baseURL: BASE_URL });
    const api = auth.createAuthedAxios({ baseURL: CONSUMER_BACKEND });
    expect(api.defaults.withCredentials).toBe(true);
  });

  it('reflects subsequent cookie changes (reads on each request)', async () => {
    let lastAuth;
    server.use(
      http.get(`${CONSUMER_BACKEND}/ping`, ({ request }) => {
        lastAuth = request.headers.get('Authorization');
        return HttpResponse.json({ ok: true });
      }),
    );

    const auth = createStormGateClient({ baseURL: BASE_URL });
    const api = auth.createAuthedAxios({ baseURL: CONSUMER_BACKEND });

    await api.get('/ping');
    expect(lastAuth).toBe('consumer-token');

    document.cookie = 'accesstoken=rotated-token; path=/';
    await api.get('/ping');
    expect(lastAuth).toBe('rotated-token');
  });
});
