export const zoomTimeWarning = (remainingSeconds) => {
  if (remainingSeconds <= 0) return { key: 0, text: 'Запланированное время завершено. Доступен технический период 5 минут.' };
  if (remainingSeconds <= 60) return { key: 60, text: 'До конца консультации 1 минута.' };
  if (remainingSeconds <= 300) return { key: 300, text: 'До конца консультации 5 минут.' };
  if (remainingSeconds <= 600) return { key: 600, text: 'До конца консультации 10 минут.' };
  return null;
};
