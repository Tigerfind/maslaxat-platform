// Идемпотентно создаёт индексы, которые есть ТОЛЬКО в миграциях и не выражаются
// в моделях (→ sync() их не создаёт). Нужно для прод-БД, поднятой через sync().
// Логика 1:1 повторяет миграции 20260807000000 и 20260808000001, но инлайном,
// т.к. в контейнер (Dockerfile COPY src/) папка migrations/ не попадает.
//
// Безопасно: перед CREATE проверяет наличие индекса и конфликтующих дублей,
// при дублях НЕ трогает данные, а бросает понятную ошибку.
const { exitAfterFatal } = require('../instrument');
const logger = require('../config/logger');
const { sequelize } = require('../models');

async function indexExists(name) {
  const [rows] = await sequelize.query(
    'SELECT 1 FROM pg_indexes WHERE indexname = :name',
    { replacements: { name } }
  );
  return rows.length > 0;
}

async function ensureProdIndexes() {
  const created = [];
  const skipped = [];

  // 1) consultations_loyalty_free_unique — частичный уникальный индекс
  const LOYALTY = 'consultations_loyalty_free_unique';
  if (await indexExists(LOYALTY)) {
    skipped.push(LOYALTY);
  } else {
    const [dups] = await sequelize.query(`
      SELECT client_id, COUNT(*) AS n
      FROM consultations
      WHERE free_source = 'loyalty' AND status <> 'rejected'
      GROUP BY client_id HAVING COUNT(*) > 1
    `);
    if (dups.length > 0) {
      throw new Error(`Cannot create ${LOYALTY}: ${dups.length} client(s) have >1 non-rejected loyalty-free consultation. Resolve manually (rows may have payments).`);
    }
    await sequelize.query(`
      CREATE UNIQUE INDEX ${LOYALTY}
      ON consultations (client_id)
      WHERE free_source = 'loyalty' AND status <> 'rejected'
    `);
    created.push(LOYALTY);
  }

  // 2) reviews_consultation_id_unique — один отзыв на консультацию
  const REVIEW = 'reviews_consultation_id_unique';
  if (await indexExists(REVIEW)) {
    skipped.push(REVIEW);
  } else {
    const [dups] = await sequelize.query(`
      SELECT consultation_id, COUNT(*) AS n
      FROM reviews
      WHERE consultation_id IS NOT NULL
      GROUP BY consultation_id HAVING COUNT(*) > 1
    `);
    if (dups.length > 0) {
      throw new Error(`Cannot create ${REVIEW}: ${dups.length} consultation(s) have duplicate reviews. Resolve manually.`);
    }
    await sequelize.query(`CREATE UNIQUE INDEX ${REVIEW} ON reviews (consultation_id)`);
    created.push(REVIEW);
  }

  return { created, skipped };
}

module.exports = { ensureProdIndexes };

if (require.main === module) {
  ensureProdIndexes()
    .then((r) => { console.log('OK', r); process.exit(0); })
    .catch((e) => exitAfterFatal(e, { operation: 'ensure_production_indexes_cli' }, { logger }));
}
