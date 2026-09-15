import React from 'react';
import { vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../../i18n';
import authReducer from '../../store/slices/authSlice';
import api from '../../services/api';
import VerifyEmailPage from './VerifyEmailPage';

vi.mock('../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const renderPage = () => {
  localStorage.setItem('language', 'ru');
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        user: { id: 'user-1', email: 'client@example.uz', role: 'client', isVerified: false },
        token: 'token', role: 'client', isAuthenticated: true, loading: false, error: null,
      },
    },
  });
  render(
    <Provider store={store}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/verify-email']}><VerifyEmailPage /></MemoryRouter>
      </LanguageProvider>
    </Provider>,
  );
  return store;
};

beforeEach(() => vi.clearAllMocks());

test('отправляет ровно шестизначный email-код и обновляет verified-профиль', async () => {
  api.post.mockResolvedValue({
    data: { user: { id: 'user-1', email: 'client@example.uz', role: 'client', isVerified: true } },
  });
  const store = renderPage();

  const input = screen.getByLabelText('Код из письма');
  fireEvent.change(input, { target: { value: '12a34567' } });
  expect(input).toHaveValue('123456');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' })); });

  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/verify-email', { code: '123456' }));
  expect(await screen.findByText('Email подтверждён')).toBeVisible();
  expect(store.getState().auth.user.isVerified).toBe(true);
});

test('показывает ошибку API и позволяет запросить новый код', async () => {
  api.post
    .mockRejectedValueOnce({ response: { data: { error: 'Неверный код' } } })
    .mockResolvedValueOnce({ data: { retryAfter: 60 } });
  renderPage();

  fireEvent.change(screen.getByLabelText('Код из письма'), { target: { value: '000000' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' })); });
  expect(await screen.findByText('Неверный код')).toBeVisible();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Отправить новый код' })); });
  await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/auth/resend-verification'));
});
