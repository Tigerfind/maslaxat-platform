import { createCatalogRequestCoordinator } from './catalogRequestCoordinator';
import { runLatestRequest } from './latestRequest';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('stale response and finally handlers cannot overwrite the newest request state', async () => {
  const coordinator = createCatalogRequestCoordinator();
  const old = deferred();
  const current = deferred();
  const state = { data: null, loading: true };
  const run = (key, operation) => runLatestRequest(coordinator, key, () => operation.promise, {
    onSuccess: (value) => { state.data = value; },
    onFinally: () => { state.loading = false; },
  });

  const oldRun = run('page:1', old);
  const currentRun = run('page:2', current);
  current.resolve('newest');
  await currentRun;
  state.loading = true;
  old.resolve('stale');
  await oldRun;

  expect(state).toEqual({ data: 'newest', loading: true });
});

test('stale errors cannot replace the newest successful request', async () => {
  const coordinator = createCatalogRequestCoordinator();
  const old = deferred();
  const current = deferred();
  const state = { data: null, error: null };
  const run = (key, operation) => runLatestRequest(coordinator, key, () => operation.promise, {
    onSuccess: (value) => { state.data = value; },
    onError: (error) => { state.error = error.message; },
  });

  const oldRun = run('filters:old', old);
  const currentRun = run('filters:new', current);
  current.resolve('newest');
  await currentRun;
  old.reject(new Error('stale failure'));
  await oldRun;

  expect(state).toEqual({ data: 'newest', error: null });
});
