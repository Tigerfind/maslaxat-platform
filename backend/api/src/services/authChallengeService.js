const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const logger = require('../config/logger');
const { reportCaughtException } = require('../instrument');
const { AuthChallenge, User, sequelize } = require('../models');
const twoFactor = require('./twoFactorService');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPruneAttemptAt = 0;

class AuthChallengeError extends Error {
  constructor(message, status = 401, code = 'INVALID_AUTH_CHALLENGE') {
    super(message);
    this.name = 'AuthChallengeError';
    this.status = status;
    this.code = code;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function passwordStateFor(user) {
  return String(user && user.passwordChangedAt
    ? new Date(user.passwordChangedAt).getTime()
    : 0);
}

function hashAuthSource(provider, assertion) {
  let normalized;
  if (typeof assertion === 'string') {
    normalized = assertion.trim();
  } else {
    normalized = Object.keys(assertion || {})
      .sort()
      .map((key) => `${key}=${String(assertion[key])}`)
      .join('\n');
  }
  return sha256(`${provider}\n${normalized}`);
}

function sourceNonce(userId, sourceHash, twoFactorVersion) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(`auth-challenge\n${userId}\n${sourceHash}\n${twoFactorVersion}`)
    .digest('base64url');
}

function signChallenge(user, challenge, nonce) {
  return jwt.sign({
    id: user.id,
    twofa: 'pending',
    nonce,
    twoFactorVersion: user.twoFactorVersion,
    passwordState: challenge.passwordState,
    iat: Math.floor(new Date(challenge.createdAt).getTime() / 1000),
    exp: Math.floor(new Date(challenge.expiresAt).getTime() / 1000),
  }, process.env.JWT_SECRET);
}

async function pruneAuthChallenges(now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  return AuthChallenge.destroy({
    where: {
      [Op.or]: [
        { expiresAt: { [Op.lt]: cutoff } },
        { consumedAt: { [Op.lt]: cutoff } },
      ],
    },
  });
}

async function maybePruneAuthChallenges() {
  const now = Date.now();
  if (now - lastPruneAttemptAt < PRUNE_INTERVAL_MS) return;
  lastPruneAttemptAt = now;
  try {
    await pruneAuthChallenges(new Date(now));
  } catch (error) {
    reportCaughtException(error, { operation: 'auth_challenge_cleanup' });
    logger.warn('auth_challenge_cleanup_failed');
  }
}

async function issueChallenge(userId, { sourceHash = null } = {}) {
  await maybePruneAuthChallenges();
  return sequelize.transaction(async (transaction) => {
    const user = await User.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!user || !user.isActive || !user.twoFactorEnabled) {
      throw new AuthChallengeError('Недействительная сессия входа');
    }

    const nonce = sourceHash
      ? sourceNonce(user.id, sourceHash, user.twoFactorVersion)
      : crypto.randomBytes(32).toString('base64url');
    const nonceHash = sha256(nonce);
    const passwordState = passwordStateFor(user);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    let challenge;

    if (sourceHash) {
      [challenge] = await AuthChallenge.findOrCreate({
        where: { sourceHash },
        defaults: {
          userId: user.id,
          nonceHash,
          sourceHash,
          factorVersion: user.twoFactorVersion,
          passwordState,
          expiresAt,
        },
        transaction,
      });
      if (
        challenge.userId !== user.id
        || challenge.nonceHash !== nonceHash
        || challenge.factorVersion !== user.twoFactorVersion
        || challenge.passwordState !== passwordState
        || challenge.consumedAt
        || new Date(challenge.expiresAt) <= new Date()
      ) {
        throw new AuthChallengeError('Утверждение входа уже использовано', 401, 'AUTH_ASSERTION_REPLAY');
      }
    } else {
      challenge = await AuthChallenge.create({
        userId: user.id,
        nonceHash,
        factorVersion: user.twoFactorVersion,
        passwordState,
        expiresAt,
      }, { transaction });
    }

    return signChallenge(user, challenge, nonce);
  });
}

async function consumePrimarySource(userId, sourceHash) {
  await maybePruneAuthChallenges();
  return sequelize.transaction(async (transaction) => {
    const user = await User.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!user || !user.isActive) {
      throw new AuthChallengeError('Недействительная сессия входа');
    }
    const existing = await AuthChallenge.findOne({ where: { sourceHash }, transaction });
    if (existing) {
      throw new AuthChallengeError('Утверждение входа уже использовано', 401, 'AUTH_ASSERTION_REPLAY');
    }

    const nonce = sourceNonce(user.id, sourceHash, user.twoFactorVersion);
    await AuthChallenge.create({
      userId: user.id,
      nonceHash: sha256(nonce),
      sourceHash,
      factorVersion: user.twoFactorVersion,
      passwordState: passwordStateFor(user),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      consumedAt: new Date(),
    }, { transaction });
  });
}

function verifyChallengeToken(tempToken) {
  try {
    const payload = jwt.verify(tempToken, process.env.JWT_SECRET);
    if (
      payload.twofa !== 'pending'
      || !payload.nonce
      || !Number.isInteger(payload.twoFactorVersion)
      || typeof payload.passwordState !== 'string'
    ) {
      throw new Error('invalid challenge claims');
    }
    return payload;
  } catch (_) {
    throw new AuthChallengeError('Сессия входа истекла, войдите заново');
  }
}

async function exchangeChallenge(tempToken, code) {
  const payload = verifyChallengeToken(tempToken);
  const nonceHash = sha256(payload.nonce);

  return sequelize.transaction(async (transaction) => {
    const user = await User.findByPk(payload.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const challenge = await AuthChallenge.findOne({
      where: { userId: payload.id, nonceHash },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const now = new Date();
    if (
      !user
      || !user.isActive
      || !user.twoFactorEnabled
      || user.twoFactorVersion !== payload.twoFactorVersion
      || passwordStateFor(user) !== payload.passwordState
      || !challenge
      || challenge.factorVersion !== payload.twoFactorVersion
      || challenge.passwordState !== payload.passwordState
      || challenge.consumedAt
      || new Date(challenge.expiresAt) <= now
    ) {
      throw new AuthChallengeError('Недействительная сессия входа');
    }
    const okTotp = twoFactor.verifyToken(user.twoFactorSecret, code);
    const remaining = twoFactor.consumeBackupCode(user.twoFactorBackupCodes, code);
    if (!okTotp && !remaining) {
      throw new AuthChallengeError('Неверный код', 400, 'INVALID_TWO_FACTOR_CODE');
    }
    if (!okTotp) {
      user.twoFactorBackupCodes = remaining;
      await user.save({ transaction });
    }

    challenge.consumedAt = now;
    await challenge.save({ transaction });
    return user;
  });
}

module.exports = {
  AuthChallengeError,
  consumePrimarySource,
  exchangeChallenge,
  hashAuthSource,
  issueChallenge,
  passwordStateFor,
  pruneAuthChallenges,
};
