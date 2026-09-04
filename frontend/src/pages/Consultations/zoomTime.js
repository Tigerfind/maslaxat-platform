export const zoomTimeWarning = (remainingSeconds) => {
  if (remainingSeconds <= 0) return { key: 0, textKey: 'warningGrace' };
  if (remainingSeconds <= 60) return { key: 60, textKey: 'warning1' };
  if (remainingSeconds <= 300) return { key: 300, textKey: 'warning5' };
  if (remainingSeconds <= 600) return { key: 600, textKey: 'warning10' };
  return null;
};
