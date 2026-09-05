const { decodeUploadFilename } = require('../src/utils/uploadFilename');

// Multer отдаёт filename как latin1-байты. Кириллическое «Счет.pdf» приезжает
// как «Ð¡ÑÐµÑ.pdf» — эти «иероглифы» клиент видел в списке документов.
const asMulterSees = (name) => Buffer.from(name, 'utf8').toString('latin1');

describe('имя загруженного файла', () => {
  test('кириллица восстанавливается точь-в-точь', () => {
    const original = 'Счет по услугам за сентябрь.pdf';
    expect(decodeUploadFilename(asMulterSees(original))).toBe(original);
  });

  test('узбекская латиница с диакритикой не теряется', () => {
    const original = 'Shartnoma — to‘lov ilovasi.pdf';
    expect(decodeUploadFilename(asMulterSees(original))).toBe(original);
  });

  test('уже корректное имя не портится повторным преобразованием', () => {
    const original = 'Договор аренды.pdf';
    expect(decodeUploadFilename(original)).toBe(original);
    // двойной прогон тоже безопасен
    expect(decodeUploadFilename(decodeUploadFilename(asMulterSees(original)))).toBe(original);
  });

  test('латиница и цифры проходят без изменений', () => {
    expect(decodeUploadFilename('invoice-2026-09.pdf')).toBe('invoice-2026-09.pdf');
  });

  test('невалидные байты оставляем как есть, а не превращаем в мусор', () => {
    const broken = '\xFF\xFE\xFD.pdf';
    expect(decodeUploadFilename(broken)).toBe(broken);
  });

  test('пустое и нестроковое не ломают загрузку', () => {
    expect(decodeUploadFilename('')).toBe('');
    expect(decodeUploadFilename(undefined)).toBeUndefined();
    expect(decodeUploadFilename(null)).toBeNull();
  });
});
