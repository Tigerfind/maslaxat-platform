export const SLOT_MINUTES = 30;
export const MIN_WEEKLY_SLOTS = 3;

const toMinutes = (value) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

export const countWeeklySlots = (schedule) => Object.values(schedule || {}).reduce((total, day) => {
  if (!day?.enabled) return total;
  const from = toMinutes(day.from);
  const to = toMinutes(day.to);
  return from === null || to === null || to <= from
    ? total
    : total + Math.floor((to - from) / SLOT_MINUTES);
}, 0);
