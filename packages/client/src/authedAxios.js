import axios from 'axios';

export function attachAuthRequestInterceptor(instance, cookieStore) {
  instance.interceptors.request.use((config) => {
    const token = cookieStore.read();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = token;
    }
    return config;
  });
  return instance;
}

export function attachResponseInterceptor(instance, { handleSuccess, handleError }) {
  instance.interceptors.response.use(handleSuccess, handleError);
  return instance;
}

export function createAuthedAxiosFactory({ cookieStore, responseHandlers }) {
  return function createAuthedAxios(config = {}) {
    const instance = axios.create({ withCredentials: true, ...config });
    attachAuthRequestInterceptor(instance, cookieStore);
    if (responseHandlers) attachResponseInterceptor(instance, responseHandlers);
    return instance;
  };
}
