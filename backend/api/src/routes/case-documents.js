const express = require('express');
const crypto = require('crypto');
const { Consultation, CaseDocument, User } = require('../models');
const {
  authenticate,
  authorizeConsultationMode,
  ownsConsultationPerspective,
} = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { createMemoryUpload } = require('../middleware/fileUpload');
const { getFileStorageService } = require('../services/fileStorageRuntime');
const { streamFile } = require('../services/fileHttpService');
const { FILE_LIMITS, uploadLimitFor } = require('../config/fileLimits');
const { registerUuidParams } = require('../middleware/uuidParams');

// Рабочие документы по делу: файлы конкретной консультации, видны ОБОИМ участникам
// (клиент + юрист). Роль не важна — важно, что ты участник этой консультации.

const upload = createMemoryUpload({
  types: ['pdf', 'doc', 'docx', 'txt', 'jpeg', 'png', 'webp'],
  maxBytes: uploadLimitFor('case'),
});

function createCaseDocumentsRouter({ fileStorageService = getFileStorageService() } = {}) {
const router = express.Router();
registerUuidParams(router, 'consultationId', 'docId');

// Мидлвар: грузим консультацию и проверяем, что текущий пользователь — её участник.
// Кладём консультацию и «другую сторону» в req для переиспользования.
async function requireParticipant(req, res, next) {
  try {
    const consultation = await Consultation.findByPk(req.params.consultationId);
    if (!consultation) return res.status(404).json({ error: 'Консультация не найдена' });
    if (!ownsConsultationPerspective(req, consultation)) {
      return res.status(403).json({ error: 'Нет доступа к этой консультации' });
    }
    req.consultation = consultation;
    req.otherPartyId = req.accountMode === 'client' ? consultation.lawyerId : consultation.clientId;
    next();
  } catch (err) {
    next(err);
  }
}

// GET /:consultationId/documents — список документов по делу
router.get('/:consultationId/documents', authenticate, authorizeConsultationMode, requireParticipant, async (req, res, next) => {
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
router.post('/:consultationId/documents', authenticate, authorizeConsultationMode, requireParticipant, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const id = crypto.randomUUID();
    const doc = await fileStorageService.store({
      kind: 'case', scopeId: req.params.consultationId, fileId: id,
      body: req.file.buffer, mimeType: req.file.mimetype,
      persist: ({ transaction, metadata }) => CaseDocument.create({
        id,
        consultationId: req.params.consultationId,
        uploaderId: req.userId,
        name: req.file.originalname,
        ...metadata,
      }, { transaction }),
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
router.get('/:consultationId/documents/:docId/download', authenticate, authorizeConsultationMode, requireParticipant, async (req, res, next) => {
  try {
    const doc = await CaseDocument.findOne({
      where: { id: req.params.docId, consultationId: req.params.consultationId },
    });
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    await streamFile({
      storage: fileStorageService, req, res, record: doc, filename: doc.name,
      maxBytes: FILE_LIMITS.case,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /:consultationId/documents/:docId — удалить (только автор загрузки)
router.delete('/:consultationId/documents/:docId', authenticate, authorizeConsultationMode, requireParticipant, async (req, res, next) => {
  try {
    const doc = await CaseDocument.findOne({
      where: { id: req.params.docId, consultationId: req.params.consultationId },
    });
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    // Удалять может только тот, кто загрузил (у другой стороны — только просмотр/скачивание).
    if (doc.uploaderId !== req.userId) {
      return res.status(403).json({ error: 'Удалить документ может только тот, кто его загрузил' });
    }
    if (doc.storageKey) {
      await fileStorageService.delete({
        record: doc,
        destroy: ({ transaction }) => doc.destroy({ transaction }),
      });
    } else {
      await doc.destroy();
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

return router;
}

module.exports = createCaseDocumentsRouter;
