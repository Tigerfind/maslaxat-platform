const SLOT_MINUTES = 30;
const MIN_WEEKLY_SLOTS = 3;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(value) {
  if (!TIME_RE.test(String(value || ''))) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function countWeeklySlots(schedule) {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return 0;
  return Object.values(schedule).reduce((total, day) => {
    if (!day?.enabled) return total;
    const from = toMinutes(day.from);
    const to = toMinutes(day.to);
    if (from === null || to === null || to <= from) return total;
    return total + Math.floor((to - from) / SLOT_MINUTES);
  }, 0);
}

function scheduleMeetsMinimum(schedule) {
  return countWeeklySlots(schedule) >= MIN_WEEKLY_SLOTS;
}

module.exports = { SLOT_MINUTES, MIN_WEEKLY_SLOTS, countWeeklySlots, scheduleMeetsMinimum };
