const router = require('express').Router();
const logger = require('../config/logger');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { Document } = require('../models');
const { authenticate } = require('../middleware/auth');
const notificationService = require('../services/notificationService');

// Лимит на AI-анализ документов (защита от неограниченных платных вызовов Claude).
// Ключ — пользователь (не IP), поэтому ставится ПОСЛЕ authenticate.
const aiCheckLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: 15,
  keyGenerator: (req) => req.userId || req.ip,
  message: { error: 'Слишком много запросов на анализ, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Claude AI for document analysis
let anthropic = null;
try {
  if (process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
} catch (e) {
  logger.warn('Anthropic SDK not available for document analysis');
}

// Ensure uploads directory exists (не крашим старт, если ФС read-only —
// в проде путь задаётся UPLOAD_DIR и указывает на записываемый volume).
const uploadDir = process.env.UPLOAD_DIR || './uploads';
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (e) {
  console.error(`[documents] не удалось создать uploadDir "${uploadDir}": ${e.message}`);
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExt = ['.pdf', '.doc', '.docx', '.txt', '.jpg', '.jpeg', '.png'];
    const allowedMime = [
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'image/jpeg', 'image/png',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    // Проверяем И расширение, И заявленный MIME — чтобы нельзя было протащить
    // произвольный файл, переименовав его в .pdf.
    if (allowedExt.includes(ext) && allowedMime.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Неподдерживаемый формат файла'));
    }
  },
});

// GET /api/documents — list user documents
router.get('/', authenticate, async (req, res, next) => {
  try {
    const documents = await Document.findAll({
      where: { userId: req.userId },
      order: [['createdAt', 'DESC']],
    });
    res.json(documents);
  } catch (err) {
    next(err);
  }
});

// POST /api/documents/upload — upload a document
router.post('/upload', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};

    // Категория (папка) — необязательна; ограничиваем длину, пустую → null
    let category = null;
    if (typeof metadata.category === 'string' && metadata.category.trim()) {
      category = metadata.category.trim().slice(0, 50);
    }

    const document = await Document.create({
      userId: req.userId,
      name: req.file.originalname,
      type: path.extname(req.file.originalname).replace('.', '').toUpperCase(),
      size: req.file.size,
      path: req.file.path,
      status: 'pending',
      category,
    });

    res.status(201).json(document);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/documents/:id — delete a document
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const document = await Document.findOne({
      where: { id: req.params.id, userId: req.userId },
    });

    if (!document) {
      return res.status(404).json({ error: 'Документ не найден' });
    }

    // Delete file from disk
    if (document.path && fs.existsSync(document.path)) {
      fs.unlinkSync(document.path);
    }

    await document.destroy();
    res.json({ message: 'Документ удалён' });
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/:id/download — download the original file
router.get('/:id/download', authenticate, async (req, res, next) => {
  try {
    const document = await Document.findOne({
      where: { id: req.params.id, userId: req.userId },
    });

    if (!document) {
      return res.status(404).json({ error: 'Документ не найден' });
    }

    if (!document.path || !fs.existsSync(document.path)) {
      return res.status(404).json({ error: 'Файл не найден на сервере' });
    }

    res.download(document.path, document.name || path.basename(document.path));
  } catch (err) {
    next(err);
  }
});

// POST /api/documents/:id/ai-check — AI analysis of document via Claude
router.post('/:id/ai-check', authenticate, aiCheckLimiter, async (req, res, next) => {
  try {
    const document = await Document.findOne({
      where: { id: req.params.id, userId: req.userId },
    });

    if (!document) {
      return res.status(404).json({ error: 'Документ не найден' });
    }

    // Read file from disk
    const filePath = document.path;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(400).json({ error: 'Файл не найден на диске' });
    }

    const ext = path.extname(filePath).toLowerCase();
    let documentContent = null;
    let contentBlocks = [];

    // Extract text depending on file type
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const pdfBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(pdfBuffer);
      documentContent = pdfData.text.substring(0, 15000);
      contentBlocks = [{ type: 'text', text: `Содержимое PDF документа "${document.name}":\n\n${documentContent}` }];
    } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
      const imageBuffer = fs.readFileSync(filePath);
      const base64 = imageBuffer.toString('base64');
      const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';
      contentBlocks = [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: `Проанализируй этот документ-изображение "${document.name}".` },
      ];
    } else if (ext === '.docx' || ext === '.doc') {
      // .docx (и по возможности .doc) — извлекаем текст через mammoth,
      // а не читаем бинарь как utf-8 (раньше в AI шёл мусор).
      try {
        const mammoth = require('mammoth');
        const { value } = await mammoth.extractRawText({ path: filePath });
        documentContent = (value || '').substring(0, 15000);
      } catch (e) {
        documentContent = '';
      }
      if (!documentContent || !documentContent.trim()) {
        return res.status(400).json({
          error: ext === '.doc'
            ? 'Старый формат .doc не удалось прочитать. Пожалуйста, загрузите файл в формате .docx или PDF.'
            : 'Не удалось извлечь текст из документа. Попробуйте формат .docx или PDF.',
        });
      }
      contentBlocks = [{ type: 'text', text: `Содержимое документа "${document.name}":\n\n${documentContent}` }];
    } else if (ext === '.txt') {
      documentContent = fs.readFileSync(filePath, 'utf-8').substring(0, 15000);
      contentBlocks = [{ type: 'text', text: `Содержимое документа "${document.name}":\n\n${documentContent}` }];
    } else {
      return res.status(400).json({ error: 'Неподдерживаемый формат для AI анализа' });
    }

    const systemPrompt = `Ты юридический эксперт по законодательству Узбекистана.
Проанализируй документ и верни ТОЛЬКО валидный JSON (без markdown, без \`\`\`):
{
  "documentType": "тип документа (договор, доверенность, заявление и т.д.)",
  "summary": "краткое содержание документа в 2-3 предложениях",
  "risks": ["описание риска 1", "описание риска 2"],
  "recommendations": ["рекомендация 1", "рекомендация 2"],
  "relevantLaws": ["ГК РУз ст.XXX", "ТК РУз ст.YYY"],
  "score": число от 0 до 100 (качество и юридическая корректность документа),
  "language": "ru" или "uz",
  "issues": ["проблема 1", "проблема 2"],
  "risk": "Низкий" или "Средний" или "Высокий"
}
Если документ пустой или нечитаемый, установи score: 0 и укажи это в summary.
Отвечай на том же языке, что и документ.`;

    let result;

    if (anthropic) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentBlocks }],
      });

      const responseText = response.content[0]?.text || '';

      // Parse JSON from response (handle potential markdown wrapping)
      let jsonStr = responseText;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];

      try {
        result = JSON.parse(jsonStr);
      } catch {
        result = {
          documentType: 'Неизвестный',
          summary: responseText.substring(0, 500),
          risks: [],
          recommendations: [],
          relevantLaws: [],
          score: 50,
          language: 'ru',
          issues: ['Не удалось структурировать ответ AI'],
          risk: 'Средний',
        };
      }
    } else {
      // Fallback when no API key
      result = {
        documentType: 'Документ',
        summary: `Документ "${document.name}" загружен. AI анализ временно недоступен — API ключ не настроен.`,
        risks: [],
        recommendations: ['Настройте ANTHROPIC_API_KEY для полного AI анализа'],
        relevantLaws: [],
        score: 50,
        language: 'ru',
        issues: ['AI анализ недоступен'],
        risk: 'Неизвестно',
      };
    }

    // Ensure score is a number
    result.score = parseInt(result.score) || 50;

    document.aiAnalysis = result;
    document.status = result.score >= 80 ? 'verified' : result.score >= 50 ? 'issues' : 'rejected';
    await document.save();

    // Notify user about analysis completion
    notificationService.notifyDocumentAnalyzed(req.userId, document.name, result.score);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
