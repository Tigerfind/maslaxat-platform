const { PlatformSetting, PlatformSettingAudit } = require('../models');

const COMMISSION_KEY = 'commission_rate_bps';
const DEFAULT_COMMISSION_RATE_BPS = 1500;

async function getCommissionRateBps(tx) {
  const [setting] = await PlatformSetting.findOrCreate({
    where: { key: COMMISSION_KEY },
    defaults: { value: String(DEFAULT_COMMISSION_RATE_BPS) },
    transaction: tx,
  });
  if (tx) await setting.reload({ lock: tx.LOCK.UPDATE, transaction: tx });
  const value = Number(setting.value);
  if (!Number.isInteger(value) || value < 0 || value > 5000) {
    throw new Error('Invalid stored commission rate');
  }
  return value;
}

async function setCommissionRateBps(value, changedByUserId, tx) {
  const rate = Number(value);
  if (!Number.isInteger(rate) || rate < 0 || rate > 5000) {
    throw new Error('Commission rate must be an integer between 0 and 5000 basis points');
  }
  if (!changedByUserId) throw new Error('Commission change requires an actor');

  const run = async (transaction) => {
    const [setting] = await PlatformSetting.findOrCreate({
      where: { key: COMMISSION_KEY },
      defaults: { value: String(DEFAULT_COMMISSION_RATE_BPS) },
      transaction,
    });
    await setting.reload({ lock: transaction.LOCK.UPDATE, transaction });
    const oldValue = setting.value;
    if (oldValue === String(rate)) return rate;
    await setting.update({ value: String(rate) }, { transaction });
    await PlatformSettingAudit.create({
      key: COMMISSION_KEY,
      oldValue,
      newValue: String(rate),
      changedByUserId,
    }, { transaction });
    return rate;
  };

  return tx ? run(tx) : PlatformSetting.sequelize.transaction(run);
}

module.exports = {
  COMMISSION_KEY,
  DEFAULT_COMMISSION_RATE_BPS,
  getCommissionRateBps,
  setCommissionRateBps,
};
