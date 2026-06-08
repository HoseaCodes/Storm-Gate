import axios from 'axios';
import { createCookieStore } from './cookie.js';
import { buildResponseInterceptor } from './interceptors.js';
import { createEndpoints } from './endpoints.js';
import {
  attachAuthRequestInterceptor,
  attachResponseInterceptor,
  createAuthedAxiosFactory,
} from './authedAxios.js';
import {
  DEFAULT_COOKIE_NAME,
  DEFAULT_MAX_AGE,
  DEFAULT_REMEMBER_ME_MAX_AGE,
} from './constants.js';

export function createStormGateClient({
  baseURL,
  cookieName = DEFAULT_COOKIE_NAME,
  rememberMeMaxAge = DEFAULT_REMEMBER_ME_MAX_AGE,
  defaultMaxAge = DEFAULT_MAX_AGE,
  isAuthRequiredRoute = () => false,
  onUnauthenticated,
  strictNormalization = false,
  axiosConfig = {},
} = {}) {
  if (!baseURL) {
    throw new Error('createStormGateClient requires a "baseURL" option');
  }

  const cookieStore = createCookieStore({ cookieName });

  const responseHandlers = buildResponseInterceptor({
    onUnauthenticated,
    isAuthRequiredRoute,
    strictNormalization,
  });

  const http = axios.create({
    baseURL,
    withCredentials: true,
    ...axiosConfig,
  });
  attachAuthRequestInterceptor(http, cookieStore);
  attachResponseInterceptor(http, responseHandlers);

  const endpoints = createEndpoints({
    http,
    cookieStore,
    rememberMeMaxAge,
    defaultMaxAge,
  });

  const createAuthedAxios = createAuthedAxiosFactory({
    cookieStore,
    responseHandlers,
  });

  return {
    ...endpoints,
    createAuthedAxios,
    _internal: { http, cookieStore },
  };
}
