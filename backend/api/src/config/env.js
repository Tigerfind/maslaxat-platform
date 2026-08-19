'use strict';

const path = require('path');

class EnvConfigError extends Error {
  constructor(names) {
    const uniqueNames = [...new Set(names)].sort();
    super(`Invalid environment variables: ${uniqueNames.join(', ')}`);
    this.name = 'EnvConfigError';
    this.names = Object.freeze(uniqueNames);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function text(env, name) {
  return typeof env[name] === 'string' ? env[name].trim() : '';
}

function isPlaceholder(value) {
  return !value || /^change[-_ ]?me/i.test(value) || /^your[-_ ]/i.test(value)
    || value === 'sk-ant-CHANGE_ME' || value === 'change-this-to-a-long-random-string';
}

function integer(env, name, fallback, issues, { min = 1, max = 65535 } = {}) {
  const raw = text(env, name);
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    issues.push(name);
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    issues.push(name);
    return fallback;
  }
  return parsed;
}

function boolean(env, name, fallback, issues) {
  const raw = text(env, name).toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  issues.push(name);
  return fallback;
}

function validUrl(value, protocols) {
  try {
    const parsed = new URL(value);
    return protocols.includes(parsed.protocol) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function completeTuple(env, names, issues, { required = false } = {}) {
  const values = Object.fromEntries(names.map((name) => [name, text(env, name)]));
  const any = names.some((name) => values[name]);
  if (required || any) {
    names.forEach((name) => {
      if (!values[name] || isPlaceholder(values[name])) issues.push(name);
    });
  }
  return any || required ? values : null;
}

function parseSmtp(env, issues) {
  if (text(env, 'SMTP_PASSWORD')) issues.push('SMTP_PASSWORD');
  const names = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
  const tuple = completeTuple(env, names, issues);
  if (!tuple) return null;

  const port = integer(env, 'SMTP_PORT', 587, issues);
  const secure = boolean(env, 'SMTP_SECURE', false, issues);
  const requireTLS = boolean(env, 'SMTP_REQUIRE_TLS', false, issues);
  if (secure && requireTLS) issues.push('SMTP_REQUIRE_TLS');
  return {
    host: tuple.SMTP_HOST,
    port,
    secure,
    requireTLS,
    user: tuple.SMTP_USER,
    pass: tuple.SMTP_PASS,
    from: tuple.SMTP_FROM,
  };
}

function loadSmtpConfig(env = process.env) {
  const issues = [];
  const smtp = parseSmtp(env, issues);
  if (issues.length) throw new EnvConfigError(issues);
  return deepFreeze(smtp);
}

function parseNodeEnv(env, issues) {
  const nodeEnv = text(env, 'NODE_ENV') || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) issues.push('NODE_ENV');
  return nodeEnv;
}

function parseFrontendUrl(env, nodeEnv, issues) {
  const production = nodeEnv === 'production';
  const value = text(env, 'FRONTEND_URL') || (production ? '' : 'http://localhost:3000');
  const parsed = validUrl(value, production ? ['https:'] : ['http:', 'https:']);
  if (!parsed || (production && isPlaceholder(value))) issues.push('FRONTEND_URL');
  return parsed?.origin || value;
}

function loadEmailConfig(env = process.env) {
  const issues = [];
  const nodeEnv = parseNodeEnv(env, issues);
  const frontendUrl = parseFrontendUrl(env, nodeEnv, issues);
  const smtp = parseSmtp(env, issues);
  if (issues.length) throw new EnvConfigError(issues);
  return deepFreeze({ nodeEnv, production: nodeEnv === 'production', frontendUrl, smtp });
}

function loadEnv(env = process.env) {
  const issues = [];
  const nodeEnv = parseNodeEnv(env, issues);
  const production = nodeEnv === 'production';

  const port = integer(env, 'PORT', 3001, issues);
  const jwtSecret = text(env, 'JWT_SECRET') || (production ? '' : 'local-development-secret-not-for-production');
  if (production && (jwtSecret.length < 32 || isPlaceholder(jwtSecret))) issues.push('JWT_SECRET');

  const databaseUrl = text(env, 'DATABASE_URL');
  let database;
  if (databaseUrl) {
    if (!validUrl(databaseUrl, ['postgres:', 'postgresql:']) || isPlaceholder(databaseUrl)) {
      issues.push('DATABASE_URL');
    }
    database = { url: databaseUrl, ssl: text(env, 'DB_SSL') === '1' || /sslmode=require/i.test(databaseUrl) };
  } else {
    const dbNames = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
    const tuple = production ? completeTuple(env, dbNames, issues, { required: true }) : null;
    database = {
      url: null,
      host: tuple?.DB_HOST || text(env, 'DB_HOST') || 'localhost',
      port: integer(env, 'DB_PORT', 5432, issues),
      name: tuple?.DB_NAME || text(env, 'DB_NAME') || (nodeEnv === 'test' ? 'emaslaxat_test' : 'emaslaxat'),
      user: tuple?.DB_USER || text(env, 'DB_USER') || 'emaslaxat_user',
      password: tuple?.DB_PASSWORD || text(env, 'DB_PASSWORD') || (production ? '' : 'password'),
      ssl: text(env, 'DB_SSL') === '1',
    };
  }

  const redisUrl = text(env, 'REDIS_URL') || (production ? '' : 'redis://localhost:6379');
  if (production && (!redisUrl || !validUrl(redisUrl, ['redis:', 'rediss:']))) issues.push('REDIS_URL');
  if (!production && redisUrl && !validUrl(redisUrl, ['redis:', 'rediss:'])) issues.push('REDIS_URL');

  const frontendUrl = parseFrontendUrl(env, nodeEnv, issues);
  const frontend = validUrl(frontendUrl, production ? ['https:'] : ['http:', 'https:']);

  const corsRaw = text(env, 'CORS_ORIGINS') || (production ? '' : 'http://localhost:3000,http://localhost:5173');
  const corsOrigins = corsRaw.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!corsOrigins.length || corsOrigins.includes('*')) issues.push('CORS_ORIGINS');
  const parsedOrigins = corsOrigins.map((origin) => validUrl(origin, production ? ['https:'] : ['http:', 'https:']));
  if (parsedOrigins.some((parsed, index) => !parsed || parsed.origin !== corsOrigins[index])) issues.push('CORS_ORIGINS');
  if (frontend && !parsedOrigins.some((origin) => origin?.origin === frontend.origin)) issues.push('CORS_ORIGINS');

  const r2Names = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PRIVATE_BUCKET'];
  const r2Tuple = completeTuple(env, r2Names, issues, { required: production });
  if (r2Tuple && !/^[0-9a-f]{32}$/i.test(r2Tuple.R2_ACCOUNT_ID)) issues.push('R2_ACCOUNT_ID');
  const r2 = r2Tuple ? {
    accountId: r2Tuple.R2_ACCOUNT_ID.toLowerCase(),
    accessKeyId: r2Tuple.R2_ACCESS_KEY_ID,
    secretAccessKey: r2Tuple.R2_SECRET_ACCESS_KEY,
    bucket: r2Tuple.R2_PRIVATE_BUCKET,
  } : null;
  const aiTempLifecycleDays = Number.parseInt(text(env, 'R2_AI_TEMP_LIFECYCLE_DAYS') || '1', 10);
  if (aiTempLifecycleDays !== 1) issues.push('R2_AI_TEMP_LIFECYCLE_DAYS');

  const fileStorageWriteMode = text(env, 'FILE_STORAGE_WRITE_MODE').toLowerCase()
    || (production ? 'r2' : 'dual');
  if (!['dual', 'r2'].includes(fileStorageWriteMode)) issues.push('FILE_STORAGE_WRITE_MODE');
  const fileStorageLocalFallback = boolean(
    env,
    'FILE_STORAGE_LOCAL_FALLBACK',
    !production,
    issues
  );
  const configuredLocalRoot = text(env, 'FILE_STORAGE_LOCAL_ROOT');
  const localRootValue = configuredLocalRoot || path.resolve(process.cwd(), 'uploads');
  let fileStorageLocalRoot = localRootValue;
  try {
    const rawSegments = localRootValue.split(/[\\/]+/);
    if ((production && !configuredLocalRoot)
      || localRootValue.includes('\0')
      || /[\x00-\x1f]/.test(localRootValue)
      || rawSegments.includes('..')
      || (production && !path.isAbsolute(localRootValue))) {
      throw new TypeError('invalid path');
    }
    fileStorageLocalRoot = path.resolve(localRootValue);
    if (fileStorageLocalRoot === path.parse(fileStorageLocalRoot).root) {
      throw new TypeError('filesystem root is unsafe');
    }
  } catch (_error) {
    issues.push('FILE_STORAGE_LOCAL_ROOT');
  }

  const cursorSecret = text(env, 'CATALOG_CURSOR_SECRET');
  const attributionSecret = text(env, 'CATALOG_ATTRIBUTION_SECRET');
  if (production && (cursorSecret.length < 32 || isPlaceholder(cursorSecret))) issues.push('CATALOG_CURSOR_SECRET');
  if (production && (attributionSecret.length < 32 || isPlaceholder(attributionSecret))) issues.push('CATALOG_ATTRIBUTION_SECRET');
  if (production && [jwtSecret, cursorSecret].includes(attributionSecret)) issues.push('CATALOG_ATTRIBUTION_SECRET');
  if (production && cursorSecret === jwtSecret) issues.push('CATALOG_CURSOR_SECRET');

  const paymentModeValue = text(env, 'PAYMENT_V2_MODE').toLowerCase();
  const testCheckoutOnly = nodeEnv === 'test'
    && text(env, 'PAYME_MERCHANT_ID') === 'test-merchant-id'
    && !text(env, 'PAYME_KEY')
    && !paymentModeValue;
  const paymeTuple = testCheckoutOnly
    ? null
    : completeTuple(env, ['PAYME_KEY', 'PAYME_MERCHANT_ID'], issues);
  const paymentMode = paymentModeValue || 'legacy';
  if (!['legacy', 'shadow'].includes(paymentMode)) issues.push('PAYMENT_V2_MODE');
  if (paymentMode === 'shadow') {
    completeTuple(env, ['PAYME_KEY', 'PAYME_MERCHANT_ID'], issues, { required: true });
  }

  const smtp = parseSmtp(env, issues);
  const turnTuple = completeTuple(env, ['TURN_URL', 'TURN_USERNAME', 'TURN_CREDENTIAL'], issues);
  if (turnTuple && !validUrl(turnTuple.TURN_URL, ['turn:', 'turns:'])) issues.push('TURN_URL');

  const anthropicKey = text(env, 'ANTHROPIC_API_KEY');
  if (anthropicKey && isPlaceholder(anthropicKey)) issues.push('ANTHROPIC_API_KEY');

  const smsProvider = text(env, 'SMS_PROVIDER').toLowerCase();
  if (smsProvider && !['eskiz', 'playmobile'].includes(smsProvider)) issues.push('SMS_PROVIDER');
  const eskizTuple = completeTuple(env, ['ESKIZ_EMAIL', 'ESKIZ_PASSWORD'], issues, { required: smsProvider === 'eskiz' });
  const playmobileTuple = completeTuple(
    env,
    ['PLAYMOBILE_URL', 'PLAYMOBILE_LOGIN', 'PLAYMOBILE_PASSWORD'],
    issues,
    { required: smsProvider === 'playmobile' },
  );
  if (playmobileTuple?.PLAYMOBILE_URL && !validUrl(playmobileTuple.PLAYMOBILE_URL, ['http:', 'https:'])) {
    issues.push('PLAYMOBILE_URL');
  }
  let sms = null;
  if (smsProvider === 'eskiz' || (!smsProvider && eskizTuple)) {
    sms = { provider: 'eskiz', email: eskizTuple.ESKIZ_EMAIL, password: eskizTuple.ESKIZ_PASSWORD };
  } else if (smsProvider === 'playmobile' || (!smsProvider && playmobileTuple)) {
    sms = {
      provider: 'playmobile',
      url: playmobileTuple.PLAYMOBILE_URL,
      login: playmobileTuple.PLAYMOBILE_LOGIN,
      password: playmobileTuple.PLAYMOBILE_PASSWORD,
    };
  }

  const vapidTuple = completeTuple(env, ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'], issues);
  if (vapidTuple && !/^mailto:[^@\s]+@[^@\s]+$|^https:\/\//i.test(vapidTuple.VAPID_SUBJECT)) issues.push('VAPID_SUBJECT');
  const googleClientId = text(env, 'GOOGLE_CLIENT_ID');
  if (googleClientId && isPlaceholder(googleClientId)) issues.push('GOOGLE_CLIENT_ID');
  const telegramTuple = completeTuple(env, ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME'], issues);

  const authorizationMode = text(env, 'AUTHORIZATION_MODE').toLowerCase() || 'compatibility';
  if (!['compatibility', 'capability_only'].includes(authorizationMode)) issues.push('AUTHORIZATION_MODE');
  const runtimeIdentity = completeTuple(env, [
    'RAILWAY_GIT_COMMIT_SHA', 'RAILWAY_DEPLOYMENT_ID', 'RAILWAY_SERVICE_ID',
  ], issues, { required: production });
  const authorizationEvidenceNames = [
    'AUTHORIZATION_EVIDENCE_PATH',
    'AUTHORIZATION_EVIDENCE_PUBLIC_KEY_B64', 'AUTHORIZATION_EVIDENCE_KEY_ID',
    'AUTHORIZATION_SECURITY_APPROVAL_PUBLIC_KEY_B64', 'AUTHORIZATION_SECURITY_APPROVAL_KEY_ID',
    'AUTHORIZATION_RELEASE_APPROVAL_PUBLIC_KEY_B64', 'AUTHORIZATION_RELEASE_APPROVAL_KEY_ID',
    'AUTHORIZATION_CUTOVER_APPROVAL_PUBLIC_KEY_B64', 'AUTHORIZATION_CUTOVER_APPROVAL_KEY_ID',
  ];
  const authorizationEvidence = completeTuple(env, authorizationEvidenceNames, issues, {
    required: authorizationMode === 'capability_only',
  });
  const authorizationMetadataToken = text(env, 'AUTHORIZATION_METADATA_TOKEN');
  if (production && (authorizationMetadataToken.length < 32 || isPlaceholder(authorizationMetadataToken))) {
    issues.push('AUTHORIZATION_METADATA_TOKEN');
  }
  if (runtimeIdentity && !/^[a-f0-9]{40}$/i.test(runtimeIdentity.RAILWAY_GIT_COMMIT_SHA || '')) {
    issues.push('RAILWAY_GIT_COMMIT_SHA');
  }

  if (issues.length) throw new EnvConfigError(issues);

  return deepFreeze({
    nodeEnv,
    production,
    port,
    jwt: { secret: jwtSecret, expiresIn: text(env, 'JWT_EXPIRES_IN') || '7d' },
    database,
    redis: { url: redisUrl },
    cors: { origins: parsedOrigins.map((origin) => origin.origin) },
    frontendUrl,
    r2,
    r2Lifecycle: { aiTempDays: aiTempLifecycleDays },
    fileStorage: {
      writeMode: fileStorageWriteMode,
      localFallback: fileStorageLocalFallback,
      localRoot: fileStorageLocalRoot,
    },
    catalog: {
      cursorSecret: cursorSecret || jwtSecret,
      attributionSecret: attributionSecret || cursorSecret || jwtSecret,
      cookieCrossSite: text(env, 'CATALOG_COOKIE_CROSS_SITE') === '1',
    },
    payment: {
      mode: paymentMode,
      payme: paymeTuple ? { key: paymeTuple.PAYME_KEY, merchantId: paymeTuple.PAYME_MERCHANT_ID } : null,
      shadow: null,
    },
    smtp,
    turn: turnTuple ? { url: turnTuple.TURN_URL, username: turnTuple.TURN_USERNAME, credential: turnTuple.TURN_CREDENTIAL } : null,
    anthropic: anthropicKey ? { apiKey: anthropicKey } : null,
    sms,
    vapid: vapidTuple ? { publicKey: vapidTuple.VAPID_PUBLIC_KEY, privateKey: vapidTuple.VAPID_PRIVATE_KEY, subject: vapidTuple.VAPID_SUBJECT } : null,
    social: {
      googleClientId: googleClientId || null,
      telegram: telegramTuple ? { token: telegramTuple.TELEGRAM_BOT_TOKEN, username: telegramTuple.TELEGRAM_BOT_USERNAME } : null,
    },
    authorization: {
      mode: authorizationMode,
      metadataToken: authorizationMetadataToken || null,
      evidence: authorizationEvidence ? {
        path: authorizationEvidence.AUTHORIZATION_EVIDENCE_PATH,
        manifestPublicKey: Buffer.from(authorizationEvidence.AUTHORIZATION_EVIDENCE_PUBLIC_KEY_B64, 'base64').toString('utf8'),
        manifestKeyId: authorizationEvidence.AUTHORIZATION_EVIDENCE_KEY_ID,
        approvalKeys: {
          security_owner: {
            publicKey: Buffer.from(authorizationEvidence.AUTHORIZATION_SECURITY_APPROVAL_PUBLIC_KEY_B64, 'base64').toString('utf8'),
            keyId: authorizationEvidence.AUTHORIZATION_SECURITY_APPROVAL_KEY_ID,
          },
          release_owner: {
            publicKey: Buffer.from(authorizationEvidence.AUTHORIZATION_RELEASE_APPROVAL_PUBLIC_KEY_B64, 'base64').toString('utf8'),
            keyId: authorizationEvidence.AUTHORIZATION_RELEASE_APPROVAL_KEY_ID,
          },
          cutover_owner: {
            publicKey: Buffer.from(authorizationEvidence.AUTHORIZATION_CUTOVER_APPROVAL_PUBLIC_KEY_B64, 'base64').toString('utf8'),
            keyId: authorizationEvidence.AUTHORIZATION_CUTOVER_APPROVAL_KEY_ID,
          },
        },
      } : null,
    },
  });
}

module.exports = { EnvConfigError, loadEmailConfig, loadEnv, loadSmtpConfig };
