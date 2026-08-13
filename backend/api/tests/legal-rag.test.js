const { resetDb, models } = require('./helpers');
const { searchLegalSources, citedSources, normalizeQuery } = require('../src/services/legalRagService');
const { validateDocument } = require('../src/scripts/importLegalCorpus');

const { LegalDocument, LegalChunk } = models;

beforeAll(async () => resetDb());

test('поиск находит действующую статью и не возвращает неактивный документ', async () => {
  const active = await LegalDocument.create({
    title: 'Трудовой кодекс Республики Узбекистан', code: 'ТК РУз', language: 'ru',
    sourceUrl: 'https://lex.uz/ru/docs/active', version: '2026-01-01', isActive: true,
  });
  const inactive = await LegalDocument.create({
    title: 'Старая редакция', language: 'ru', sourceUrl: 'https://lex.uz/ru/docs/old',
    version: '2020-01-01', isActive: false,
  });
  await LegalChunk.bulkCreate([
    { documentId: active.id, ordinal: 0, articleNumber: '22', heading: 'Права работника', content: 'Работник имеет право на трудовой договор и своевременную оплату труда.' },
    { documentId: inactive.id, ordinal: 0, articleNumber: '22', heading: 'Старые права', content: 'Работник и трудовой договор в недействующей редакции.' },
  ]);

  const results = await searchLegalSources('Какие права по статье 22 и трудовому договору?');
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ article: '22', title: active.title, citation: 'S1' });
});

test('нормализация безопасна, а citations возвращают только использованные источники', () => {
  expect(normalizeQuery("' OR 1=1; DROP TABLE legal_chunks; статья 22")).toContain('22');
  const sources = [{ citation: 'S1' }, { citation: 'S2' }];
  expect(citedSources('Ответ [S2]', sources)).toEqual([{ citation: 'S2' }]);
});

test('импорт принимает только официальный домен lex.uz', () => {
  expect(() => validateDocument({
    title: 'Подделка', sourceUrl: 'https://example.com/law', version: '1',
    articles: [{ number: '1', text: 'Достаточно длинный текст нормативного документа.' }],
  })).toThrow(/lex\.uz/);
});
