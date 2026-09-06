import { countWeeklySlots, MIN_WEEKLY_SLOTS } from './schedulePolicy';

test('считает недельную ёмкость расписания теми же 30-минутными слотами', () => {
  expect(MIN_WEEKLY_SLOTS).toBe(3);
  expect(countWeeklySlots({ mon: { enabled: true, from: '09:00', to: '10:00' } })).toBe(2);
  expect(countWeeklySlots({ mon: { enabled: true, from: '09:00', to: '10:30' } })).toBe(3);
  expect(countWeeklySlots({ mon: { enabled: false, from: '09:00', to: '18:00' } })).toBe(0);
});
