const crypto = require('crypto');
const path = require('path');
const multer = require('multer');

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const PDF_MIME = 'application/pdf';
const PDF_MAGIC = Buffer.from('%PDF-');
const DEFAULT_UPLOAD_CONCURRENCY = 8;

class PdfUploadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PdfUploadError';
    this.code = code;
    this.status = 400;
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fields: 0,
    // Busboy emits partsLimit at equality, so 2 enforces one accepted part.
    parts: 2,
    fileSize: MAX_PDF_BYTES,
    fieldNameSize: 32,
    fieldSize: 0,
    headerPairs: 20,
  },
  fileFilter: (_req, file, callback) => {
    if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
      callback(new PdfUploadError('INVALID_PDF_EXTENSION', 'Only PDF files are accepted'));
      return;
    }
    if (file.mimetype.toLowerCase() !== PDF_MIME) {
      callback(new PdfUploadError('INVALID_PDF_MIME', 'Only application/pdf is accepted'));
      return;
    }
    callback(null, true);
  },
});

function acceptPdfUpload(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (error) return next(error);
    if (!req.file) return next(new PdfUploadError('PDF_REQUIRED', 'PDF file is required'));
    if (req.file.buffer.length < PDF_MAGIC.length
      || !req.file.buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      return next(new PdfUploadError('INVALID_PDF_MAGIC', 'Invalid PDF file'));
    }

    const ownerId = String(req.userId || '');
    if (!/^[A-Za-z0-9_-]+$/.test(ownerId)) {
      return next(new PdfUploadError('INVALID_UPLOAD_OWNER', 'Authenticated upload owner is required'));
    }

    req.file.checksum = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    req.file.objectKey = `profile-imports/${ownerId}/${crypto.randomUUID()}`;
    return next();
  });
}

function createUploadConcurrencyGate({ limit = DEFAULT_UPLOAD_CONCURRENCY } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 32) {
    throw new RangeError('upload concurrency limit must be between 1 and 32');
  }
  let active = 0;
  return (req, res, next) => {
    if (active >= limit) {
      return res.status(503).json({ code: 'PROFILE_IMPORT_CONCURRENCY_LIMITED' });
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    res.once('finish', release);
    res.once('close', release);
    return next();
  };
}

const limitProfileImportConcurrency = createUploadConcurrencyGate();

function pdfUploadErrorHandler(error, _req, res, next) {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      code: error.code,
      error: error.code === 'LIMIT_FILE_SIZE' ? 'PDF exceeds 10 MiB limit' : 'Invalid PDF upload',
    });
  }
  if (error instanceof PdfUploadError) {
    return res.status(400).json({ code: error.code, error: error.message });
  }
  return next(error);
}

module.exports = {
  acceptPdfUpload,
  createUploadConcurrencyGate,
  limitProfileImportConcurrency,
  pdfUploadErrorHandler,
  MAX_PDF_BYTES,
  PdfUploadError,
  DEFAULT_UPLOAD_CONCURRENCY,
};
