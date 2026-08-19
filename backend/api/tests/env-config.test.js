const { loadEnv, EnvConfigError } = require('../src/config/env');

const VALID_PRODUCTION_ENV = Object.freeze({
  NODE_ENV: 'production',
  PORT: '3001',
  JWT_SECRET: 'jwt-secret-that-is-at-least-32-characters',
  DATABASE_URL: 'postgresql://app:password@db.internal:5432/maslaxat',
  REDIS_URL: 'rediss://cache.internal:6379',
  CORS_ORIGINS: 'https://app.maslaxat.uz,https://www.maslaxat.uz',
  FRONTEND_URL: 'https://app.maslaxat.uz',
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_ACCESS_KEY_ID: 'r2-access-key',
  R2_SECRET_ACCESS_KEY: 'r2-secret-key',
  R2_PRIVATE_BUCKET: 'maslaxat-private',
  FILE_STORAGE_LOCAL_ROOT: '/var/lib/emaslaxat/uploads',
  CATALOG_CURSOR_SECRET: 'catalog-cursor-secret-with-32-characters',
  CATALOG_ATTRIBUTION_SECRET: 'catalog-attribution-secret-32-characters',
  RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
  RAILWAY_DEPLOYMENT_ID: 'deployment-production',
  RAILWAY_SERVICE_ID: 'maslaxat-api-production',
  AUTHORIZATION_METADATA_TOKEN: 'authorization-metadata-token-32-characters',
});

function productionEnv(overrides = {}) {
  return { ...VALID_PRODUCTION_ENV, ...overrides };
}

function invalidNames(env) {
  try {
    loadEnv(env);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvConfigError);
    return error.names;
  }
  throw new Error('Expected environment validation to fail');
}

describe('loadEnv', () => {
  test('returns typed deeply frozen production configuration', () => {
    const config = loadEnv(productionEnv({
      NODE_ENV: ' production ',
      FRONTEND_URL: ' https://app.maslaxat.uz/ ',
      CORS_ORIGINS: ' https://app.maslaxat.uz , https://www.maslaxat.uz ',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'mailer',
      SMTP_PASS: 'smtp-secret',
      SMTP_FROM: 'MaslaXat <noreply@maslaxat.uz>',
    }));

    expect(config.port).toBe(3001);
    expect(config.database.url).toBe(VALID_PRODUCTION_ENV.DATABASE_URL);
    expect(config.frontendUrl).toBe('https://app.maslaxat.uz');
    expect(config.cors.origins).toEqual(['https://app.maslaxat.uz', 'https://www.maslaxat.uz']);
    expect(config.smtp).toMatchObject({ port: 465, secure: true, pass: 'smtp-secret' });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.smtp)).toBe(true);
    expect(Object.isFrozen(config.cors.origins)).toBe(true);
  });

  test.each([
    ['JWT_SECRET', { JWT_SECRET: '' }],
    ['JWT_SECRET', { JWT_SECRET: 'short' }],
    ['JWT_SECRET', { JWT_SECRET: 'CHANGE_ME_RANDOM_256_BIT_SECRET' }],
    ['REDIS_URL', { REDIS_URL: '' }],
    ['FRONTEND_URL', { FRONTEND_URL: 'http://app.maslaxat.uz' }],
    ['CORS_ORIGINS', { CORS_ORIGINS: '*' }],
    ['CORS_ORIGINS', { CORS_ORIGINS: 'http://app.maslaxat.uz' }],
    ['CORS_ORIGINS', { FRONTEND_URL: 'https://other.maslaxat.uz' }],
    ['R2_ACCOUNT_ID', { R2_ACCOUNT_ID: 'not-32-hex' }],
    ['R2_PRIVATE_BUCKET', { R2_PRIVATE_BUCKET: 'CHANGE_ME_PRIVATE_BUCKET' }],
    ['CATALOG_ATTRIBUTION_SECRET', { CATALOG_ATTRIBUTION_SECRET: 'catalog-cursor-secret-with-32-characters' }],
    ['PAYMENT_V2_MODE', { PAYMENT_V2_MODE: 'active' }],
  ])('production rejects invalid %s configuration', (name, overrides) => {
    expect(invalidNames(productionEnv(overrides))).toContain(name);
  });

  test('production accepts a complete DB tuple when DATABASE_URL is absent', () => {
    const env = productionEnv({
      DATABASE_URL: '',
      DB_HOST: 'db.internal',
      DB_PORT: '5432',
      DB_NAME: 'maslaxat',
      DB_USER: 'app',
      DB_PASSWORD: 'db-secret',
    });

    expect(loadEnv(env).database).toMatchObject({ host: 'db.internal', port: 5432, name: 'maslaxat' });
  });

  test('production rejects an incomplete DB tuple by variable name', () => {
    const names = invalidNames(productionEnv({ DATABASE_URL: '', DB_HOST: 'db.internal' }));

    expect(names).toEqual(expect.arrayContaining(['DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']));
  });

  test.each([
    ['Payme', { PAYME_KEY: 'payme-secret' }, ['PAYME_MERCHANT_ID']],
    ['SMTP', { SMTP_HOST: 'smtp.example.com' }, ['SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']],
    ['TURN', { TURN_URL: 'turn:turn.example.com:3478' }, ['TURN_USERNAME', 'TURN_CREDENTIAL']],
    ['VAPID', { VAPID_PUBLIC_KEY: 'public' }, ['VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']],
    ['Telegram', { TELEGRAM_BOT_TOKEN: 'token' }, ['TELEGRAM_BOT_USERNAME']],
  ])('rejects an incomplete optional %s tuple', (_label, values, expectedNames) => {
    expect(invalidNames(productionEnv(values))).toEqual(expect.arrayContaining(expectedNames));
  });

  test('shadow mode requires Payme but never application-runtime evidence signing material', () => {
    const names = invalidNames(productionEnv({ PAYMENT_V2_MODE: 'shadow' }));

    expect(names).toEqual(expect.arrayContaining([
      'PAYME_KEY',
      'PAYME_MERCHANT_ID',
    ]));
    expect(names).not.toEqual(expect.arrayContaining([
      'PAYMENT_SHADOW_EVIDENCE_KEY',
      'PAYMENT_RELEASE_COMMIT_SHA',
    ]));

    const config = loadEnv(productionEnv({
      PAYMENT_V2_MODE: 'shadow', PAYME_KEY: 'payme-secret', PAYME_MERCHANT_ID: 'merchant-id',
    }));
    expect(config.payment).toEqual(expect.objectContaining({ mode: 'shadow', shadow: null }));
  });

  test.each([
    [{ ANTHROPIC_API_KEY: 'sk-ant-CHANGE_ME' }, ['ANTHROPIC_API_KEY']],
    [{ SMS_PROVIDER: 'eskiz', ESKIZ_EMAIL: 'sms@example.com' }, ['ESKIZ_PASSWORD']],
    [{ SMS_PROVIDER: 'playmobile', PLAYMOBILE_URL: 'https://sms.example.com' }, ['PLAYMOBILE_LOGIN', 'PLAYMOBILE_PASSWORD']],
  ])('rejects invalid optional provider configuration', (values, expectedNames) => {
    expect(invalidNames(productionEnv(values))).toEqual(expect.arrayContaining(expectedNames));

    if (values.SMS_PROVIDER === 'eskiz') {
      const oppositeNames = invalidNames(productionEnv({
        SMS_PROVIDER: 'eskiz',
        ESKIZ_EMAIL: 'sms@example.com',
        ESKIZ_PASSWORD: 'eskiz-secret',
        PLAYMOBILE_LOGIN: 'other-provider',
      }));
      expect(oppositeNames).toEqual(expect.arrayContaining(['PLAYMOBILE_URL', 'PLAYMOBILE_PASSWORD']));
    }
    if (values.SMS_PROVIDER === 'playmobile') {
      const oppositeNames = invalidNames(productionEnv({
        SMS_PROVIDER: 'playmobile',
        PLAYMOBILE_URL: 'https://sms.example.com',
        PLAYMOBILE_LOGIN: 'play-login',
        PLAYMOBILE_PASSWORD: 'play-secret',
        ESKIZ_EMAIL: 'other@example.com',
      }));
      expect(oppositeNames).toContain('ESKIZ_PASSWORD');
    }
  });

  test('rejects SMTP_PASSWORD instead of silently treating it as SMTP_PASS', () => {
    const names = invalidNames(productionEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'legacy-secret',
      SMTP_FROM: 'noreply@maslaxat.uz',
    }));

    expect(names).toContain('SMTP_PASSWORD');
    expect(names).toContain('SMTP_PASS');
  });

  test('diagnostics include names only and never rejected values', () => {
    const leakedSecret = 'short-secret-value';

    expect(() => loadEnv(productionEnv({ JWT_SECRET: leakedSecret }))).toThrow(EnvConfigError);
    try {
      loadEnv(productionEnv({ JWT_SECRET: leakedSecret }));
    } catch (error) {
      expect(error.message).toContain('JWT_SECRET');
      expect(error.message).not.toContain(leakedSecret);
      expect(Object.keys(error)).toEqual(['name', 'names']);
    }

    [
      'https://app.maslaxat.uz/path',
      'https://app.maslaxat.uz?query=1',
      'https://app.maslaxat.uz#fragment',
      'https://user:password@app.maslaxat.uz',
    ].forEach((corsOrigin) => {
      expect(invalidNames(productionEnv({ CORS_ORIGINS: corsOrigin }))).toContain('CORS_ORIGINS');
    });
  });

  test('development and test use local safe defaults without provider credentials', () => {
    const development = loadEnv({ NODE_ENV: 'development' });
    const test = loadEnv({ NODE_ENV: 'test' });

    expect(development.frontendUrl).toBe('http://localhost:3000');
    expect(development.database).toMatchObject({ host: 'localhost', port: 5432 });
    expect(development.redis.url).toBe('redis://localhost:6379');
    expect(development.smtp).toBeNull();
    expect(test.smtp).toBeNull();
    expect(test.r2).toBeNull();
    expect(development.fileStorage).toMatchObject({ writeMode: 'dual', localFallback: true });
    expect(test.fileStorage).toMatchObject({ writeMode: 'dual', localFallback: true });
  });

  test('production defaults file persistence to R2 without local fallback', () => {
    expect(loadEnv(productionEnv()).fileStorage).toEqual({
      writeMode: 'r2',
      localFallback: false,
      localRoot: expect.any(String),
    });
  });

  test('capability_only accepts only a complete exact evidence and approval tuple', () => {
    const key = Buffer.from('public-key-placeholder').toString('base64');
    const config = loadEnv(productionEnv({
      AUTHORIZATION_MODE: 'capability_only',
      AUTHORIZATION_EVIDENCE_PATH: '/run/secrets/authorization-manifest.json',
      AUTHORIZATION_EVIDENCE_PUBLIC_KEY_B64: key,
      AUTHORIZATION_EVIDENCE_KEY_ID: 'authorization-evidence-v1',
      AUTHORIZATION_SECURITY_APPROVAL_PUBLIC_KEY_B64: key,
      AUTHORIZATION_SECURITY_APPROVAL_KEY_ID: 'security-owner-v1',
      AUTHORIZATION_RELEASE_APPROVAL_PUBLIC_KEY_B64: key,
      AUTHORIZATION_RELEASE_APPROVAL_KEY_ID: 'release-owner-v1',
      AUTHORIZATION_CUTOVER_APPROVAL_PUBLIC_KEY_B64: key,
      AUTHORIZATION_CUTOVER_APPROVAL_KEY_ID: 'cutover-owner-v1',
    }));

    expect(config.authorization.mode).toBe('capability_only');
    expect(config.authorization.evidence.manifestKeyId).toBe('authorization-evidence-v1');
  });

  test('pins the externally configured AI temp lifecycle safety net to one day', () => {
    expect(loadEnv(productionEnv()).r2Lifecycle).toEqual({ aiTempDays: 1 });
    expect(loadEnv(productionEnv({ R2_AI_TEMP_LIFECYCLE_DAYS: '1' })).r2Lifecycle)
      .toEqual({ aiTempDays: 1 });
    expect(invalidNames(productionEnv({ R2_AI_TEMP_LIFECYCLE_DAYS: '2' })))
      .toContain('R2_AI_TEMP_LIFECYCLE_DAYS');
  });

  test.each([
    [{ FILE_STORAGE_WRITE_MODE: 'local' }, ['FILE_STORAGE_WRITE_MODE']],
    [{ FILE_STORAGE_LOCAL_FALLBACK: 'sometimes' }, ['FILE_STORAGE_LOCAL_FALLBACK']],
    [{ FILE_STORAGE_LOCAL_ROOT: '\u0000invalid' }, ['FILE_STORAGE_LOCAL_ROOT']],
    [{ FILE_STORAGE_LOCAL_ROOT: '' }, ['FILE_STORAGE_LOCAL_ROOT']],
    [{ FILE_STORAGE_LOCAL_ROOT: '/' }, ['FILE_STORAGE_LOCAL_ROOT']],
    [{ FILE_STORAGE_LOCAL_ROOT: './uploads' }, ['FILE_STORAGE_LOCAL_ROOT']],
    [{ FILE_STORAGE_LOCAL_ROOT: '/var/lib/../etc' }, ['FILE_STORAGE_LOCAL_ROOT']],
  ])('rejects invalid file storage configuration', (overrides, names) => {
    expect(invalidNames(productionEnv(overrides))).toEqual(expect.arrayContaining(names));
  });

  test('development rejects filesystem root but safely resolves a relative local root', () => {
    expect(invalidNames({ NODE_ENV: 'development', FILE_STORAGE_LOCAL_ROOT: '/' }))
      .toContain('FILE_STORAGE_LOCAL_ROOT');
    expect(loadEnv({ NODE_ENV: 'development', FILE_STORAGE_LOCAL_ROOT: './test-uploads' }).fileStorage.localRoot)
      .toBe(require('path').resolve('./test-uploads'));
  });

  test('accepts explicit dual writes and local fallback with a realpath-capable root', () => {
    expect(loadEnv(productionEnv({
      FILE_STORAGE_WRITE_MODE: 'dual',
      FILE_STORAGE_LOCAL_FALLBACK: 'true',
      FILE_STORAGE_LOCAL_ROOT: '/var/lib/emaslaxat/uploads',
    })).fileStorage).toEqual({
      writeMode: 'dual',
      localFallback: true,
      localRoot: '/var/lib/emaslaxat/uploads',
    });
  });

  test('test accepts a public checkout merchant without a Payme credential', () => {
    const config = loadEnv({ NODE_ENV: 'test', PAYME_MERCHANT_ID: 'test-merchant-id' });

    expect(config.payment.mode).toBe('legacy');
    expect(config.payment.payme).toBeNull();
    expect(invalidNames({ NODE_ENV: 'test', PAYME_MERCHANT_ID: 'another-merchant' })).toContain('PAYME_KEY');
    expect(invalidNames({
      NODE_ENV: 'test',
      PAYME_MERCHANT_ID: 'test-merchant-id',
      PAYMENT_V2_MODE: 'legacy',
    })).toContain('PAYME_KEY');
  });
});
