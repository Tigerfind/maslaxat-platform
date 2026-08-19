import api from './api';
import { lawyerImportService } from './lawyerService';

jest.mock('./api', () => ({
  post: jest.fn(),
  get: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

test('profile import upload sends progress, cancellation and an idempotency key', async () => {
  api.post.mockResolvedValue({ data: { import: { id: 'import-1', status: 'uploaded' } } });
  const file = new File(['%PDF'], 'linkedin.pdf', { type: 'application/pdf' });
  const signal = new AbortController().signal;
  const onProgress = jest.fn();

  await lawyerImportService.upload(file, { signal, onProgress, idempotencyKey: 'upload-1' });

  const [url, body, config] = api.post.mock.calls[0];
  expect(url).toBe('/lawyer/imports');
  expect(body.get('file')).toBe(file);
  expect(config.signal).toBe(signal);
  expect(config.headers['Idempotency-Key']).toBe('upload-1');
  config.onUploadProgress({ loaded: 5, total: 10 });
  expect(onProgress).toHaveBeenCalledWith(50);
});

test('profile import mutations preserve version, explicit accepted paths and profile revision', async () => {
  api.patch.mockResolvedValue({ data: { import: { version: 4 } } });
  api.post.mockResolvedValue({ data: { profile: { revision: 8 } } });

  await lawyerImportService.updateDraft('import-1', 3, { headline: 'Counsel' });
  await lawyerImportService.confirm('import-1', 4, ['headline'], 7);

  expect(api.patch).toHaveBeenCalledWith('/lawyer/imports/import-1/draft', {
    version: 3,
    draft: { headline: 'Counsel' },
  }, expect.any(Object));
  expect(api.post).toHaveBeenCalledWith('/lawyer/imports/import-1/confirm', {
    version: 4,
    acceptedPaths: ['headline'],
    profileRevision: 7,
  }, expect.any(Object));
});

test('current import optionally sends the exact attempt Idempotency-Key while page recovery stays unkeyed', async () => {
  api.get.mockResolvedValue({ data: { import: null } });
  const signal = new AbortController().signal;

  await lawyerImportService.current({ signal, idempotencyKey: 'attempt-1' });
  await lawyerImportService.current({ signal });

  expect(api.get).toHaveBeenNthCalledWith(1, '/lawyer/imports/current', {
    signal,
    headers: { 'Idempotency-Key': 'attempt-1' },
  });
  expect(api.get).toHaveBeenNthCalledWith(2, '/lawyer/imports/current', { signal });
});

test('profile import errors expose only stable code and bounded retry delay', async () => {
  api.get.mockRejectedValue({
    response: {
      status: 429,
      data: { code: 'PROFILE_IMPORT_RATE_LIMITED', error: 'provider secret', retryAfter: 999999 },
      headers: { 'retry-after': '45' },
    },
  });

  await expect(lawyerImportService.current()).rejects.toMatchObject({
    code: 'PROFILE_IMPORT_RATE_LIMITED',
    status: 429,
    retryAfter: 45,
  });
  await expect(lawyerImportService.current()).rejects.not.toHaveProperty('message', 'provider secret');
});
