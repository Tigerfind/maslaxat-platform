import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../i18n';
import ConnectivityStatus from './ConnectivityStatus';
import { vi } from 'vitest';

describe('ConnectivityStatus', () => {
  test('deduplicates connectivity events and briefly announces reconnection', () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    render(<LanguageProvider><ConnectivityStatus /></LanguageProvider>);
    expect(screen.queryByTestId('connectivity-status')).not.toBeInTheDocument();

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByTestId('connectivity-status')).toHaveTextContent('Нет подключения');
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getAllByTestId('connectivity-status')).toHaveLength(1);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.getByTestId('connectivity-status')).toHaveTextContent('Подключение восстановлено');
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.queryByTestId('connectivity-status')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
