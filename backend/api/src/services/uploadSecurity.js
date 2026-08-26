const fs = require('fs');
const path = require('path');

const FORMATS = {
  '.pdf': { mimes: ['application/pdf'], matches: (b) => b.subarray(0, 5).toString() === '%PDF-' },
  '.jpg': { mimes: ['image/jpeg'], matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.jpeg': { mimes: ['image/jpeg'], matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.png': { mimes: ['image/png'], matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  '.webp': { mimes: ['image/webp'], matches: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  '.gif': { mimes: ['image/gif'], matches: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString()) },
  '.doc': { mimes: ['application/msword'], matches: (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) },
  '.docx': { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], matches: (b) => b[0] === 0x50 && b[1] === 0x4b && [0x03, 0x05, 0x07].includes(b[2]) && b.includes(Buffer.from('[Content_Types].xml')) && b.includes(Buffer.from('word/')) },
  '.txt': { mimes: ['text/plain'], matches: (b) => !b.includes(0) },
};

const AVATAR_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.jpg', '.jpeg', '.png'];
const CASE_DOCUMENT_EXTENSIONS = [...DOCUMENT_EXTENSIONS, '.webp'];
const VERIFICATION_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
const AI_ATTACHMENT_EXTENSIONS = [...DOCUMENT_EXTENSIONS, '.gif'];

const safeOriginalName = (name) => path.basename(String(name || 'file'))
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .slice(0, 255) || 'file';

const fileFilterFor = (allowedExtensions) => (req, file, callback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const format = FORMATS[ext];
  if (!allowedExtensions.includes(ext) || !format || !format.mimes.includes(file.mimetype)) {
    const error = new Error('Неподдерживаемый или несоответствующий формат файла');
    error.status = 400;
    return callback(error);
  }
  file.originalname = safeOriginalName(file.originalname);
  callback(null, true);
};

const createWithinUploadQuota = async ({ Model, where, values, maxFiles, maxBytes }) => {
  return Model.sequelize.transaction(async (transaction) => {
    const scope = `${Model.tableName}:${JSON.stringify(where)}`;
    await Model.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:scope))', { replacements: { scope }, transaction });
    const records = await Model.findAll({ where, attributes: ['size'], raw: true, transaction });
    const usedBytes = records.reduce((sum, record) => sum + (Number(record.size) || 0), 0);
    if (records.length >= maxFiles || usedBytes + (Number(values.size) || 0) > maxBytes) return null;
    return Model.create(values, { transaction });
  });
};

const uploadedFiles = (req) => [req.file, ...(Array.isArray(req.files) ? req.files : [])].filter(Boolean);

const cleanupUploadedFiles = (req) => {
  for (const file of uploadedFiles(req)) {
    if (file.path) fs.promises.unlink(file.path).catch(() => {});
  }
};

const validateUploadSignatures = (allowedExtensions) => async (req, res, next) => {
  try {
    for (const file of uploadedFiles(req)) {
      const ext = path.extname(file.originalname).toLowerCase();
      const format = FORMATS[ext];
      if (!allowedExtensions.includes(ext) || !format || !file.path) throw new Error('INVALID_FILE_TYPE');
      if (ext === '.docx' && file.size > 5 * 1024 * 1024) throw new Error('DOCX_TOO_LARGE');
      const buffer = Buffer.alloc(ext === '.docx' ? file.size : ext === '.txt' ? 4096 : 16);
      const handle = await fs.promises.open(file.path, 'r');
      let bytesRead;
      try {
        ({ bytesRead } = await handle.read(buffer, 0, buffer.length, 0));
      } finally {
        await handle.close();
      }
      if (!bytesRead || !format.matches(buffer.subarray(0, bytesRead))) throw new Error('INVALID_FILE_SIGNATURE');
    }
    next();
  } catch (error) {
    cleanupUploadedFiles(req);
    res.status(400).json({ error: 'Содержимое файла не соответствует заявленному формату' });
  }
};

module.exports = {
  AVATAR_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  CASE_DOCUMENT_EXTENSIONS,
  VERIFICATION_EXTENSIONS,
  AI_ATTACHMENT_EXTENSIONS,
  fileFilterFor,
  validateUploadSignatures,
  cleanupUploadedFiles,
  safeOriginalName,
  createWithinUploadQuota,
};
