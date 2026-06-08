import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

export const BASE_URL = 'http://storm-gate.test';

export const handlers = [
  http.post(`${BASE_URL}/login`, async ({ request }) => {
    const body = await request.json();
    if (body.email === 'unknown@example.com') {
      return HttpResponse.json({ msg: 'User does not exist.' }, { status: 400 });
    }
    if (body.password === 'wrong') {
      return HttpResponse.json({ msg: 'Invalid password' }, { status: 400 });
    }
    if (body.email === 'pending@example.com') {
      return HttpResponse.json({
        accesstoken: 'pending-token',
        status: 'PENDING',
        msg: 'Login successful. Your account is pending approval - limited access.',
        limitedAccess: true,
      });
    }
    return HttpResponse.json({
      accesstoken: 'valid-access-token',
      status: 'Successful',
    });
  }),

  http.post(`${BASE_URL}/register`, async ({ request }) => {
    const body = await request.json();
    if (body.status === 'PENDING') {
      return HttpResponse.json(
        {
          msg: 'Registration submitted for approval',
          status: 'PENDING',
          requiresApproval: true,
        },
        { status: 201 },
      );
    }
    return HttpResponse.json({
      accesstoken: 'new-user-token',
      status: 'Successful',
    });
  }),

  http.get(`${BASE_URL}/me`, ({ request }) => {
    const auth = request.headers.get('Authorization');
    if (!auth) {
      return HttpResponse.json(
        { msg: 'Invalid Authentication - no token' },
        { status: 400 },
      );
    }
    if (auth === 'expired-token') {
      return HttpResponse.json(
        { msg: 'Token Expired Error' },
        { status: 400 },
      );
    }
    return HttpResponse.json({
      status: 'success',
      user: { id: 'user-1', name: 'Test User', email: 'test@example.com', role: 'admin' },
    });
  }),

  http.post(`${BASE_URL}/logout`, () =>
    HttpResponse.json({ msg: 'Logged Out', status: 'Successful' }),
  ),

  http.get(`${BASE_URL}/refresh_token`, () =>
    HttpResponse.json({ accesstoken: 'refreshed-token' }),
  ),

  http.post(`${BASE_URL}/check-status`, async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      status: 'success',
      user: { email: body.email, status: 'APPROVED' },
    });
  }),

  http.post(`${BASE_URL}/forgot-password`, () =>
    HttpResponse.json({
      msg: 'If an account with that email exists, a password reset link has been sent.',
      status: 'success',
    }),
  ),

  http.post(`${BASE_URL}/verify-reset-token/:token`, ({ params }) =>
    HttpResponse.json({
      msg: 'Token is valid',
      status: 'success',
      email: `user-for-${params.token}@example.com`,
    }),
  ),

  http.post(`${BASE_URL}/reset-password/:token`, () =>
    HttpResponse.json({
      msg: 'Password has been successfully reset.',
      status: 'success',
    }),
  ),
];

export const server = setupServer(...handlers);
