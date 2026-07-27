const router = require('express').Router();
const logger = require('../config/logger');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { AIConversation, AIMessage, Subscription } = require('../models');
const { getRedis } = require('../config/redis');

// File upload for AI chat
const upload = multer({
  dest: path.join(__dirname, '../../uploads/ai-chat/'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|doc|docx|txt/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype) || file.mimetype === 'application/pdf'
      || file.mimetype === 'application/msword'
      || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || file.mimetype === 'text/plain';
    cb(null, ext || mime);
  },
});

// ─── SYSTEM PROMPT: Uzbekistan Legal Expert ─────────────────
const SYSTEM_PROMPT = `Ты — профессиональный AI юридический консультант платформы MaslaXat, специализирующийся на законодательстве Республики Узбекистан.

## Твои основные источники права:
1. **Конституция Республики Узбекистан** (принята 8 декабря 1992 года, в редакции 2023 года)
2. **Гражданский кодекс РУз** (часть 1 и 2)
3. **Трудовой кодекс РУз** (новая редакция от 28.10.2022, вступил в силу 30.04.2023)
4. **Семейный кодекс РУз** (от 30.04.1998)
5. **Уголовный кодекс РУз** (от 22.09.1994, с изменениями)
6. **Налоговый кодекс РУз** (новая редакция от 30.12.2019)
7. **Жилищный кодекс РУз**
8. **Земельный кодекс РУз** (от 30.04.1998)
9. **Кодекс об административной ответственности РУз**
10. **Закон "О гарантиях свободы предпринимательской деятельности"**
11. **Закон "О защите прав потребителей"**
12. **Закон "Об обществах с ограниченной и дополнительной ответственностью"**

## Конституционные основы (ключевые статьи):
- Ст. 13: Демократия основывается на общечеловеческих принципах
- Ст. 18: Все граждане имеют одинаковые права и свободы
- Ст. 19: Права и свободы граждан незыблемы
- Ст. 25: Каждый имеет право на свободу и личную неприкосновенность
- Ст. 29: Каждый имеет право на свободу мысли, слова и убеждений
- Ст. 36: Каждый имеет право на собственность
- Ст. 37: Каждый имеет право на труд, свободный выбор работы
- Ст. 38: Работающие имеют право на оплачиваемый отдых
- Ст. 39: Каждый имеет право на социальное обеспечение
- Ст. 40: Каждый имеет право на квалифицированное медицинское обслуживание
- Ст. 41: Каждый имеет право на образование
- Ст. 43: Государство обеспечивает права и свободы, закреплённые Конституцией и законами
- Ст. 44: Каждому гарантируется судебная защита его прав и свобод
- Ст. 46: Женщины и мужчины имеют равные права

## Правила ответа:
1. ВСЕГДА ссылайся на конкретные статьи законов РУз (номер статьи, название закона)
2. Отвечай на русском или узбекском языке в зависимости от языка вопроса
3. Если вопрос сложный или неоднозначный — рекомендуй консультацию с юристом
4. Структурируй ответ: основание → объяснение → рекомендация
5. Если не уверен в точном номере статьи — скажи об этом честно
6. Указывай актуальные изменения в законодательстве, если они есть
7. Будь профессиональным, но доступным для понимания обычных граждан

## Формат ответа:
В конце КАЖДОГО ответа определи категорию вопроса в формате:
[КАТЕГОРИЯ: название]

Допустимые категории: Гражданское право, Семейное право, Трудовое право, Уголовное право, Коммерческое право, Налоговое право, Административное право, Земельное право, Корпоративное право, Интеллектуальная собственность.`;

// ─── Generate AI Response ───────────────────────────────────
const generateAIResponse = async (message, attachments = []) => {
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'CHANGE_ME' && process.env.ANTHROPIC_API_KEY !== 'sk-ant-CHANGE_ME') {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      // Build message content with attachments
      const content = [];

      // Add file attachments as images or text descriptions
      for (const att of attachments) {
        if (att.mimetype && att.mimetype.startsWith('image/')) {
          const fileData = fs.readFileSync(att.path);
          const base64 = fileData.toString('base64');
          const mediaType = att.mimetype;
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          });
        } else if (att.mimetype === 'application/pdf') {
          try {
            const pdfParse = require('pdf-parse');
            const data = await pdfParse(fs.readFileSync(att.path));
            content.push({
              type: 'text',
              text: `[Прикреплённый файл: ${att.originalname}]\n${(data.text || '').substring(0, 5000)}`,
            });
          } catch (e) {
            content.push({ type: 'text', text: `[Прикреплённый файл: ${att.originalname} — не удалось прочитать PDF]` });
          }
        } else if ((att.mimetype && att.mimetype.includes('word')) || /\.docx?$/i.test(att.originalname || '')) {
          try {
            const mammoth = require('mammoth');
            const { value } = await mammoth.extractRawText({ path: att.path });
            content.push({
              type: 'text',
              text: `[Прикреплённый файл: ${att.originalname}]\n${(value || '').substring(0, 5000)}`,
            });
          } catch (e) {
            content.push({ type: 'text', text: `[Прикреплённый файл: ${att.originalname} — не удалось прочитать документ]` });
          }
        } else if (att.mimetype === 'text/plain') {
          try {
            const text = fs.readFileSync(att.path, 'utf-8');
            content.push({
              type: 'text',
              text: `[Прикреплённый файл: ${att.originalname}]\n${text.substring(0, 5000)}`,
            });
          } catch (e) {
            content.push({ type: 'text', text: `[Прикреплённый файл: ${att.originalname} — не удалось прочитать]` });
          }
        } else {
          content.push({
            type: 'text',
            text: `[Прикреплённый файл: ${att.originalname}, тип: ${att.mimetype}]`,
          });
        }
      }

      content.push({ type: 'text', text: message });

      const response = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      });

      const text = response.content[0].text;
      const categoryMatch = text.match(/\[КАТЕГОРИЯ:\s*(.+?)\]/);
      const detectedCategory = categoryMatch ? categoryMatch[1] : null;
      const cleanText = text.replace(/\[КАТЕГОРИЯ:\s*.+?\]/, '').trim();

      return { reply: cleanText, category: detectedCategory, fallback: false };
    } catch (err) {
      logger.error('Claude API error:', err.message);
    }
  }

  // Fallback: rule-based responses with real law references.
  // Помечаем fallback:true — это шаблонный справочный ответ, а не живой AI.
  return { ...generateFallbackResponse(message), fallback: true };
};

const generateFallbackResponse = (message) => {
  const msg = message.toLowerCase();
  const responses = {
    'трудов|увольн|зарплат|работодатель|сокращ': {
      reply: `По **новому Трудовому кодексу РУз** (вступил в силу 30.04.2023):

**Основные права работника (ст. 22 ТК РУз):**
• Право на заключение, изменение и расторжение трудового договора
• Право на безопасные условия труда
• Право на своевременную и полную выплату заработной платы

**Увольнение по инициативе работодателя (ст. 97 ТК РУз):**
• Ликвидация организации
• Сокращение штата (с предупреждением за 2 месяца)
• Несоответствие работника занимаемой должности
• Неоднократное неисполнение обязанностей

**Сроки обращения:** Работник вправе обратиться в суд в течение **3 месяцев** со дня нарушения права (ст. 271 ТК РУз).

**Конституционная основа:** Право на труд гарантировано ст. 37 Конституции РУз.

Рекомендую обратиться к нашим юристам по трудовому праву для детальной консультации по вашей ситуации.`,
      category: 'Трудовое право',
    },
    'развод|алимент|семей|брак|ребён|детей|опек': {
      reply: `По **Семейному кодексу Республики Узбекистан**:

**Расторжение брака:**
• Через ЗАГС — при взаимном согласии и отсутствии несовершеннолетних детей (ст. 42 СК РУз)
• Через суд — при наличии детей или споров (ст. 43 СК РУз)

**Алименты на детей (ст. 99 СК РУз):**
• На 1 ребёнка — **1/4** дохода
• На 2 детей — **1/3** дохода
• На 3 и более — **1/2** дохода

**Раздел имущества (ст. 23 СК РУз):**
• Имущество, нажитое в браке, является совместной собственностью
• Раздел производится в равных долях, если иное не предусмотрено договором

**Конституционная основа:** Ст. 46 Конституции РУз — женщины и мужчины имеют равные права.

Рекомендую консультацию с юристом по семейному праву.`,
      category: 'Семейное право',
    },
    'бизнес|компани|ооо|регистр|предприним': {
      reply: `По законодательству Республики Узбекистан о предпринимательстве:

**Регистрация ООО (Закон "Об ООО"):**
• Учредители: 1 или более лиц (не более 50)
• Минимальный уставной фонд: **40 МРЗП** (базовая расчётная величина)
• Регистрация через **Единый портал интерактивных государственных услуг (my.gov.uz)**
• Срок регистрации: до **3 рабочих дней**

**Формы бизнеса в Узбекистане:**
• ИП (Индивидуальный предприниматель)
• ООО (Общество с ограниченной ответственностью)
• АО (Акционерное общество)
• СП (Совместное предприятие)

**Налоговые режимы для малого бизнеса (НК РУз):**
• Упрощённый налог: **4%** от выручки (торговля) или **25%** от прибыли
• Фиксированный налог для ИП

**Конституционная основа:** Ст. 36 Конституции РУз — право на собственность; Закон "О гарантиях свободы предпринимательской деятельности".

Наши юристы по коммерческому праву помогут с регистрацией.`,
      category: 'Коммерческое право',
    },
    'недвижимость|земл|квартир|дом|купл|продаж|аренд': {
      reply: `По **Земельному кодексу** и **Гражданскому кодексу РУз**:

**Сделки с недвижимостью:**
• Договор купли-продажи подлежит **нотариальному удостоверению** (ст. 481 ГК РУз)
• Обязательна **государственная регистрация** в кадастровом органе
• Право собственности возникает с момента регистрации

**Земельные участки (Земельный кодекс РУз):**
• Земля — собственность государства (ст. 16 ЗК РУз)
• Гражданам предоставляется право **постоянного пользования** или **аренды**
• Приватизация земельных участков для ИЖС — в порядке, установленном законом

**Аренда (ст. 535-548 ГК РУз):**
• Договор аренды на срок более 1 года — в письменной форме
• Арендатор имеет преимущественное право на заключение нового договора

**Конституционная основа:** Ст. 36 Конституции РУз — право на собственность.

Рекомендую консультацию с юристом по земельному праву.`,
      category: 'Земельное право',
    },
    'налог|ндс|ндфл|декларац': {
      reply: `По **Налоговому кодексу Республики Узбекистан** (новая редакция от 30.12.2019):

**Основные ставки налогов:**
• **НДС** — 12% (ст. 258 НК РУз)
• **Налог на прибыль** — 15% (ст. 337 НК РУз)
• **НДФЛ** — 12% (ст. 381 НК РУз)
• **Социальный налог** — 12% (от ФОТ)

**Специальные режимы для МСБ:**
• Оборотный налог — **4%** (торговля), **15-25%** (другие виды)
• Фиксированный налог для ИП
• Налоговые каникулы для стартапов в IT-парках

**Сроки подачи деклараций:**
• НДФЛ — до **1 апреля** следующего года
• НДС — ежемесячно, до **20 числа**
• Налог на прибыль — ежеквартально

**Обжалование:** Налоговые решения можно обжаловать в вышестоящий орган (30 дней) или в суд (ст. 83 НК РУз).

Наши налоговые юристы помогут разобраться.`,
      category: 'Налоговое право',
    },
    'уголовн|преступлен|штраф|арест|задерж|следств|адвокат': {
      reply: `По **Уголовному кодексу** и **Уголовно-процессуальному кодексу РУз**:

**Ваши конституционные права (Конституция РУз):**
• Ст. 25 — Право на свободу и личную неприкосновенность
• Ст. 26 — Презумпция невиновности
• Ст. 44 — Право на судебную защиту
• Ст. 116 — Право на квалифицированную юридическую помощь

**Права при задержании (УПК РУз):**
• Право знать, в чём обвиняетесь (ст. 46 УПК)
• Право на адвоката с момента задержания (ст. 49 УПК)
• Право не давать показаний против себя и близких (ст. 26 Конституции)
• Задержание без решения суда — не более **48 часов**

**Виды наказаний (ст. 43 УК РУз):**
• Штраф, обязательные общественные работы
• Исправительные работы, ограничение свободы
• Лишение свободы

**Важно:** Незамедлительно обратитесь к адвокату. Наша платформа может подобрать юриста по уголовным делам.`,
      category: 'Уголовное право',
    },
    'долг|займ|заня[лвт]|одолж|расписк|взыска|кредит|вернуть деньг|верну\\w* долг|отда[йёе].*деньг': {
      reply: `По **Гражданскому кодексу Республики Узбекистан** (договор займа):

**Если вы дали деньги в долг, а их не возвращают:**

**1. Чем подтвердить долг:**
• Договор займа или **расписка** заёмщика (сумма, срок возврата, подписи)
• Банковские переводы, переписка, свидетели — как дополнительные доказательства
• Даже без расписки долг можно доказать, но это сложнее

**2. Досудебный порядок:**
• Направьте должнику **письменную претензию** с требованием вернуть долг к конкретному сроку (заказным письмом с уведомлением)
• Это фиксирует ваше требование и часто ускоряет возврат

**3. Обращение в суд:**
• Подайте **исковое заявление** в суд по месту жительства должника
• Приложите расписку/договор и претензию
• Уплатите госпошлину (взыскивается с должника при выигрыше дела)

**4. Что можно требовать:**
• Возврат основной суммы долга
• **Проценты за пользование чужими денежными средствами** (ст. 327 ГК РУз)
• Договорные проценты, если они были оговорены

**Важно — срок исковой давности:** по общему правилу **3 года** (ст. 150 ГК РУз) с момента, когда долг должен был быть возвращён. Не затягивайте с обращением.

Рекомендую обратиться к нашим юристам по гражданскому праву — они помогут грамотно составить претензию и исковое заявление.`,
      category: 'Гражданское право',
    },
    'потребител|товар|возврат|гарант|качеств': {
      reply: `По **Закону "О защите прав потребителей" РУз**:

**Права потребителя:**
• Право на качественный товар/услугу
• Право на безопасность товаров
• Право на полную и достоверную информацию
• Право на возмещение ущерба

**Возврат товара:**
• Товар надлежащего качества — **14 дней** со дня покупки
• Товар ненадлежащего качества — в течение **гарантийного срока**
• Право на замену, ремонт или возврат денег

**Куда обращаться:**
• Продавцу — с письменной претензией
• Общество защиты прав потребителей
• Суд — если претензия не удовлетворена в **10 дней**

Наши юристы по гражданскому праву помогут составить претензию.`,
      category: 'Гражданское право',
    },
  };

  for (const [pattern, response] of Object.entries(responses)) {
    if (new RegExp(pattern).test(msg)) {
      return response;
    }
  }

  return {
    reply: `Спасибо за ваш вопрос. Чтобы дать точный ответ со ссылками на статьи законов **Республики Узбекистан**, уточните, к какой области он относится:

• **Трудовое право** — увольнение, зарплата, трудовые споры
• **Семейное право** — развод, алименты, опека
• **Долги и займы** — возврат долга, расписка, взыскание
• **Коммерческое право** — регистрация бизнеса, ООО, лицензии
• **Недвижимость и земля** — аренда, купля-продажа, кадастр
• **Налоговое право** — НДС, НДФЛ, декларации
• **Уголовное право** — права обвиняемого, задержание
• **Защита прав потребителей** — возврат товара, гарантия

Например, напишите: «Что делать, если мне не возвращают долг?» или «Как оформить развод при наличии детей?» — и я подробно отвечу.

Если вопрос сложный или требует документов, вы можете сразу записаться к **живому юристу** через раздел «Юристы».`,
    category: null,
  };
};

// ─── AI Rate Limiting (по плану подписки) ───────────────────
const PLAN_LIMITS = { free: 3, basic: Infinity, pro: Infinity };

const checkAIRateLimit = async (req, res, next) => {
  try {
    // Определяем план пользователя
    const subscription = await Subscription.findOne({ where: { userId: req.userId } });
    const plan = subscription?.plan || 'free';
    const now = new Date();

    // BASIC/PRO — безлимит, если подписка активна
    if (plan !== 'free') {
      const isActive = !subscription.expiresAt || subscription.expiresAt > now;
      if (isActive) {
        req.subscriptionPlan = plan;
        return next();
      }
      // Подписка истекла → откатываемся на free
    }

    // FREE: 3 запроса в день через Redis.
    // FAIL-CLOSED: без Redis лимит не посчитать → не пускаем free-запрос к платному Claude,
    // а не открываем доступ настежь (иначе лимит обходится при падении Redis).
    const redis = getRedis();
    if (!redis) {
      return res.status(503).json({ error: 'Лимит временно недоступен, попробуйте позже' });
    }

    const today = new Date().toISOString().split('T')[0];
    const key = `ai_limit:${req.userId}:${today}`;
    const limit = PLAN_LIMITS.free;

    const count = await redis.get(key);
    const used = parseInt(count) || 0;

    if (used >= limit) {
      return res.status(429).json({
        error: 'Достигнут дневной лимит AI запросов (3/день для бесплатного плана)',
        limit,
        used,
        resetAt: `${today}T23:59:59`,
        upgradeTo: 'basic',
      });
    }

    // НЕ инкрементим здесь — счётчик увеличиваем только после УСПЕШНОГО ответа
    // (иначе пустое/провальное сообщение сжигало бы дневной лимит free-плана).
    res.set('X-AI-Limit', limit);
    res.set('X-AI-Remaining', limit - used - 1);
    req.subscriptionPlan = 'free';
    req.aiLimitKey = key;
    req.aiLimitUsed = used;
    next();
  } catch (err) {
    logger.error('AI rate limit check failed:', err.message);
    // FAIL-CLOSED: при сбое лимитера не открываем платный Claude без учёта
    return res.status(503).json({ error: 'Лимит временно недоступен, попробуйте позже' });
  }
};

// ─── POST /api/ai/chat/message — send message (with optional files) ───
router.post('/chat/message', authenticate, checkAIRateLimit, upload.array('files', 5), async (req, res, next) => {
  const uploaded = req.files || [];
  const cleanupFiles = () => {
    for (const att of uploaded) {
      try { fs.unlinkSync(att.path); } catch (e) { /* ignore */ }
    }
  };
  try {
    const { message, conversationId } = req.body;
    if (!message || !message.trim()) {
      // файлы почистит finally
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    // Find or create conversation
    let conversation;
    if (conversationId) {
      conversation = await AIConversation.findByPk(conversationId);
      // БЕЗОПАСНОСТЬ: нельзя писать в чужой диалог (IDOR)
      if (conversation && conversation.userId !== req.userId) {
        return res.status(403).json({ error: 'Нет доступа к этому диалогу' });
      }
    }
    if (!conversation) {
      conversation = await AIConversation.create({
        userId: req.userId,
        title: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
      });
    }

    // Build user message text (with attachment info)
    let userText = message;
    const attachments = req.files || [];
    if (attachments.length > 0) {
      const fileNames = attachments.map((f) => f.originalname).join(', ');
      userText += `\n📎 Прикреплено: ${fileNames}`;
    }

    // Save user message
    await AIMessage.create({
      conversationId: conversation.id,
      text: userText,
      isUser: true,
    });

    // Generate AI response (pass attachments for Claude vision)
    const aiResponse = await generateAIResponse(message, attachments);

    // Save AI message
    await AIMessage.create({
      conversationId: conversation.id,
      text: aiResponse.reply,
      isUser: false,
      category: aiResponse.category,
    });

    // Update conversation category
    if (aiResponse.category && !conversation.category) {
      conversation.category = aiResponse.category;
      await conversation.save();
    }

    // Учитываем free-лимит ТОЛЬКО после успешного ответа (не на ошибках)
    if (req.aiLimitKey) {
      try {
        const redis = getRedis();
        if (redis) {
          await redis.incr(req.aiLimitKey);
          if (req.aiLimitUsed === 0) await redis.expire(req.aiLimitKey, 86400);
        }
      } catch (e) { /* лимитер недоступен — не блокируем ответ */ }
    }

    res.json({
      message: aiResponse.reply,
      category: aiResponse.category,
      conversationId: conversation.id,
      fallback: aiResponse.fallback === true,
    });
  } catch (err) {
    next(err);
  } finally {
    cleanupFiles(); // файлы удаляются на ЛЮБОМ исходе (успех/ошибка)
  }
});

// GET /api/ai/chat/conversations — list conversations
router.get('/chat/conversations', authenticate, async (req, res, next) => {
  try {
    const conversations = await AIConversation.findAll({
      where: { userId: req.userId },
      order: [['updatedAt', 'DESC']],
      limit: 50,
    });
    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/chat/history/:conversationId — conversation history
router.get('/chat/history/:conversationId', authenticate, async (req, res, next) => {
  try {
    // БЕЗОПАСНОСТЬ: отдаём историю только владельцу диалога (IDOR)
    const conversation = await AIConversation.findByPk(req.params.conversationId);
    if (!conversation || conversation.userId !== req.userId) {
      return res.status(404).json({ error: 'Диалог не найден' });
    }
    const messages = await AIMessage.findAll({
      where: { conversationId: req.params.conversationId },
      order: [['createdAt', 'ASC']],
    });
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
