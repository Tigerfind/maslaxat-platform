const { Op, fn, col, literal } = require('sequelize');
const { Consultation } = require('../models');

const MIN_RESPONSE_SAMPLES = 3;

async function responseTimesByLawyerIds(lawyerIds) {
  const ids = [...new Set((lawyerIds || []).filter(Boolean))];
  const result = new Map(ids.map((id) => [id, null]));
  if (!ids.length) return result;
  const rows = await Consultation.findAll({
    where: { lawyerId: { [Op.in]: ids }, acceptedAt: { [Op.ne]: null } },
    attributes: [
      'lawyerId',
      [fn('COUNT', col('Consultation.id')), 'sampleSize'],
      [literal('percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (accepted_at - created_at)) / 60)'), 'medianMinutes'],
    ],
    group: ['lawyerId'],
    raw: true,
  });
  for (const row of rows) {
    const sampleSize = Number(row.sampleSize) || 0;
    if (sampleSize >= MIN_RESPONSE_SAMPLES) {
      result.set(row.lawyerId, Math.max(1, Math.round(Number(row.medianMinutes) || 0)));
    }
  }
  return result;
}

module.exports = { MIN_RESPONSE_SAMPLES, responseTimesByLawyerIds };
