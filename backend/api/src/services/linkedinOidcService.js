const crypto = require('crypto');
const { Issuer, generators } = require('openid-client');

let clientPromise;

function isEnabled() {
  return Boolean(process.env.LINKEDIN_CLIENT_ID
    && process.env.LINKEDIN_CLIENT_SECRET
    && process.env.LINKEDIN_REDIRECT_URI);
}

async function getClient() {
  if (!isEnabled()) throw new Error('LinkedIn OIDC is not configured');
  if (!clientPromise) {
    clientPromise = Issuer.discover('https://www.linkedin.com/oauth/.well-known/openid-configuration')
      .then((issuer) => new issuer.Client({
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET,
        redirect_uris: [process.env.LINKEDIN_REDIRECT_URI],
        response_types: ['code'],
      }));
  }
  return clientPromise;
}

async function createAuthorization() {
  const client = await getClient();
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const url = client.authorizationUrl({
    scope: 'openid profile email',
    response_type: 'code',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return { url, state, nonce, codeVerifier };
}

async function exchangeCallback(params, expected) {
  const client = await getClient();
  const tokenSet = await client.callback(process.env.LINKEDIN_REDIRECT_URI, params, {
    state: expected.state,
    nonce: expected.nonce,
    code_verifier: expected.codeVerifier,
  });
  const claims = tokenSet.claims();
  const userinfo = await client.userinfo(tokenSet.access_token);
  if (!claims.sub || userinfo.sub !== claims.sub) throw new Error('LinkedIn subject mismatch');
  return {
    subject: claims.sub,
    email: String(userinfo.email || claims.email || '').trim().toLowerCase(),
    emailVerified: (userinfo.email_verified ?? claims.email_verified) === true,
    givenName: userinfo.given_name || claims.given_name || '',
    familyName: userinfo.family_name || claims.family_name || '',
    picture: userinfo.picture || claims.picture || null,
  };
}

function resetForTests() {
  clientPromise = null;
}

module.exports = { isEnabled, createAuthorization, exchangeCallback, resetForTests };
