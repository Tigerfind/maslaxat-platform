// Сид демо-промокодов. Запуск: node src/seeds/promos.js
require('dotenv').config();
const { sequelize, Promo } = require('../models');

const PROMOS = [
  { code: 'EMAS10', discountPercent: 10, minAmount: 0 },
  { code: 'WELCOME20', discountPercent: 20, minAmount: 100000 },
  { code: 'START15', discountPercent: 15, minAmount: 0, usageLimit: 100 },
];

async function seedPromos() {
  await sequelize.sync();
  for (const p of PROMOS) {
    const [row, created] = await Promo.findOrCreate({ where: { code: p.code }, defaults: p });
    if (!created) await row.update({ ...p, isActive: true });
    console.log(`${created ? 'создан' : 'обновлён'}: ${p.code} (−${p.discountPercent}%)`);
  }
}

if (require.main === module) {
  seedPromos()
    .then(() => { console.log('Промокоды засеяны'); process.exit(0); })
    .catch((e) => { console.error('Ошибка сида промо:', e.message); process.exit(1); });
}

module.exports = { seedPromos };
