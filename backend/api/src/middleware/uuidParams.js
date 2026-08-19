'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateUuidParam(req, res, next, value) {
  if (!UUID.test(value || '')) {
    return res.status(400).json({ error: 'Некорректный идентификатор', code: 'INVALID_ID' });
  }
  return next();
}

function registerUuidParams(router, ...names) {
  names.forEach((name) => router.param(name, validateUuidParam));
}

module.exports = { registerUuidParams, validateUuidParam };
