const express = require('express');
const { pipeline } = require('stream/promises');
const { authenticate, evaluateAuthorizationDecision } = require('../middleware/auth');
const { getAuthorizationMode, recordAuthorizationDecision } = require('../services/authorizationRuntime');
const { resolveHttpAuthorizationSurface } = require('../config/authorizationSurfaces');
const {
  acceptPdfUpload,
  limitProfileImportConcurrency,
  pdfUploadErrorHandler,
} = require('../middleware/pdfUpload');
const { limitProfileImportUploads } = require('../middleware/profileImportRateLimit');
const defaultService = require('../services/profileImportService');
const { serializeImport } = require('../services/profileImportService');

function createLawyerImportsRouter({
  service = defaultService,
  uploadQuota = limitProfileImportUploads,
  uploadGate = limitProfileImportConcurrency,
  pdfUpload = acceptPdfUpload,
} = {}) {
  const router = express.Router();
  router.use(authenticate);

  async function requireOwnerMode(req, res, next) {
    const hasCapability = req.capabilities.includes('lawyerApplicant') || req.capabilities.includes('lawyer');
    if (req.accountMode !== 'lawyer') {
      return res.status(403).json({ code: 'LAWYER_IMPORT_FORBIDDEN', error: 'Insufficient rights' });
    }
    try {
      const decision = await evaluateAuthorizationDecision({
        authorizationMode: getAuthorizationMode(), channel: 'http',
        surface: resolveHttpAuthorizationSurface(req.method, req.originalUrl, null),
        mode: 'lawyer', legacyAllowed: req.userRole === 'lawyer', capabilityAllowed: hasCapability,
        recordDecision: recordAuthorizationDecision,
      });
      if (!decision.allowed) {
        return res.status(403).json({ code: 'LAWYER_IMPORT_FORBIDDEN', error: 'Insufficient rights' });
      }
    } catch (_error) {
      return res.status(503).json({ code: 'AUTHORIZATION_TELEMETRY_UNAVAILABLE', error: 'Authorization unavailable' });
    }
    return next();
  }
  requireOwnerMode.authorizationGuard = { legacyRoles: ['lawyer'], modes: ['lawyer'], stage: null };

  async function requireOwnerOperationMode(req, res, next) {
    const hasOwnerCapability = req.capabilities.includes('lawyerApplicant')
      || req.capabilities.includes('lawyer');
    if (hasOwnerCapability && req.accountMode !== 'lawyer') {
      return res.status(403).json({ code: 'LAWYER_IMPORT_FORBIDDEN', error: 'Insufficient rights' });
    }
    const capabilityAllowed = (req.accountMode === 'lawyer' && hasOwnerCapability)
      || (req.accountMode === 'admin' && req.capabilities.includes('admin'));
    const unrelatedClient = req.accountMode === 'client' && !hasOwnerCapability;
    const legacyAllowed = (req.accountMode === 'lawyer' && req.userRole === 'lawyer')
      || (req.accountMode === 'admin' && req.userRole === 'admin');
    try {
      const decision = await evaluateAuthorizationDecision({
        authorizationMode: getAuthorizationMode(), channel: 'http',
        surface: resolveHttpAuthorizationSurface(req.method, req.originalUrl, null),
        mode: req.accountMode || (hasOwnerCapability ? 'lawyer' : 'admin'),
        legacyAllowed, capabilityAllowed, recordDecision: recordAuthorizationDecision,
      });
      if (!decision.allowed && !unrelatedClient) {
        return res.status(403).json({ code: 'LAWYER_IMPORT_FORBIDDEN', error: 'Insufficient rights' });
      }
    } catch (_error) {
      return res.status(503).json({ code: 'AUTHORIZATION_TELEMETRY_UNAVAILABLE', error: 'Authorization unavailable' });
    }
    return next();
  }
  requireOwnerOperationMode.authorizationGuard = {
    legacyRoles: ['lawyer', 'admin'], modes: ['client', 'lawyer', 'admin'], stage: null,
  };

  router.post('/', requireOwnerMode, uploadQuota, uploadGate, pdfUpload, async (req, res, next) => {
    try {
      const row = await service.uploadImport({
        userId: req.userId,
        idempotencyKey: req.get('Idempotency-Key'),
        file: req.file,
        quotaReservation: req.profileImportQuotaReservation,
      });
      return res.status(202).json({ import: serializeImport(row, { includeDraft: false }) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/current', requireOwnerMode, async (req, res, next) => {
    try {
      const row = await service.getCurrentImport({
        userId: req.userId,
        idempotencyKey: req.get('Idempotency-Key'),
      });
      return res.json({ import: serializeImport(row) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', requireOwnerOperationMode, async (req, res, next) => {
    try {
      const isAdmin = req.accountMode === 'admin' && req.capabilities.includes('admin');
      const row = await service.getImport({
        importId: req.params.id,
        userId: req.userId,
        isAdmin,
        actorUserId: req.userId,
      });
      return res.json({ import: serializeImport(row) });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/download', requireOwnerOperationMode, async (req, res, next) => {
    try {
      const isAdmin = req.accountMode === 'admin' && req.capabilities.includes('admin');
      await service.downloadImport({
        importId: req.params.id,
        userId: req.userId,
        isAdmin,
        actorUserId: req.userId,
        consume: async (stream) => {
          res.status(200);
          res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="profile-import.pdf"',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'",
            'Cache-Control': 'no-store, private',
          });
          await pipeline(stream, res);
        },
      });
    } catch (error) {
      if (!res.headersSent) return next(error);
      res.destroy(error);
    }
    return undefined;
  });

  router.patch('/:id/draft', requireOwnerOperationMode, async (req, res, next) => {
    try {
      const row = await service.updateDraft({
        importId: req.params.id,
        userId: req.userId,
        version: req.body?.version,
        draft: req.body?.draft,
      });
      return res.json({ import: serializeImport(row) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:id/confirm', requireOwnerOperationMode, async (req, res, next) => {
    try {
      const result = await service.confirmImport({
        importId: req.params.id,
        userId: req.userId,
        version: req.body?.version,
        acceptedPaths: req.body?.acceptedPaths,
        profileRevision: req.body?.profileRevision,
      });
      return res.json({
        import: serializeImport(result.importRow),
        profile: result.profile.toJSON(),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', requireOwnerOperationMode, async (req, res, next) => {
    try {
      await service.deleteImport({ importId: req.params.id, userId: req.userId });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  router.use(pdfUploadErrorHandler);
  return router;
}

module.exports = createLawyerImportsRouter();
module.exports.createLawyerImportsRouter = createLawyerImportsRouter;
