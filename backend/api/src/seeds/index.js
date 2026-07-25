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

async function seed() {
  try {
    await sequelize.sync({ force: true });
    console.log('Database synced');

    // Create demo users
    const client = await User.create({
      email: 'client@maslaxat.uz',
      password: 'client123',
      name: 'Клиент Тестовый',
      phone: '+998901234567',
      role: 'client',
      isVerified: true,
    });
    console.log('Demo client created');

    const admin = await User.create({
      email: 'admin@maslaxat.uz',
      password: 'admin123',
      name: 'Администратор',
      phone: '+998901234568',
      role: 'admin',
      isVerified: true,
    });
    console.log('Demo admin created');

    // Create lawyers
    for (const l of lawyers) {
      const user = await User.create({
        email: l.email,
        password: 'lawyer123',
        name: l.name,
        role: 'lawyer',
        isVerified: true,
      });

      await LawyerProfile.create({
        userId: user.id,
        specialization: l.spec,
        experience: l.exp,
        price: l.price,
        rating: l.rating,
        reviewsCount: l.reviews,
        completedCases: l.cases,
        location: l.location,
        description: `Опытный юрист. Специализация: ${l.spec}`,
        isAvailable: true,
      });
    }
    console.log(`${lawyers.length} lawyers created`);

    // Create specializations
    for (const s of specializations) {
      await Specialization.create({ ...s, lawyerCount: 1 });
    }
    console.log(`${specializations.length} specializations created`);

    // Create demo promo codes
    const { seedPromos } = require('./promos');
    await seedPromos();
    console.log('promo codes created');

    console.log('\nSeed complete!');
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
}

seed();
