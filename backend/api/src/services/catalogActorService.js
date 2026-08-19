const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'catalog_actor';
const COOKIE_SECONDS = 30 * 24 * 60 * 60;

function secret() {
  return process.env.CATALOG_CURSOR_SECRET || process.env.JWT_SECRET;
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

function encodeActor(id) {
  const body = Buffer.from(JSON.stringify({ v: 1, id, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  return `${body}.${sign(body)}`;
}

function decodeActor(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  const [body, signature, extra] = value.split('.');
  if (!body || !signature || extra) return null;
  const expected = Buffer.from(sign(body));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.v === 1 && typeof payload.id === 'string' && /^[A-Za-z0-9_-]{32}$/.test(payload.id)
      ? payload.id : null;
  } catch (_error) {
    return null;
  }
}

function cookieValue(req) {
  const header = req.get('cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) {
      try { return decodeURIComponent(rest.join('=')); } catch (_error) { return null; }
    }
  }
  return null;
}

function optionalUserId(req) {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    return payload.twofa || typeof payload.id !== 'string' ? null : payload.id;
  } catch (_error) {
    return null;
  }
}

function resolveCatalogActor(req, res) {
  let id = decodeActor(cookieValue(req));
  if (!id) {
    id = crypto.randomBytes(24).toString('base64url');
    const crossSite = process.env.CATALOG_COOKIE_CROSS_SITE === '1';
    res.cookie(COOKIE_NAME, encodeActor(id), {
      httpOnly: true,
      sameSite: crossSite ? 'none' : 'lax',
      secure: crossSite || process.env.NODE_ENV === 'production',
      maxAge: COOKIE_SECONDS * 1000,
      path: '/',
    });
  }
  const userId = req.userId || optionalUserId(req) || 'anonymous';
  return crypto.createHash('sha256').update(`${id}\0${userId}`).digest('base64url');
}

module.exports = { COOKIE_NAME, decodeActor, resolveCatalogActor };
