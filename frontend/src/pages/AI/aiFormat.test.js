import { extractLaws, stripMarkdown } from './aiFormat';

test('stripMarkdown сохраняет текст и удаляет разметку', () => {
  expect(stripMarkdown('## **Договор**: [источник](https://lex.uz)')).toBe('Договор: источник');
});

test('extractLaws удаляет дубли и ограничивает список', () => {
  const laws = extractLaws('Статья 10, статья 10, ГК РУз и Трудовой кодекс');
  expect(laws.filter((law) => law.toLowerCase() === 'статья 10')).toHaveLength(1);
  expect(laws).toContain('ГК РУз');
  expect(laws.length).toBeLessThanOrEqual(8);
});
