const router = require('express').Router();
const { decodeUploadFilename } = require('../utils/uploadFilename');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { Op } = require('sequelize');
const { sequelize, Consultation, CaseDocument, CaseDocumentAnalysis, User } = require('../models');
const { authenticate } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const documentAnalysisService = require('../services/documentAnalysisService');
const consultationPolicy = require('../services/consultationPolicy');
const { CASE_DOCUMENT_EXTENSIONS, fileFilterFor, validateUploadSignatures, cleanupUploadedFiles, createWithinUploadQuota } = require('../services/uploadSecurity');

// Рабочие документы по делу: файлы конкретной консультации, видны ОБОИМ участникам
// (клиент + юрист). Роль не важна — важно, что ты участник этой консультации.

const uploadDir = process.env.UPLOAD_DIR || './uploads';
try {
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
} catch (e) {
  console.error(`[case-documents] не удалось создать uploadDir "${uploadDir}": ${e.message}`);
}

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
  fileFilter: fileFilterFor(CASE_DOCUMENT_EXTENSIONS),
});

const analysisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 15 : 1000,
  keyGenerator: (req) => req.userId || req.ip,
  message: { error: 'Слишком много запросов на анализ, попробуйте позже', code: 'AI_RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
});

const analysisDto = (analysis, cached = false) => ({
  id: analysis.id,
  status: analysis.status,
  result: analysis.result || null,
  model: analysis.model,
  promptVersion: analysis.promptVersion,
  completedAt: analysis.completedAt || null,
  cached,
});
const analysisVersion = documentAnalysisService.ANALYSIS_VERSION || documentAnalysisService.PROMPT_VERSION;
const supportedForAnalysis = (name = '') => ['.pdf', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(name).toLowerCase());

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

function requireWritableConsultation(req, res, next) {
  if (!consultationPolicy.isWritable(req.consultation)) {
    return res.status(409).json({ error: 'Документы консультации доступны только для чтения', code: 'CONSULTATION_READ_ONLY' });
  }
  return next();
}

function requireAssignedLawyer(req, res, next) {
  if (req.consultation.lawyerId !== req.userId) {
    return res.status(403).json({ error: 'AI-анализ документа доступен только назначенному юристу' });
  }
  return next();
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
    const isAssignedLawyer = req.consultation.lawyerId === req.userId;
    let latestByDocument = new Map();
    if (isAssignedLawyer && docs.length) {
      const analyses = await CaseDocumentAnalysis.findAll({
        where: { caseDocumentId: { [Op.in]: docs.map((doc) => doc.id) }, promptVersion: analysisVersion, status: { [Op.in]: ['completed', 'processing', 'failed'] } },
        order: [['updatedAt', 'DESC']],
      });
      latestByDocument = new Map();
      for (const analysis of analyses) {
        if (!latestByDocument.has(analysis.caseDocumentId)) latestByDocument.set(analysis.caseDocumentId, analysis);
      }
    }
    const documents = docs.map((doc) => {
      const value = doc.toJSON();
      if (isAssignedLawyer) {
        value.canAnalyze = true;
        value.analysisSupported = supportedForAnalysis(value.name);
        value.analysis = latestByDocument.has(doc.id) ? analysisDto(latestByDocument.get(doc.id)) : null;
      }
      return value;
    });
    res.json({
      documents,
      canAnalyze: isAssignedLawyer,
      writable: consultationPolicy.isWritable(req.consultation),
      consultation: { status: req.consultation.status, archivedAt: req.consultation.archivedAt },
    });
  } catch (err) {
    next(err);
  }
});

// POST /:consultationId/documents/:docId/ai-analysis — анализ доступен только назначенному юристу.
router.post('/:consultationId/documents/:docId/ai-analysis', authenticate, requireParticipant, requireAssignedLawyer, analysisLimiter, async (req, res, next) => {
  let claimedAnalysis;
  let claimUpdatedAt;
  try {
    const document = await CaseDocument.findOne({
      where: { id: req.params.docId, consultationId: req.params.consultationId },
    });
    if (!document) return res.status(404).json({ error: 'Документ не найден' });
    if (!documentAnalysisService.hasRealApiKey()) {
      return res.status(503).json({ error: 'AI-анализ временно недоступен', code: 'AI_UNAVAILABLE' });
    }

    const claim = await sequelize.transaction(async (transaction) => {
       const scope = `case-document-analysis:${document.id}:${analysisVersion}`;
      await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:scope))', { replacements: { scope }, transaction });
      let analysis = await CaseDocumentAnalysis.findOne({
         where: { caseDocumentId: document.id, promptVersion: analysisVersion },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (analysis?.status === 'completed') return { cached: analysis };
      const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
      if (analysis?.status === 'processing' && analysis.updatedAt > staleBefore) return { active: true };
      if (!analysis) {
        analysis = await CaseDocumentAnalysis.create({
          caseDocumentId: document.id,
          consultationId: req.consultation.id,
          requestedById: req.userId,
          status: 'processing',
          model: documentAnalysisService.MODEL,
           promptVersion: analysisVersion,
        }, { transaction });
      } else {
        await analysis.update({
          requestedById: req.userId,
          status: 'processing',
          result: null,
          model: documentAnalysisService.MODEL,
          completedAt: null,
          lastError: null,
        }, { transaction });
      }
      return { claimed: analysis };
    });

    if (claim.cached) return res.json({ analysis: analysisDto(claim.cached, true) });
    if (claim.active) return res.status(409).json({ error: 'Анализ документа уже выполняется', code: 'AI_ANALYSIS_PROCESSING' });
    claimedAnalysis = claim.claimed;
    claimUpdatedAt = claimedAnalysis.updatedAt;

    const result = await documentAnalysisService.analyzeCaseDocument(document);
    const completedAt = new Date();
    const [updated] = await CaseDocumentAnalysis.update(
      { status: 'completed', result, completedAt, lastError: null },
      { where: { id: claimedAnalysis.id, status: 'processing', updatedAt: claimUpdatedAt } },
    );
    if (!updated) {
      const superseded = new Error('Запрос анализа был заменен более новым');
      superseded.status = 409;
      superseded.code = 'AI_ANALYSIS_SUPERSEDED';
      throw superseded;
    }
    await claimedAnalysis.reload();
    return res.json({ analysis: analysisDto(claimedAnalysis, false) });
  } catch (error) {
    if (claimedAnalysis) {
      await CaseDocumentAnalysis.update({
        status: 'failed',
        result: null,
        completedAt: null,
        lastError: String(error.message || 'AI analysis failed').slice(0, 1000),
      }, { where: { id: claimedAnalysis.id, status: 'processing', updatedAt: claimUpdatedAt } }).catch(() => {});
    }
    return next(error);
  }
});

// POST /:consultationId/documents — загрузить документ по делу
router.post('/:consultationId/documents', authenticate, requireParticipant, requireWritableConsultation, upload.single('file'), validateUploadSignatures(CASE_DOCUMENT_EXTENSIONS), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const doc = await createWithinUploadQuota({
      Model: CaseDocument, where: { consultationId: req.params.consultationId }, maxFiles: 50, maxBytes: 100 * 1024 * 1024,
      values: {
        consultationId: req.params.consultationId, uploaderId: req.userId,
        name: decodeUploadFilename(req.file.originalname), path: req.file.path, mimeType: req.file.mimetype, size: req.file.size,
      },
    });
    if (!doc) {
      cleanupUploadedFiles(req);
      return res.status(413).json({ error: 'Превышен лимит документов консультации' });
    }
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
    cleanupUploadedFiles(req);
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
router.delete('/:consultationId/documents/:docId', authenticate, requireParticipant, requireWritableConsultation, async (req, res, next) => {
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
