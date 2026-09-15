const mockMessagesCreate = jest.fn();
const mockPdfGetText = jest.fn();
const mockPdfDestroy = jest.fn().mockResolvedValue();
const mockMammothExtract = jest.fn();

jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({ messages: { create: mockMessagesCreate } })));
jest.mock('pdf-parse', () => ({ PDFParse: jest.fn().mockImplementation(() => ({ getText: mockPdfGetText, destroy: mockPdfDestroy })) }));
jest.mock('mammoth', () => ({ extractRawText: mockMammothExtract }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const service = require('../src/services/documentAnalysisService');

const validResult = {
  documentType: 'Договор',
  parties: [],
  keyDates: [],
  amounts: [],
  subject: 'Оказание услуг',
  obligations: [],
  risks: [],
  summary: 'Документ регулирует оказание услуг. Существенные условия требуют проверки.',
};
const files = [];

function tempDocument(extension, content = 'content') {
  const filePath = path.join(os.tmpdir(), `case-analysis-${randomUUID()}${extension}`);
  fs.writeFileSync(filePath, content);
  files.push(filePath);
  return { name: `document${extension}`, path: filePath };
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  mockMessagesCreate.mockReset().mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(validResult) }] });
  mockPdfGetText.mockReset().mockResolvedValue({ text: 'Текст PDF' });
  mockPdfDestroy.mockClear();
  mockMammothExtract.mockReset().mockResolvedValue({ value: 'Текст DOCX' });
});

afterAll(() => {
  for (const filePath of files) {
    try { fs.unlinkSync(filePath); } catch (error) { /* already removed */ }
  }
});

test('rejects placeholder credentials before reading or calling Claude', async () => {
  process.env.ANTHROPIC_API_KEY = 'CHANGE_ME';
  await expect(service.analyzeCaseDocument({ name: 'missing.txt', path: '/missing/private/file.txt' }))
    .rejects.toMatchObject({ status: 503, code: 'AI_UNAVAILABLE' });
  expect(mockMessagesCreate).not.toHaveBeenCalled();
});

test('rejects oversized text instead of silently returning a partial analysis', async () => {
  const document = tempDocument('.txt', 'A'.repeat(50001));
  await expect(service.analyzeCaseDocument(document)).rejects.toMatchObject({ status: 422, code: 'DOCUMENT_TOO_LONG' });
  expect(mockMessagesCreate).not.toHaveBeenCalled();
});

test('treats text as untrusted data and returns only the sanitized schema', async () => {
  const document = tempDocument('.txt', 'A'.repeat(15000));
  mockMessagesCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ ...validResult, ignoredRawOutput: 'secret' }) }] });
  const result = await service.analyzeCaseDocument(document);
  const request = mockMessagesCreate.mock.calls[0][0];
  const enclosedText = request.messages[0].content[0].text.match(/<document>\n([\s\S]*)\n<\/document>/)[1];
  expect(enclosedText).toHaveLength(15000);
  expect(result).toEqual(validResult);
  expect(result).not.toHaveProperty('ignoredRawOutput');
  expect(request.output_config.format.type).toBe('json_schema');
});

test('supports DOCX text and WEBP vision content', async () => {
  await service.analyzeCaseDocument(tempDocument('.docx', Buffer.from('PK')));
  expect(mockMammothExtract).toHaveBeenCalledTimes(1);
  expect(mockMessagesCreate.mock.calls[0][0].messages[0].content[0]).toMatchObject({ type: 'text' });

  await service.analyzeCaseDocument(tempDocument('.webp', Buffer.from('RIFFimageWEBP')));
  expect(mockMessagesCreate.mock.calls[1][0].messages[0].content[0]).toMatchObject({
    type: 'image', source: { type: 'base64', media_type: 'image/webp' },
  });
});

test('returns specific 422 errors for old DOC and image-only PDF', async () => {
  await expect(service.analyzeCaseDocument(tempDocument('.doc')))
    .rejects.toMatchObject({ status: 422, code: 'OLD_DOC_UNSUPPORTED' });

  mockPdfGetText.mockResolvedValueOnce({ text: '   ' });
  await expect(service.analyzeCaseDocument(tempDocument('.pdf', '%PDF-1.4')))
    .rejects.toMatchObject({ status: 422, code: 'SCANNED_PDF_UNSUPPORTED' });
  expect(mockPdfDestroy).toHaveBeenCalled();
});

test('rejects malformed Claude JSON instead of creating a generic result', async () => {
  mockMessagesCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json' }] });
  await expect(service.analyzeCaseDocument(tempDocument('.txt')))
    .rejects.toMatchObject({ status: 502, code: 'AI_INVALID_RESPONSE' });
});

test('maps provider failures to a safe 503 without exposing provider details', async () => {
  mockMessagesCreate.mockRejectedValueOnce(new Error('provider response with sensitive diagnostics'));
  await expect(service.analyzeCaseDocument(tempDocument('.txt')))
    .rejects.toMatchObject({ status: 503, code: 'AI_UNAVAILABLE', message: 'AI-анализ временно недоступен' });
});
