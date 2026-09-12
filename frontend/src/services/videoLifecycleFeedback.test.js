import { describe, expect, test, vi } from 'vitest';
import { notifyVideoLifecycleFailure } from './videoLifecycleFeedback';

describe('notifyVideoLifecycleFailure', () => {
  test('surfaces the server reason through the provided notifier', () => {
    const notify = vi.fn();
    const error = { response: { data: { error: 'Подключение сейчас недоступно' } } };

    notifyVideoLifecycleFailure('Не удалось начать видеозвонок: ', error, notify);

    expect(notify).toHaveBeenCalledWith(
      'Не удалось начать видеозвонок: Подключение сейчас недоступно',
    );
  });

  test('uses the localized fallback when the response has no safe message', () => {
    const notify = vi.fn();

    notifyVideoLifecycleFailure('Не удалось завершить видеозвонок', new Error(), notify);

    expect(notify).toHaveBeenCalledWith('Не удалось завершить видеозвонок');
  });
});
