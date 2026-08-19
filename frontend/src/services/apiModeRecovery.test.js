import { attachInterceptors } from './api';

jest.mock('axios', () => ({
  create: jest.fn(() => ({
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  })),
}));

const modeError = (config, code, status = 400) => Promise.reject({
  config, response: { status, data: { code } },
});

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition not reached');
};

const interceptorClient = (adapter) => {
  const requestHandlers = [];
  const responseHandlers = [];
  const client = (config) => {
    let chain = Promise.resolve({ headers: {}, ...config });
    requestHandlers.forEach(([ok, fail]) => { chain = chain.then(ok, fail); });
    chain = chain.then(adapter);
    responseHandlers.forEach(([ok, fail]) => { chain = chain.then(ok, fail); });
    return chain;
  };
  client.interceptors = {
    request: { use: (ok, fail) => requestHandlers.push([ok, fail]) },
    response: { use: (ok, fail) => responseHandlers.push([ok, fail]) },
  };
  ['get', 'post', 'put'].forEach((method) => {
    client[method] = (url, dataOrConfig, maybeConfig) => client({
      ...((method === 'get' ? dataOrConfig : maybeConfig) || {}), url, method,
      data: method === 'get' ? undefined : dataOrConfig,
    });
  });
  return client;
};

const makeClient = (adapter, overrides = {}) => {
  const client = interceptorClient(adapter);
  const session = {
    getSnapshot: () => ({ token: 'token', activeMode: 'client', capabilities: ['client', 'lawyer'] }),
    chooseMode: () => 'client', getEpoch: () => 1, onUnauthorized: jest.fn(), reconcile: jest.fn().mockResolvedValue(),
    ...overrides,
  };
  attachInterceptors(client, session);
  return { client, session };
};

test('MODE_REQUIRED retries GET exactly once with an allowed mode', async () => {
  let calls = 0;
  const { client } = makeClient((config) => {
    calls += 1;
    if (calls === 1) return modeError(config, 'MODE_REQUIRED');
    return Promise.resolve({ status: 200, data: { ok: true }, config, headers: {} });
  }, { getSnapshot: () => ({ token: 'token', activeMode: null, capabilities: ['client', 'lawyer'] }) });

  const response = await client.get('/consultations', { skipModeHeader: true });
  expect(calls).toBe(2);
  expect(response.config.headers['X-Maslaxat-Mode']).toBe('client');
});

test('MODE_REQUIRED never retries a mutation', async () => {
  let calls = 0;
  const { client } = makeClient((config) => { calls += 1; return modeError(config, 'MODE_REQUIRED'); });
  await expect(client.post('/consultations', {})).rejects.toBeDefined();
  expect(calls).toBe(1);
});

test('explicit target mode is preserved and MODE_FORBIDDEN reconciles without replay', async () => {
  let calls = 0;
  let sentMode;
  const { client, session } = makeClient((config) => {
    calls += 1;
    sentMode = config.headers['X-Maslaxat-Mode'];
    return modeError(config, 'MODE_FORBIDDEN', 403);
  });
  await expect(client.put('/users/profile', { preferredMode: 'lawyer' }, { modeOverride: 'lawyer' })).rejects.toBeDefined();
  expect(sentMode).toBe('lawyer');
  expect(calls).toBe(1);
  expect(session.reconcile).toHaveBeenCalledTimes(1);
});

test('401 delegates atomic session revocation', async () => {
  const { client, session } = makeClient((config) => Promise.reject({ config, response: { status: 401, data: {} } }));
  await expect(client.get('/documents')).rejects.toBeDefined();
  expect(session.onUnauthorized).toHaveBeenCalledTimes(1);
});

test('push unbind 401 does not recursively revoke the session', async () => {
  const { client, session } = makeClient((config) => Promise.reject({ config, response: { status: 401, data: {} } }));

  await expect(client.post('/push/unsubscribe', {}, { skipSessionRevocation: true })).rejects.toBeDefined();

  expect(session.onUnauthorized).not.toHaveBeenCalled();
});

test('stale 401 cannot revoke a newer session', async () => {
  let epoch = 1;
  let rejectRequest;
  const { client, session } = makeClient((config) => new Promise((resolve, reject) => {
    rejectRequest = () => reject({ config, response: { status: 401, data: {} } });
  }), { getEpoch: () => epoch });
  const pending = client.get('/documents');
  await waitFor(() => typeof rejectRequest === 'function');
  epoch = 2;
  rejectRequest();

  await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(session.onUnauthorized).not.toHaveBeenCalled();
});

test('stale MODE_REQUIRED cannot replay under a newer session', async () => {
  let epoch = 3;
  let rejectRequest;
  let calls = 0;
  const { client, session } = makeClient((config) => {
    calls += 1;
    if (calls > 1) return Promise.resolve({ status: 200, data: { replayed: true }, config, headers: {} });
    return new Promise((resolve, reject) => {
      rejectRequest = () => reject({ config, response: { status: 400, data: { code: 'MODE_REQUIRED' } } });
    });
  }, { getEpoch: () => epoch });
  const pending = client.get('/consultations', { skipModeHeader: true });
  await waitFor(() => typeof rejectRequest === 'function');
  epoch = 4;
  rejectRequest();

  await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(calls).toBe(1);
  expect(session.reconcile).not.toHaveBeenCalled();
});
