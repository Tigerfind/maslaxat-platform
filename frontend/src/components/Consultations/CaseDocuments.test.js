import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { LanguageProvider } from '../../i18n';
import api from '../../services/api';
import CaseDocuments from './CaseDocuments';

vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const renderDocuments = (props = {}) => render(
  <LanguageProvider>
    <CaseDocuments consultationId="consultation-1" open onClose={vi.fn()} currentUserId="user-1" {...props} />
  </LanguageProvider>,
);

const caseDocument = {
  id: 'document-1',
  name: 'contract.pdf',
  uploaderId: 'client-1',
  uploader: { name: 'Клиент' },
  size: 2048,
};

const completedAnalysis = {
  id: 'analysis-1',
  status: 'completed',
  model: 'claude-sonnet',
  promptVersion: 'v1',
  completedAt: '2026-09-14T09:30:00.000Z',
  cached: true,
  result: {
    documentType: 'Договор аренды',
    parties: [{ name: 'ООО Арендодатель', role: 'Арендодатель' }, { name: 'Иван Иванов', role: 'Арендатор' }],
    keyDates: [{ date: '2026-10-01', description: 'Начало аренды' }],
    amounts: [{ amount: '5000000', currency: 'UZS', purpose: 'Ежемесячная аренда' }],
    subject: 'Аренда офисного помещения',
    obligations: ['Оплачивать аренду до пятого числа'],
    risks: ['Одностороннее изменение ставки'],
    summary: 'Договор регулирует аренду офиса. Арендатору следует уточнить порядок изменения ставки.',
  },
};

describe('CaseDocuments states', () => {
  beforeEach(() => {
    localStorage.setItem('language', 'ru');
    vi.clearAllMocks();
  });

  test('shows a persistent load error and retries independently from empty state', async () => {
    api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { documents: [], writable: true } });
    renderDocuments();
    expect(await screen.findByText('Не удалось загрузить документы')).toBeInTheDocument();
    expect(screen.queryByText('Пока нет документов по делу')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Пока нет документов по делу')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  test('shows upload only when both server policy and prop allow writes', async () => {
    api.get.mockResolvedValue({ data: { documents: [], writable: true } });
    const view = renderDocuments({ readOnly: true });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Загрузить документ' })).not.toBeInTheDocument();
    view.unmount();

    renderDocuments();
    expect(await screen.findByRole('button', { name: 'Загрузить документ' })).toBeInTheDocument();
  });

  test('rejects invalid and oversized files before the API request', async () => {
    api.get.mockResolvedValue({ data: { documents: [], writable: true } });
    renderDocuments();
    const upload = await screen.findByRole('button', { name: 'Загрузить документ' });
    fireEvent.click(upload);
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [new File(['bad'], 'payload.exe', { type: 'application/octet-stream' })] } });
    expect(api.post).not.toHaveBeenCalled();

    const oversized = new File(['pdf'], 'case.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(api.post).not.toHaveBeenCalled();
  });

  test('shows analysis action only when the server allows the assigned lawyer to analyze', async () => {
    api.get.mockResolvedValue({ data: { documents: [caseDocument], writable: false, canAnalyze: true } });
    const view = renderDocuments();
    expect(await screen.findByRole('button', { name: 'Разобрать документ contract.pdf' })).toBeInTheDocument();
    view.unmount();

    api.get.mockResolvedValue({ data: { documents: [caseDocument], writable: true, canAnalyze: false } });
    renderDocuments();
    await screen.findByText('contract.pdf');
    expect(screen.queryByText('Разобрать документ')).not.toBeInTheDocument();
  });

  test('disables analysis for the document and protects the POST from duplicate clicks', async () => {
    let resolveAnalysis;
    api.get.mockResolvedValue({ data: { documents: [caseDocument], writable: false, canAnalyze: true } });
    api.post.mockImplementation(() => new Promise((resolve) => { resolveAnalysis = resolve; }));
    renderDocuments();

    const analyze = await screen.findByRole('button', { name: 'Разобрать документ contract.pdf' });
    fireEvent.click(analyze);
    fireEvent.click(analyze);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(analyze).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Документ анализируется');

    resolveAnalysis({ data: { analysis: completedAnalysis } });
    expect(await screen.findByText('Договор аренды')).toBeInTheDocument();
  });

  test('renders the successful analysis as structured sections', async () => {
    api.get.mockResolvedValue({ data: { documents: [caseDocument], writable: false, canAnalyze: true } });
    api.post.mockResolvedValue({ data: { analysis: completedAnalysis } });
    renderDocuments();

    fireEvent.click(await screen.findByRole('button', { name: 'Разобрать документ contract.pdf' }));

    expect(await screen.findByRole('heading', { name: 'Тип документа' })).toBeInTheDocument();
    expect(screen.getByText('Договор аренды')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Стороны' })).toBeInTheDocument();
    expect(screen.getByText('ООО Арендодатель')).toBeInTheDocument();
    expect(screen.getByText('Начало аренды')).toBeInTheDocument();
    expect(screen.getByText('Аренда офисного помещения')).toBeInTheDocument();
    expect(screen.getByText('Оплачивать аренду до пятого числа')).toBeInTheDocument();
    expect(screen.getByText('Одностороннее изменение ставки')).toBeInTheDocument();
    expect(screen.getByText(completedAnalysis.result.summary)).toBeInTheDocument();
    expect(screen.getByText('Результат из кэша')).toBeInTheDocument();
  });

  test('opens an existing completed analysis without starting another POST', async () => {
    api.get.mockResolvedValue({ data: { documents: [{ ...caseDocument, analysis: completedAnalysis }], writable: false, canAnalyze: true } });
    renderDocuments();

    fireEvent.click(await screen.findByRole('button', { name: 'Разобрать документ contract.pdf' }));

    expect(await screen.findByText('Договор аренды')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('shows a localized service error and retries the analysis', async () => {
    api.get.mockResolvedValue({ data: { documents: [caseDocument], writable: false, canAnalyze: true } });
    api.post
      .mockRejectedValueOnce({ response: { status: 503, data: {} } })
      .mockResolvedValueOnce({ data: { analysis: completedAnalysis } });
    renderDocuments();

    fireEvent.click(await screen.findByRole('button', { name: 'Разобрать документ contract.pdf' }));
    expect(await screen.findByText('AI-анализ временно недоступен.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Договор аренды')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(2);
  });
});
