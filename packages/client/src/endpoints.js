import {
  DEFAULT_MAX_AGE,
  DEFAULT_REMEMBER_ME_MAX_AGE,
} from './constants.js';

const SKIP = { _skipAuthNormalize: true };

export function createEndpoints({ http, cookieStore, rememberMeMaxAge, defaultMaxAge }) {
  const loginMaxAge = (rememberMe) =>
    rememberMe
      ? rememberMeMaxAge ?? DEFAULT_REMEMBER_ME_MAX_AGE
      : defaultMaxAge ?? DEFAULT_MAX_AGE;

  async function login({ email, password, rememberMe = false } = {}) {
    const { data } = await http.post('/login', { email, password, rememberMe }, SKIP);
    if (data?.accesstoken) {
      cookieStore.write(data.accesstoken, { maxAge: loginMaxAge(rememberMe) });
    }
    return data;
  }

  async function register(payload = {}) {
    const { data } = await http.post('/register', payload, SKIP);
    if (data?.accesstoken) {
      cookieStore.write(data.accesstoken, { maxAge: defaultMaxAge ?? DEFAULT_MAX_AGE });
    }
    return data;
  }

  async function getMe() {
    const { data } = await http.get('/me');
    return data;
  }

  async function logout() {
    try {
      const { data } = await http.post('/logout');
      return data;
    } finally {
      cookieStore.clear();
    }
  }

  async function refreshToken() {
    const { data } = await http.get('/refresh_token');
    if (data?.accesstoken) {
      cookieStore.write(data.accesstoken, { maxAge: defaultMaxAge ?? DEFAULT_MAX_AGE });
    }
    return data;
  }

  async function checkStatus({ email } = {}) {
    const { data } = await http.post('/check-status', { email }, SKIP);
    return data;
  }

  async function forgotPassword({ email } = {}) {
    const { data } = await http.post('/forgot-password', { email }, SKIP);
    return data;
  }

  async function verifyResetToken(token) {
    const { data } = await http.post(
      `/verify-reset-token/${encodeURIComponent(token)}`,
      undefined,
      SKIP,
    );
    return data;
  }

  async function resetPassword({ token, password } = {}) {
    const { data } = await http.post(
      `/reset-password/${encodeURIComponent(token)}`,
      { password },
      SKIP,
    );
    return data;
  }

  return {
    login,
    register,
    getMe,
    logout,
    refreshToken,
    checkStatus,
    forgotPassword,
    verifyResetToken,
    resetPassword,
  };
}
