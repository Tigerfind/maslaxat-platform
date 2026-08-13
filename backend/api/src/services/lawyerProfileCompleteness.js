const { User, LawyerProfile, LawyerDocument } = require('../models');

const PLACEHOLDER_SPECIALIZATIONS = new Set(['Общее право', 'General law', 'Umumiy huquq']);

async function computeProfileCompleteness(userId) {
  const [user, profile, docCount] = await Promise.all([
    User.findByPk(userId, { attributes: ['id', 'avatar'] }),
    LawyerProfile.findOne({ where: { userId } }),
    LawyerDocument.count({ where: { userId } }),
  ]);

  const missing = [];
  if (!user?.avatar) missing.push('photo');
  if (!profile?.description || String(profile.description).trim().length < 50) missing.push('description');
  if (!(Number(profile?.price) >= 50000)) missing.push('price');

  const specs = (Array.isArray(profile?.specializations) && profile.specializations.length)
    ? profile.specializations
    : (profile?.specialization ? [profile.specialization] : []);
  const realSpecs = specs.filter((spec) => spec && !PLACEHOLDER_SPECIALIZATIONS.has(String(spec).trim()));
  if (realSpecs.length === 0) missing.push('specialization');

  const schedule = profile?.schedule;
  const hasDay = schedule && typeof schedule === 'object'
    && Object.values(schedule).some((day) => day?.enabled);
  if (!hasDay) missing.push('schedule');
  if (docCount < 1) missing.push('documents');

  return { complete: missing.length === 0, missing };
}

module.exports = { computeProfileCompleteness };
