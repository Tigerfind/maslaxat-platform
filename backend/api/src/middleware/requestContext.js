const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');

const storage = new AsyncLocalStorage();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getRequestContext() {
  return storage.getStore() || {};
}

function requestContext(req, res, next) {
  const supplied = req.headers?.['x-request-id'];
  const requestId = typeof supplied === 'string' && UUID.test(supplied) ? supplied : randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  return storage.run({ requestId }, next);
}

module.exports = { getRequestContext, requestContext };
