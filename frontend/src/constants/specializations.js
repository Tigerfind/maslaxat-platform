// ЕДИНЫЙ справочник специализаций для всего приложения.
// id (slug) совпадает с ключами specLabel/specNames (i18n); name — каноническое
// русское значение (так хранит бэкенд и фильтрует каталог). Раньше было три разных
// списка (redux/booking = 8, онбординг = 10, редактор профиля = 12) — из-за чего
// область юриста могла не сматчиться при бронировании. Теперь источник один.
export const SPECIALIZATIONS = [
  { id: 'civil', name: 'Гражданское право' },
  { id: 'family', name: 'Семейное право' },
  { id: 'criminal', name: 'Уголовное право' },
  { id: 'corporate', name: 'Корпоративное право' },
  { id: 'commercial', name: 'Коммерческое право' },
  { id: 'labor', name: 'Трудовое право' },
  { id: 'tax', name: 'Налоговое право' },
  { id: 'administrative', name: 'Административное право' },
  { id: 'land', name: 'Земельное право' },
  { id: 'ip', name: 'Интеллектуальная собственность' },
  { id: 'housing', name: 'Жилищное право' },
  { id: 'insurance', name: 'Страховое право' },
].map((s, i) => ({ ...s, active: true, order: i + 1 }));

// Массив имён — для чипов онбординга/редактора профиля (специализации хранятся именами).
export const SPECIALIZATION_NAMES = SPECIALIZATIONS.map((s) => s.name);

export default SPECIALIZATIONS;
