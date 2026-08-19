const { User, LawyerProfile, LawyerDocument } = require('../models');

const PLACEHOLDER_SPECIALIZATIONS = new Set(['Не указана', 'Общее право', 'General law', 'Umumiy huquq']);

async function computeProfileCompleteness(userId, { transaction } = {}) {
  // A managed PostgreSQL transaction uses one client; sequential queries avoid
  // concurrent client.query calls (deprecated in pg and unsafe under row locks).
  const user = await User.findByPk(userId, { attributes: ['id', 'avatar', 'phone', 'email', 'isVerified'], transaction });
  const profile = await LawyerProfile.findOne({ where: { userId }, transaction });
  const docCount = await LawyerDocument.count({ where: { userId }, transaction });

  const missing = [];
  if (!user?.avatar) missing.push('photo');
  if (!user?.isVerified || !user?.email) missing.push('verifiedContact');
  if (!user?.phone) missing.push('phone');
  if (!profile?.professionalTitle) missing.push('professionalTitle');
  if (!profile?.description || String(profile.description).trim().length < 50) missing.push('description');
  if (!profile?.location) missing.push('location');
  if (!Array.isArray(profile?.languages) || profile.languages.length === 0) missing.push('languages');
  if (!profile?.licenseNumber || !profile?.licenseIssuer || !profile?.licenseIssuedAt) missing.push('license');
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
