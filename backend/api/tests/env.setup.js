// Грузит .env (для DB_USER/DB_PASSWORD), затем ПРИНУДИТЕЛЬНО переключает на тестовую БД.
// Прямое присваивание после dotenv гарантирует override (dotenv не перезаписывает уже заданное).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
process.env.DB_NAME = process.env.TEST_DB_NAME || 'emaslaxat_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-jest';
process.env.FILE_STORAGE_WRITE_MODE = 'r2';
process.env.FILE_STORAGE_LOCAL_FALLBACK = '0';
process.env.FILE_STORAGE_LOCAL_ROOT = path.join(__dirname, '..', 'uploads');

// Real provider credentials from a developer .env must never leak into tests. A dedicated
// integration harness may opt in explicitly; ordinary Jest runs are network-isolated.
if (process.env.ALLOW_TEST_NETWORK_ENV !== '1') {
  [
    'REDIS_URL',
    'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PRIVATE_BUCKET',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_USER', 'SMTP_PASS',
    'SMTP_PASSWORD', 'SMTP_FROM',
    'PAYME_KEY', 'PAYME_MERCHANT_ID', 'PAYMENT_V2_MODE', 'PAYMENT_SHADOW_EVIDENCE_KEY',
    'PAYMENT_RELEASE_COMMIT_SHA',
    'ANTHROPIC_API_KEY',
    'TURN_URL', 'TURN_USERNAME', 'TURN_CREDENTIAL',
    'SMS_PROVIDER', 'ESKIZ_EMAIL', 'ESKIZ_PASSWORD', 'ESKIZ_FROM', 'ESKIZ_BASE_URL',
    'PLAYMOBILE_URL', 'PLAYMOBILE_LOGIN', 'PLAYMOBILE_PASSWORD', 'PLAYMOBILE_FROM',
    'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
    'GOOGLE_CLIENT_ID', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME',
    'SENTRY_BACKEND_DSN',
    'AUTHORIZATION_MODE', 'AUTHORIZATION_EVIDENCE_PATH',
    'AUTHORIZATION_EVIDENCE_PUBLIC_KEY_B64', 'AUTHORIZATION_EVIDENCE_KEY_ID',
    'AUTHORIZATION_SECURITY_APPROVAL_PUBLIC_KEY_B64', 'AUTHORIZATION_SECURITY_APPROVAL_KEY_ID',
    'AUTHORIZATION_RELEASE_APPROVAL_PUBLIC_KEY_B64', 'AUTHORIZATION_RELEASE_APPROVAL_KEY_ID',
    'AUTHORIZATION_CUTOVER_APPROVAL_PUBLIC_KEY_B64', 'AUTHORIZATION_CUTOVER_APPROVAL_KEY_ID',
    'AUTHORIZATION_RELEASE_COMMIT_SHA', 'AUTHORIZATION_DEPLOYMENT_ID', 'AUTHORIZATION_SERVICE_ID',
    'AUTHORIZATION_CONFIG_DIGEST', 'AUTHORIZATION_MIGRATION_HEAD',
    'RAILWAY_GIT_COMMIT_SHA', 'RAILWAY_DEPLOYMENT_ID', 'RAILWAY_SERVICE_ID',
    'AUTHORIZATION_METADATA_TOKEN',
  ].forEach((name) => delete process.env[name]);

  process.env.PAYME_MERCHANT_ID = 'test-merchant-id';
}
