import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { LanguageProvider } from '../../i18n';
import RatingDialog from './RatingDialog';

const renderDialog = (props) => render(<LanguageProvider><RatingDialog lawyerName="Юрист" {...props} /></LanguageProvider>);

beforeEach(() => localStorage.setItem('language', 'ru'));

test('failed review remains open with the server error and retry data', async () => {
  const onSubmit = vi.fn().mockRejectedValue({ response: { data: { error: 'Отзыв уже существует' } } });
  renderDialog({ open: true, onClose: vi.fn(), onSubmit });
  fireEvent.click(screen.getAllByRole('radio')[3]);
  fireEvent.change(screen.getByPlaceholderText(/Расскажите подробнее/), { target: { value: 'Полезно' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить отзыв' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Отзыв уже существует');
  expect(screen.getByPlaceholderText(/Расскажите подробнее/)).toHaveValue('Полезно');
});

test('closing and reopening resets abandoned review data', async () => {
  const onClose = vi.fn();
  const view = renderDialog({ open: true, onClose, onSubmit: vi.fn() });
  fireEvent.change(screen.getByPlaceholderText(/Расскажите подробнее/), { target: { value: 'Черновик' } });
  view.rerender(<LanguageProvider><RatingDialog open={false} lawyerName="Юрист" onClose={onClose} onSubmit={vi.fn()} /></LanguageProvider>);
  view.rerender(<LanguageProvider><RatingDialog open lawyerName="Юрист" onClose={onClose} onSubmit={vi.fn()} /></LanguageProvider>);
  await waitFor(() => expect(screen.getByPlaceholderText(/Расскажите подробнее/)).toHaveValue(''));
});

test('rapid repeated submit invokes the review request once', async () => {
  let resolveSubmit;
  const onSubmit = vi.fn(() => new Promise((resolve) => { resolveSubmit = resolve; }));
  renderDialog({ open: true, onClose: vi.fn(), onSubmit });
  fireEvent.click(screen.getAllByRole('radio')[4]);
  const submit = screen.getByRole('button', { name: 'Отправить отзыв' });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await act(async () => resolveSubmit());
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
});
