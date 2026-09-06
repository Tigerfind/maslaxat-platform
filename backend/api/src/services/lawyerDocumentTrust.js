const { Op } = require('sequelize');
const { LawyerDocument } = require('../models');

const PUBLIC_DOCUMENT_TYPES = ['diploma', 'license', 'certificate', 'id'];

async function verifiedTypesByUserIds(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const result = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return result;
  const rows = await LawyerDocument.findAll({
    where: {
      userId: { [Op.in]: ids }, verifiedAt: { [Op.ne]: null },
      type: { [Op.in]: PUBLIC_DOCUMENT_TYPES },
    },
    attributes: ['userId', 'type'],
    raw: true,
  });
  for (const row of rows) {
    const types = result.get(row.userId) || [];
    if (!types.includes(row.type)) types.push(row.type);
    result.set(row.userId, types);
  }
  for (const types of result.values()) types.sort((a, b) => PUBLIC_DOCUMENT_TYPES.indexOf(a) - PUBLIC_DOCUMENT_TYPES.indexOf(b));
  return result;
}

module.exports = { PUBLIC_DOCUMENT_TYPES, verifiedTypesByUserIds };
