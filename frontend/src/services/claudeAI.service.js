// Claude AI Service для интеграции с Anthropic API
// API ключ должен быть в .env файле: REACT_APP_CLAUDE_API_KEY=your_key_here
const CLAUDE_API_KEY = process.env.REACT_APP_CLAUDE_API_KEY || '';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

class ClaudeAIService {
  async sendMessage(message, specialization = null, conversationHistory = []) {
    try {
      const systemPrompt = this.buildSystemPrompt(specialization);
      const messages = this.formatMessages(conversationHistory, message);

      const response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4096,
          system: systemPrompt,
          messages: messages,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'API request failed');
      }

      const data = await response.json();
      return {
        success: true,
        message: data.content[0].text,
        usage: data.usage,
      };
    } catch (error) {
      console.error('Claude AI Error:', error);
      return {
        success: false,
        error: error.message,
        message: 'Извините, произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте еще раз.',
      };
    }
  }

  buildSystemPrompt(specialization) {
    const basePrompt = `Вы - профессиональный юридический AI-консультант платформы MaslaXat для Узбекистана. Ваша задача - предоставлять точную юридическую информацию на основе законодательства Узбекистана.

Правила:
1. Отвечайте на русском или узбекском языке в зависимости от языка вопроса
2. Ссылайтесь на конкретные статьи законов Узбекистана когда это возможно
3. Если вы не уверены в ответе, честно об этом сообщите
4. Рекомендуйте консультацию с юристом для сложных случаев
5. Будьте профессиональны, но дружелюбны
6. Структурируйте ответы с четкими пунктами`;

    const specializationPrompts = {
      'civil': '\n\nСпециализация: Гражданское право. Фокусируйтесь на вопросах имущественных и личных неимущественных отношений, договоров, обязательств.',
      'family': '\n\nСпециализация: Семейное право. Фокусируйтесь на вопросах брака, развода, алиментов, опеки, усыновления.',
      'corporate': '\n\nСпециализация: Корпоративное право. Фокусируйтесь на вопросах регистрации бизнеса, корпоративных отношений, сделок M&A.',
      'criminal': '\n\nСпециализация: Уголовное право. Фокусируйтесь на вопросах преступлений, наказаний, уголовного процесса.',
      'real-estate': '\n\nСпециализация: Недвижимость. Фокусируйтесь на вопросах купли-продажи, аренды, регистрации недвижимости.',
      'labor': '\n\nСпециализация: Трудовое право. Фокусируйтесь на вопросах трудовых договоров, увольнений, трудовых споров.',
      'tax': '\n\nСпециализация: Налоговое право. Фокусируйтесь на вопросах налогообложения, налоговых споров, отчетности.',
      'intellectual': '\n\nСпециализация: Интеллектуальная собственность. Фокусируйтесь на вопросах патентов, товарных знаков, авторских прав.',
    };

    return basePrompt + (specialization ? specializationPrompts[specialization] || '' : '');
  }

  formatMessages(history, newMessage) {
    const messages = [];

    // Добавляем историю
    history.forEach(msg => {
      messages.push({
        role: msg.isUser ? 'user' : 'assistant',
        content: msg.text,
      });
    });

    // Добавляем новое сообщение
    messages.push({
      role: 'user',
      content: newMessage,
    });

    return messages;
  }

  async analyzeDocument(documentText, specialization = null) {
    const prompt = `Проанализируйте следующий юридический документ и предоставьте:
1. Краткое резюме
2. Выявленные проблемы или риски
3. Рекомендации по улучшению

Документ:
${documentText}`;

    return this.sendMessage(prompt, specialization, []);
  }

  async generateDocument(documentType, parameters) {
    const prompt = `Сгенерируйте шаблон документа типа "${documentType}" со следующими параметрами:
${JSON.stringify(parameters, null, 2)}

Создайте полноценный документ с учетом законодательства Узбекистана.`;

    return this.sendMessage(prompt, null, []);
  }

  async recommendLawyers(userQuestion, specialization) {
    // Эта функция будет вызывать backend API для получения рекомендаций
    // На основе анализа вопроса пользователя
    try {
      const analysis = await this.sendMessage(
        `Проанализируйте вопрос пользователя и определите, к какой области права он относится. Верните только название области из списка: Гражданское право, Семейное право, Корпоративное право, Уголовное право, Недвижимость, Трудовое право, Налоговое право, Интеллектуальная собственность.

Вопрос: ${userQuestion}`,
        null,
        []
      );

      return {
        suggestedSpecialization: analysis.message,
        confidence: 0.85,
      };
    } catch (error) {
      console.error('Error recommending lawyers:', error);
      return null;
    }
  }
}

export default new ClaudeAIService();
