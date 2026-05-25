export class StormGateError extends Error {
  constructor(message, { status, code, response } = {}) {
    super(message);
    this.name = 'StormGateError';
    this.status = status;
    this.code = code;
    this.response = response;
  }
}

export class StormGateAuthError extends StormGateError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'StormGateAuthError';
  }
}

export class StormGateNetworkError extends StormGateError {
  constructor(message, opts) {
    super(message, opts);
    this.name = 'StormGateNetworkError';
  }
}
