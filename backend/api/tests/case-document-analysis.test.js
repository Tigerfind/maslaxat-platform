const mockAnalyzeCaseDocument = jest.fn();
const mockHasRealApiKey = jest.fn(() => true);

jest.mock('../src/services/documentAnalysisService', () => ({
  MODEL: 'claude-sonnet-4-5-20250929',
  PROMPT_VERSION: 'case-document-v1',
  hasRealApiKey: mockHasRealApiKey,
  analyzeCaseDocument: mockAnalyzeCaseDocument,
}));
jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { randomUUID } = require('crypto');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

const { Consultation, CaseDocument, CaseDocumentAnalysis } = models;
const result = {
  documentType: 'Договор оказания услуг',
  parties: [{ name: 'ООО Клиент', role: 'Заказчик' }],
  keyDates: [{ date: '2026-09-20', description: 'Срок оплаты' }],
  amounts: [{ amount: '1000000', currency: 'UZS', purpose: 'Оплата услуг' }],
  subject: 'Оказание юридических услуг',
  obligations: ['Исполнитель оказывает услуги'],
  risks: ['Не определен порядок приемки'],
  summary: 'Документ регулирует оказание юридических услуг. Следует уточнить порядок приемки результата.',
};

let client;
let lawyer;
let outsider;
let consultation;
let clientToken;
let lawyerToken;
let outsiderToken;
const createdPaths = [];

async function createDocument(name = 'contract.txt') {
  const filePath = path.join(process.env.UPLOAD_DIR || './uploads', `analysis-${randomUUID()}.txt`);
  fs.writeFileSync(filePath, 'Договор об оказании юридических услуг. Стоимость 1 000 000 сум.');
  createdPaths.push(filePath);
  return CaseDocument.create({
    consultationId: consultation.id,
    uploaderId: client.id,
    name,
    path: filePath,
    mimeType: 'text/plain',
    size: 70,
  });
}

const endpoint = (documentId, consultationId = consultation.id) =>
  `/api/consultations/${consultationId}/documents/${documentId}/ai-analysis`;

beforeAll(async () => {
  await resetDb();
  client = await makeClient('analysis-client@test.uz');
  lawyer = (await makeLawyer('analysis-lawyer@test.uz')).user;
  outsider = await makeClient('analysis-outsider@test.uz');
  consultation = await Consultation.create({
    clientId: client.id,
    lawyerId: lawyer.id,
    type: 'chat',
    status: 'completed',
    question: 'Проверить договор',
  });
  clientToken = tokenFor(client);
  lawyerToken = tokenFor(lawyer);
  outsiderToken = tokenFor(outsider);
});

beforeEach(() => {
  mockHasRealApiKey.mockReturnValue(true);
  mockAnalyzeCaseDocument.mockReset().mockResolvedValue(result);
});

afterAll(async () => {
  for (const filePath of createdPaths) {
    try { fs.unlinkSync(filePath); } catch (error) { /* already removed */ }
  }
});

test('assigned lawyer receives structured analysis and subsequent request uses cache', async () => {
  const document = await createDocument();
  const first = await request(app).post(endpoint(document.id)).set('Authorization', `Bearer ${lawyerToken}`);
  expect(first.status).toBe(200);
  expect(first.body.analysis).toMatchObject({ status: 'completed', result, cached: false, promptVersion: 'case-document-v1' });
  expect(first.body.analysis).not.toHaveProperty('lastError');

  const cached = await request(app).post(endpoint(document.id)).set('Authorization', `Bearer ${lawyerToken}`);
  expect(cached.status).toBe(200);
  expect(cached.body.analysis).toMatchObject({ status: 'completed', result, cached: true });
  expect(mockAnalyzeCaseDocument).toHaveBeenCalledTimes(1);
});

test('client is forbidden and outsider is rejected by participant policy', async () => {
  const document = await createDocument('access.txt');
  expect((await request(app).post(endpoint(document.id)).set('Authorization', `Bearer ${clientToken}`)).status).toBe(403);
  expect((await request(app).post(endpoint(document.id)).set('Authorization', `Bearer ${outsiderToken}`)).status).toBe(403);
  expect(mockAnalyzeCaseDocument).not.toHaveBeenCalled();
});

test('document is looked up by both document and consultation IDs', async () => {
  const document = await createDocument('wrong-consultation.txt');
  expect((await request(app).post(endpoint(randomUUID())).set('Authorization', `Bearer ${lawyerToken}`)).status).toBe(404);

  const other = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, type: 'chat', status: 'accepted', question: 'Другое дело' });
  const response = await request(app).post(endpoint(document.id, other.id)).set('Authorization', `Bearer ${lawyerToken}`);
  expect(response.status).toBe(404);
});

test('unavailable AI returns 503 without creating a processing row', async () => {
  const document = await createDocument('unavailable.txt');
  mockHasRealApiKey.mockReturnValue(false);
  const response = await request(app).post(endpoint(document.id)).set('Authorization', `Bearer ${lawyerToken}`);
  expect(response.status).toBe(503);
  expect(response.body.code).toBe('AI_UNAVAILABLE');
  expect(await CaseDocumentAnalysis.count({ where: { caseDocumentId: document.id } })).toBe(0);
  expect(mockAnalyzeCaseDocument).not.toHaveBeenCalled();
});

test('AI failure is persisted and a later request can retry', async () => {
  const document = await createDocument('retry.txt');
  const failure = new Error('Claude upstream failed');
  failure.status = 502;
  failure.code = 'AI_UPSTREAM_ERROR';
  mockAnalyzeCaseDocument.mockRejectedValueOnce(failure);

  const failed = await request(app).post(endpoint(document.id)).set('Authorization', `Bearer ${lawyerToken}`);
  expect(failed.status).toBe(502);
  const failedRow = await CaseDocumentAnalysis.findOne({ where: { caseDocumentId: document.id } });
  expect(failedRow.status).toBe('failed');
  expect(failedRow.result).toBeNull();

  const retried = await request(app).post(endpoint(document.id)).set('Authorization', `Bearer ${lawyerToken}`);
  expect(retried.status).toBe(200);
  expect(retried.body.analysis.status).toBe('completed');
  expect(mockAnalyzeCaseDocument).toHaveBeenCalledTimes(2);
});

test('lawyer list includes analysis metadata while client list does not', async () => {
  const document = await createDocument('visibility.txt');
  await request(app).post(endpoint(document.id)).set('Authorization', `Bearer ${lawyerToken}`);
  const listUrl = `/api/consultations/${consultation.id}/documents`;

  const lawyerList = await request(app).get(listUrl).set('Authorization', `Bearer ${lawyerToken}`);
  expect(lawyerList.body.canAnalyze).toBe(true);
  const lawyerDocument = lawyerList.body.documents.find((item) => item.id === document.id);
  expect(lawyerDocument).toMatchObject({ canAnalyze: true, analysis: { status: 'completed', result } });
  expect(lawyerDocument).not.toHaveProperty('path');

  const clientList = await request(app).get(listUrl).set('Authorization', `Bearer ${clientToken}`);
  expect(clientList.body.canAnalyze).toBe(false);
  const clientDocument = clientList.body.documents.find((item) => item.id === document.id);
  expect(clientDocument).not.toHaveProperty('canAnalyze');
  expect(clientDocument).not.toHaveProperty('analysis');
});

test('deleting a case document cascades its analyses', async () => {
  const document = await createDocument('cascade.txt');
  await request(app).post(endpoint(document.id)).set('Authorization', `Bearer ${lawyerToken}`);
  expect(await CaseDocumentAnalysis.count({ where: { caseDocumentId: document.id } })).toBe(1);
  await document.destroy();
  expect(await CaseDocumentAnalysis.count({ where: { caseDocumentId: document.id } })).toBe(0);
});

test('concurrent requests result in one paid call and one processing conflict', async () => {
  const document = await createDocument('concurrent.txt');
  let release;
  mockAnalyzeCaseDocument.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(result); }));

  const firstPromise = request(app).post(endpoint(document.id)).set('Authorization', `Bearer ${lawyerToken}`).then((response) => response);
  while (mockAnalyzeCaseDocument.mock.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await request(app).post(endpoint(document.id)).set('Authorization', `Bearer ${lawyerToken}`);
  expect(second.status).toBe(409);
  expect(second.body.code).toBe('AI_ANALYSIS_PROCESSING');

  release();
  const first = await firstPromise;
  expect(first.status).toBe(200);
  expect(mockAnalyzeCaseDocument).toHaveBeenCalledTimes(1);
  expect(await CaseDocumentAnalysis.count({ where: { caseDocumentId: document.id } })).toBe(1);
});
