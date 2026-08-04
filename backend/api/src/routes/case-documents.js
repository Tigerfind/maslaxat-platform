const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Consultation, CaseDocument, User } = require('../models');
const { authenticate } = require('../middleware/auth');
const notificationService = require('../services/notificationService');

// Рабочие документы по делу: файлы конкретной консультации, видны ОБОИМ участникам
// (клиент + юрист). Роль не важна — важно, что ты участник этой консультации.

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = `case-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExt = ['.pdf', '.doc', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.webp'];
    const allowedMime = [
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'image/jpeg', 'image/png', 'image/webp',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExt.includes(ext) && allowedMime.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Неподдерживаемый формат файла'));
  },
});

// Мидлвар: грузим консультацию и проверяем, что текущий пользователь — её участник.
// Кладём консультацию и «другую сторону» в req для переиспользования.
async function requireParticipant(req, res, next) {
  try {
    const consultation = await Consultation.findByPk(req.params.consultationId);
    if (!consultation) return res.status(404).json({ error: 'Консультация не найдена' });
    const isClient = consultation.clientId === req.userId;
    const isLawyer = consultation.lawyerId === req.userId;
    if (!isClient && !isLawyer) {
      return res.status(403).json({ error: 'Нет доступа к этой консультации' });
    }
    req.consultation = consultation;
    req.otherPartyId = isClient ? consultation.lawyerId : consultation.clientId;
    next();
  } catch (err) {
    next(err);
  }
}

// GET /:consultationId/documents — список документов по делу
router.get('/:consultationId/documents', authenticate, requireParticipant, async (req, res, next) => {
  try {
    const docs = await CaseDocument.findAll({
      where: { consultationId: req.params.consultationId },
      attributes: ['id', 'name', 'mimeType', 'size', 'uploaderId', 'createdAt'],
      include: [{ model: User, as: 'uploader', attributes: ['id', 'name', 'role'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json({ documents: docs });
  } catch (err) {
    next(err);
  }
});

// POST /:consultationId/documents — загрузить документ по делу
router.post('/:consultationId/documents', authenticate, requireParticipant, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const doc = await CaseDocument.create({
      consultationId: req.params.consultationId,
      uploaderId: req.userId,
      name: req.file.originalname,
      path: req.file.path,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
    // Уведомляем другую сторону о новом документе (fail-safe)
    try {
      const me = await User.findByPk(req.userId, { attributes: ['name'] });
      await notificationService.createNotification(
        req.otherPartyId,
        'case_document',
        'Новый документ по делу',
        `${me?.name || 'Участник'} добавил документ: ${doc.name}`,
        { consultationId: req.params.consultationId },
      );
    } catch (e) { /* notification is best-effort */ }

    res.status(201).json({
      document: { id: doc.id, name: doc.name, mimeType: doc.mimeType, size: doc.size, uploaderId: doc.uploaderId, createdAt: doc.createdAt },
    });
  } catch (err) {
    next(err);
  }
});

// GET /:consultationId/documents/:docId/download — скачать (любой участник)
router.get('/:consultationId/documents/:docId/download', authenticate, requireParticipant, async (req, res, next) => {
  try {
    const doc = await CaseDocument.findOne({
      where: { id: req.params.docId, consultationId: req.params.consultationId },
    });
    if (!doc || !doc.path || !fs.existsSync(doc.path)) {
      return res.status(404).json({ error: 'Документ не найден' });
    }
    res.download(doc.path, doc.name);
  } catch (err) {
    next(err);
  }
});

// DELETE /:consultationId/documents/:docId — удалить (только автор загрузки)
router.delete('/:consultationId/documents/:docId', authenticate, requireParticipant, async (req, res, next) => {
  try {
    const doc = await CaseDocument.findOne({
      where: { id: req.params.docId, consultationId: req.params.consultationId },
    });
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    // Удалять может только тот, кто загрузил (у другой стороны — только просмотр/скачивание).
    if (doc.uploaderId !== req.userId) {
      return res.status(403).json({ error: 'Удалить документ может только тот, кто его загрузил' });
    }
    if (doc.path) { try { fs.unlinkSync(doc.path); } catch (e) { /* файла нет */ } }
    await doc.destroy();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
