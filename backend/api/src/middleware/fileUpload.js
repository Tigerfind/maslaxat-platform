'use strict';

const path = require('path');
const multer = require('multer');

const FILE_TYPES = Object.freeze({
  pdf: { extensions: ['.pdf'], mimes: ['application/pdf'], magic: (body) => body.subarray(0, 5).equals(Buffer.from('%PDF-')) },
  doc: { extensions: ['.doc'], mimes: ['application/msword'], magic: (body) => body.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])) },
  docx: {
    extensions: ['.docx'],
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    magic: (body) => body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  },
  txt: {
    extensions: ['.txt'],
    mimes: ['text/plain'],
    magic: (body) => body.length > 0 && !body.includes(0) && !body.toString('utf8').includes('\ufffd'),
  },
  jpeg: {
    extensions: ['.jpg', '.jpeg'],
    mimes: ['image/jpeg'],
    magic: (body) => body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff,
  },
  png: {
    extensions: ['.png'],
    mimes: ['image/png'],
    magic: (body) => body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  webp: {
    extensions: ['.webp'],
    mimes: ['image/webp'],
    magic: (body) => body.length >= 12
      && body.subarray(0, 4).toString('ascii') === 'RIFF'
      && body.subarray(8, 12).toString('ascii') === 'WEBP',
  },
});

function uploadError(message) {
  return Object.assign(new Error(message), { status: 400, code: 'INVALID_FILE_UPLOAD' });
}

function createMemoryUpload({ types, maxBytes }) {
  const allowed = types.map((type) => FILE_TYPES[type]);
  if (allowed.some((type) => !type)) throw new TypeError('Unsupported upload file type');
  const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes } });

  function single(field) {
    const parse = parser.single(field);
    return (req, res, next) => parse(req, res, (error) => {
      if (error) return next(uploadError('Файл превышает допустимый размер'));
      if (!req.file) return next();
      const extension = path.extname(req.file.originalname || '').toLowerCase();
      const type = allowed.find((candidate) => candidate.extensions.includes(extension)
        && candidate.mimes.includes(req.file.mimetype));
      if (!type || !type.magic(req.file.buffer)) {
        return next(uploadError('Расширение, MIME-тип и содержимое файла не совпадают'));
      }
      return next();
    });
  }
  function array(field, maxCount) {
    if (!Number.isInteger(maxCount) || maxCount < 1) throw new TypeError('Valid maxCount is required');
    const parse = parser.array(field, maxCount);
    return (req, res, next) => parse(req, res, (error) => {
      if (error) return next(uploadError('Файлы превышают допустимое количество или размер'));
      for (const file of req.files || []) {
        const extension = path.extname(file.originalname || '').toLowerCase();
        const type = allowed.find((candidate) => candidate.extensions.includes(extension)
          && candidate.mimes.includes(file.mimetype));
        if (!type || !type.magic(file.buffer)) {
          return next(uploadError('Расширение, MIME-тип и содержимое файла не совпадают'));
        }
      }
      return next();
    });
  }
  return { single, array };
}

module.exports = { createMemoryUpload };
