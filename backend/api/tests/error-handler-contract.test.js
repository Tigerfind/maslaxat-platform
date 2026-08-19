const express = require('express');
const request = require('supertest');
const { errorHandler } = require('../src/middleware/errorHandler');
const logger = require('../src/config/logger');

function appFor(error) {
  const app = express();
  app.get('/error', (_req, _res, next) => next(error));
  app.use(errorHandler);
  return app;
}

test('error handler uses allowlisted message/details instead of the supplied provider message', async () => {
  const error = Object.assign(new Error('provider secret must not leak'), {
    status: 409,
    code: 'IMPORT_VERSION_CONFLICT',
    details: { currentVersion: 7, storageKey: 'must-not-leak' },
  });

  const response = await request(appFor(error)).get('/error');

  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({
    code: 'IMPORT_VERSION_CONFLICT',
    error: 'Import version conflict',
    details: { currentVersion: 7 },
  });
  expect(JSON.stringify(response.body)).not.toMatch(/provider secret|must-not-leak/i);
});

test('error handler exposes bounded retry only for an explicitly allowlisted retryable code', async () => {
  const error = Object.assign(new Error('redis topology detail'), {
    status: 503,
    code: 'PROFILE_IMPORT_RATE_LIMITED',
    retryAfter: 60,
  });

  const response = await request(appFor(error)).get('/error');

  expect(response.status).toBe(503);
  expect(response.headers['retry-after']).toBe('60');
  expect(response.body).toMatchObject({
    code: 'PROFILE_IMPORT_RATE_LIMITED',
    error: 'Profile import rate limit exceeded',
    retryAfter: 60,
  });
  expect(JSON.stringify(response.body)).not.toContain('redis topology');
});

test.each([
  ['ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.4:6379'],
  ['PROVIDER_DECLINED', 'provider response includes private account data'],
])('production drops unknown uppercase infrastructure/provider code %s and message', async (code, message) => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const response = await request(appFor(Object.assign(new Error(message), {
      status: 503,
      code,
      details: { token: 'secret' },
    }))).get('/error');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Внутренняя ошибка сервера' });
    expect(JSON.stringify(response.body)).not.toMatch(/ECONNREFUSED|PROVIDER|10\.0\.0\.4|private account|secret/i);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('server-error Winston metadata contains only controlled fields and no raw error marker', () => {
  const marker = 'AI_DOCUMENT_PROVIDER_MARKER_V7N3';
  const error = Object.assign(new Error(marker), {
    name: `ProviderError${marker}`,
    stack: `ProviderError: ${marker}\n at provider (${marker}.js:1:1)`,
    status: 503,
    code: 'PDF_IMPORT_FAILED',
  });
  const req = {
    method: 'POST',
    path: `/api/documents/${marker}`,
    route: { path: '/api/documents/:id/ai-check' },
    baseUrl: '',
    requestId: '4e0e77c8-a66f-4a62-8f8e-b1f19987d80f',
    userId: marker,
  };
  const res = {
    set: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const logSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

  try {
    errorHandler(error, req, res, jest.fn());
    expect(logSpy).toHaveBeenCalledWith('request_failed', {
      errorName: 'Error',
      safeCode: 'PDF_IMPORT_FAILED',
      requestId: req.requestId,
      route: '/api/documents/:id/ai-check',
      status: 503,
    });
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(marker);
  } finally {
    logSpy.mockRestore();
  }
});
