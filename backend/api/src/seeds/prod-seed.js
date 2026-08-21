// Идемпотентный сид для ПРОДА — НЕ разрушающий.
// В отличие от index.js (sync force:true — дропает всё), этот скрипт только
// ДОБАВЛЯ�ет демо-данные через findOrCreate: существующие записи не трогает,
// таблицы не пересоздаёт. Безопасно запускать повторно.
require('dotenv').config();
const { sequelize, User, LawyerProfile, Specialization } = require('../models');

const lawyers = [
  { name: 'Акбаров Азиз', email: 'akbarov@maslaxat.uz', spec: 'Гражданское право', exp: 12, price: 250000, rating: 4.9, reviews: 127, cases: 234, location: 'Ташкент, Мирзо-Улугбекский район' },
  { name: 'Каримова Дилора', email: 'karimova@maslaxat.uz', spec: 'Семейное право', exp: 8, price: 200000, rating: 4.8, reviews: 98, cases: 156, location: 'Ташкент, Юнусабадский район' },
  { name: 'Рахимов Жасур', email: 'rakhimov@maslaxat.uz', spec: 'Уголовное право', exp: 15, price: 350000, rating: 4.7, reviews: 145, cases: 312, location: 'Ташкент, Яшнабадский район' },
  { name: 'Мирзаева Нигора', email: 'mirzaeva@maslaxat.uz', spec: 'Трудовое право', exp: 10, price: 180000, rating: 4.9, reviews: 87, cases: 198, location: 'Ташкент, Чиланзарский район' },
  { name: 'Усманов Бахтиёр', email: 'usmanov@maslaxat.uz', spec: 'Коммерческое право', exp: 14, price: 400000, rating: 4.6, reviews: 112, cases: 267, location: 'Ташкент, Мирабадский район' },
  { name: 'Хасанова Гульнара', email: 'khasanova@maslaxat.uz', spec: 'Налоговое право', exp: 9, price: 300000, rating: 4.8, reviews: 76, cases: 145, location: 'Ташкент, Сергелийский район' },
  { name: 'Салимов Тимур', email: 'salimov@maslaxat.uz', spec: 'Административное право', exp: 11, price: 220000, rating: 4.7, reviews: 93, cases: 187, location: 'Ташкент, Алмазарский район' },
  { name: 'Юнусова Зарина', email: 'yunusova@maslaxat.uz', spec: 'Земельное право', exp: 7, price: 190000, rating: 4.9, reviews: 68, cases: 123, location: 'Ташкент, Шайхантахурский район' },
  { name: 'Алимов Фаррух', email: 'alimov@maslaxat.uz', spec: 'Интеллектуальная собственность', exp: 13, price: 450000, rating: 4.8, reviews: 54, cases: 156, location: 'Ташкент, Учтепинский район' },
  { name: 'Иванов Иван', email: 'ivanov@maslaxat.uz', spec: 'Корпоративное право', exp: 16, price: 380000, rating: 4.9, reviews: 142, cases: 289, location: 'Ташкент, Яккасарайский район' },
  { name: 'Юладшев Абдулазиз', email: 'yuladshev@maslaxat.uz', spec: 'Налоговое право', exp: 10, price: 725000, rating: 0, reviews: 0, cases: 0, location: 'Ташкент' },
];

const specializations = [
  { name: 'Гражданское право', nameUz: 'Fuqarolik huquqi', nameEn: 'Civil Law', icon: 'Gavel' },
  { name: 'Семейное право', nameUz: 'Oila huquqi', nameEn: 'Family Law', icon: 'FamilyRestroom' },
  { name: 'Уголовное право', nameUz: 'Jinoyat huquqi', nameEn: 'Criminal Law', icon: 'Shield' },
  { name: 'Трудовое право', nameUz: 'Mehnat huquqi', nameEn: 'Labor Law', icon: 'Work' },
  { name: 'Коммерческое право', nameUz: 'Tijorat huquqi', nameEn: 'Commercial Law', icon: 'Business' },
  { name: 'Налоговое право', nameUz: 'Soliq huquqi', nameEn: 'Tax Law', icon: 'AccountBalance' },
  { name: 'Административное право', nameUz: 'Ma\'muriy huquq', nameEn: 'Administrative Law', icon: 'AdminPanelSettings' },
  { name: 'Земельное право', nameUz: 'Yer huquqi', nameEn: 'Land Law', icon: 'Terrain' },
  { name: 'Интеллектуальная собственность', nameUz: 'Intellektual mulk', nameEn: 'IP Law', icon: 'Lightbulb' },
  { name: 'Корпоративное право', nameUz: 'Korporativ huquq', nameEn: 'Corporate Law', icon: 'CorporateFare' },
];

async function runProdSeed() {
  // Только проверяем соединение — НЕ дропаем и НЕ alter'им схему.
  await sequelize.authenticate();

  let created = 0, skipped = 0, updated = 0;

    // Демо клиент и админ
    const demoUsers = [
      { email: 'client@maslaxat.uz', password: 'client123', name: 'Клиент Тестовый', phone: '+998901234567', role: 'client', isVerified: true },
      { email: 'admin@maslaxat.uz', password: 'admin123', name: 'Администратор', phone: '+998901234568', role: 'admin', isVerified: true },
    ];
    for (const u of demoUsers) {
      const [, wasCreated] = await User.findOrCreate({ where: { email: u.email }, defaults: u });
      wasCreated ? created++ : skipped++;
    }

    // Юристы + профили
      // Часы приёма: без них availabilityService не выдаёт ни одного слота,
      // и записаться к юристу физически невозможно — форма брони показывает
      // пустой календарь. Демо-юристам ставим рабочую неделю пн–пт 09:00–18:00.
      const WORK_WEEK = {
        mon: { enabled: true, from: '09:00', to: '18:00' },
        tue: { enabled: true, from: '09:00', to: '18:00' },
        wed: { enabled: true, from: '09:00', to: '18:00' },
        thu: { enabled: true, from: '09:00', to: '18:00' },
        fri: { enabled: true, from: '09:00', to: '18:00' },
        sat: { enabled: false, from: '09:00', to: '18:00' },
        sun: { enabled: false, from: '09:00', to: '18:00' },
      };

    for (const l of lawyers) {
      const [user, userCreated] = await User.findOrCreate({
        where: { email: l.email },
        defaults: { email: l.email, password: 'lawyer123', name: l.name, role: 'lawyer', isVerified: true },
      });
      userCreated ? created++ : skipped++;
      if (!userCreated && user.role !== 'lawyer') {
        console.warn(`Пропуск ${l.email}: существующий аккаунт имеет роль ${user.role}`);
        continue;
      }

      const [, profCreated] = await LawyerProfile.findOrCreate({
        where: { userId: user.id },
        defaults: {
          userId: user.id,
          specialization: l.spec,
          specializations: [l.spec],
          experience: l.exp,
          price: l.price,
          rating: 0,
          reviewsCount: 0,
          completedCases: 0,
          location: l.location,
          languages: l.exp % 2 === 0 ? ['Русский', 'Узбекский', 'Английский'] : ['Русский', 'Узбекский'],
          description: `Опытный юрист. Специализация: ${l.spec}`,
          schedule: WORK_WEEK,
          isAvailable: true,
          verificationStatus: 'approved',
        },
      });
      profCreated ? created++ : skipped++;

      // Сид владеет только вновь созданной записью. Существующий профиль может
      // уже принадлежать реальному человеку, поэтому его модерацию/цену/график не меняем.
    }

    // Специализации
    for (const s of specializations) {
      const [, wasCreated] = await Specialization.findOrCreate({ where: { name: s.name }, defaults: { ...s, lawyerCount: 1 } });
      wasCreated ? created++ : skipped++;
    }

    // Промокоды добавляются только при отсутствии; отключённые админом не реактивируются.
    try {
      const { seedPromos } = require('./promos');
      await seedPromos();
      console.log('промокоды: ок');
    } catch (e) {
      console.log('промокоды пропущены:', e.message);
    }

    console.log(`\nГотово. Создано: ${created}, обновлено: ${updated}, уже было (пропущено): ${skipped}`);
  return { created, skipped, updated };
}

module.exports = { runProdSeed };

// CLI-режим: `node src/seeds/prod-seed.js` — запускает и выходит.
if (require.main === module) {
  runProdSeed()
    .then((r) => { console.log('OK', r); process.exit(0); })
    .catch((e) => { console.error('Seed error:', e); process.exit(1); });
}
