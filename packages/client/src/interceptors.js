import { EXPIRED_MSG_PATTERNS } from './constants.js';

function looksLikeAuthFailure(error) {
  const status = error?.response?.status;
  if (status === 401) return true;
  if (status !== 400) return false;
  const msg = error?.response?.data?.msg;
  if (typeof msg !== 'string') return false;
  return EXPIRED_MSG_PATTERNS.some((pattern) => pattern.test(msg));
}

export function buildResponseInterceptor({
  onUnauthenticated,
  isAuthRequiredRoute = () => false,
  strictNormalization = false,
}) {
  const state = { inFlight: false };

  function reset() {
    state.inFlight = false;
  }

  function handleSuccess(response) {
    reset();
    return response;
  }

  function handleError(error) {
    const config = error?.config || {};
    if (config._skipAuthNormalize) return Promise.reject(error);

    const isAuth = strictNormalization
      ? error?.response?.status === 401
      : looksLikeAuthFailure(error);

    if (!isAuth) return Promise.reject(error);

    if (error.response && error.response.status !== 401) {
      error.response.status = 401;
      error.normalized = true;
    }

    if (!state.inFlight && typeof onUnauthenticated === 'function') {
      let pathname = '/';
      if (typeof window !== 'undefined' && window.location) {
        pathname = window.location.pathname;
      }
      if (isAuthRequiredRoute(pathname)) {
        state.inFlight = true;
        try {
          onUnauthenticated();
        } catch {
          // swallow consumer errors so the rejection still propagates
        }
      }
    }

    return Promise.reject(error);
  }

  return { handleSuccess, handleError, _state: state };
}
