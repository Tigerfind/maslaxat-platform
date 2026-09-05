/**
 * Имя загруженного файла в правильной кодировке.
 *
 * Multer (busboy) отдаёт filename из multipart-заголовка как latin1-байты.
 * Для кириллицы это значит, что «Счет по услугам.pdf» приезжает как
 * «Ð¡Ñ‡ÐµÑ‚ Ð¿Ð¾ ÑƒÑÐ»ÑƒÐ³Ð°Ð¼.pdf» — именно эти «иероглифы» клиент и видел
 * в списке документов.
 *
 * Признак latin1-байтов: все коды символов меньше 256. Настоящая кириллица
 * имеет коды больше 255 («С» = 1057), поэтому уже корректное имя сюда не
 * попадёт и повторно не сломается. Латиница и цифры проходят без изменений.
 */
function decodeUploadFilename(raw) {
  if (typeof raw !== 'string' || !raw) return raw;
  for (const ch of raw) {
    if (ch.charCodeAt(0) > 255) return raw;
  }
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('�') ? raw : decoded;
}

module.exports = { decodeUploadFilename };
