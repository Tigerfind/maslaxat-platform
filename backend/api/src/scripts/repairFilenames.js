/**
 * Разовый ремонт имён уже загруженных файлов.
 *
 * До исправления multer-кодировки имена сохранялись как latin1-байты, поэтому
 * кириллические названия лежат в базе «иероглифами». Новые загрузки уже
 * приходят правильными, а старые записи нужно починить отдельно.
 *
 * Скрипт идемпотентен: корректные имена не трогает (decodeUploadFilename
 * возвращает их без изменений), поэтому повторный запуск безопасен.
 *
 * Запуск:  node src/scripts/repairFilenames.js          — показать, что будет
 *          node src/scripts/repairFilenames.js --apply  — применить
 */
require('dotenv').config();
const { Document, CaseDocument, LawyerDocument } = require('../models');
const { decodeUploadFilename } = require('../utils/uploadFilename');

const MODELS = [
  ['Document', Document],
  ['CaseDocument', CaseDocument],
  ['LawyerDocument', LawyerDocument],
];

async function repair({ apply }) {
  let scanned = 0; let broken = 0;
  for (const [label, Model] of MODELS) {
    if (!Model) continue;
    const rows = await Model.findAll({ attributes: ['id', 'name'] });
    for (const row of rows) {
      scanned += 1;
      const fixed = decodeUploadFilename(row.name);
      if (fixed && fixed !== row.name) {
        broken += 1;
        console.log(`${label} ${row.id}\n  было : ${row.name}\n  стало: ${fixed}`);
        if (apply) await row.update({ name: fixed });
      }
    }
  }
  console.log(`\nПроверено записей: ${scanned}. Испорченных имён: ${broken}.`);
  console.log(apply ? 'Имена исправлены.' : 'Это предпросмотр — запустите с --apply, чтобы применить.');
  return { scanned, broken };
}

module.exports = { repair };

if (require.main === module) {
  repair({ apply: process.argv.includes('--apply') })
    .then(() => process.exit(0))
    .catch((error) => { console.error('Ошибка ремонта:', error.message); process.exit(1); });
}
