const path = require('path');
const { spawnSync } = require('child_process');
const { resetDb, models, makeClient, makeLawyer } = require('./helpers');
const { runProdSeed } = require('../src/seeds/prod-seed');

beforeEach(resetDb);

test('production seed дважды не меняет существующие профили, промо и консультации', async () => {
  const sentinelClient = await makeClient('seed-sentinel-client@test.uz');
  const { user: sentinelLawyer } = await makeLawyer('seed-sentinel-lawyer@test.uz');
  const consultation = await models.Consultation.create({
    clientId: sentinelClient.id, lawyerId: sentinelLawyer.id, question: 'sentinel', status: 'pending',
  });
  await makeClient('akbarov@maslaxat.uz'); // collision: этот email нельзя превращать в юриста
  const { lp: existingProfile } = await makeLawyer('yuladshev@maslaxat.uz', {
    verificationStatus: 'draft', price: 123456, description: 'Пользовательский профиль не принадлежит сиду.',
  });
  await models.Promo.create({ code: 'EMAS10', discountPercent: 3, minAmount: 999, isActive: false });

  await runProdSeed();
  const countsAfterFirst = {
    users: await models.User.count(), profiles: await models.LawyerProfile.count(), specs: await models.Specialization.count(), promos: await models.Promo.count(),
  };
  await runProdSeed();
  const countsAfterSecond = {
    users: await models.User.count(), profiles: await models.LawyerProfile.count(), specs: await models.Specialization.count(), promos: await models.Promo.count(),
  };

  expect(countsAfterSecond).toEqual(countsAfterFirst);
  expect(await models.Consultation.findByPk(consultation.id)).toBeTruthy();
  await existingProfile.reload();
  expect(existingProfile).toMatchObject({ verificationStatus: 'draft', price: 123456 });
  expect(await models.LawyerProfile.count({ where: { userId: (await models.User.findOne({ where: { email: 'akbarov@maslaxat.uz' } })).id } })).toBe(0);
  const promo = await models.Promo.findOne({ where: { code: 'EMAS10' } });
  expect(promo).toMatchObject({ discountPercent: 3, minAmount: 999, isActive: false });
});

test('destructive seed невозможно запустить в production', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../src/seeds/index.js')], {
    env: { ...process.env, NODE_ENV: 'production', ALLOW_DESTRUCTIVE_SEED: '1' }, encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Destructive reset seed blocked');
});
