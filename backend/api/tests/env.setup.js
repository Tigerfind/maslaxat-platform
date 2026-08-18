// Грузит .env (для DB_USER/DB_PASSWORD), затем ПРИНУДИТЕЛЬНО переключает на тестовую БД.
// Прямое присваивание после dotenv гарантирует override (dotenv не перезаписывает уже заданное).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'emaslaxat_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-jest';
process.env.PAYME_MERCHANT_ID = process.env.PAYME_MERCHANT_ID || 'test-merchant-id';
// В тестах Redis не поднимаем — код работает без него (fail-open на лимитах).
delete process.env.REDIS_URL;
