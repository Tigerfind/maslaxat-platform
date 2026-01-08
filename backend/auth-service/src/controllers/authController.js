const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../config/database');
const { getRedisClient } = require('../config/redis');
const { sendEmail } = require('../services/emailService');
const { generateTokens, verifyRefreshToken } = require('../utils/tokenUtils');
const { validateRegistration, validateLogin, validatePasswordReset } = require('../validators/authValidators');

class AuthController {
  async register(req, res, next) {
    try {
      const { error } = validateRegistration(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.details.map(d => d.message)
        });
      }

      const { email, phone, password, firstName, lastName, patronymic, role = 'client' } = req.body;
      const db = getDatabase();

      // Check if user already exists
      const existingUser = await db.query(
        'SELECT id FROM users WHERE email = $1 OR phone = $2',
        [email, phone]
      );

      if (existingUser.rows.length > 0) {
        return res.status(409).json({
          error: 'User already exists with this email or phone number'
        });
      }

      // Hash password
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Create user
      const userResult = await db.query(
        `INSERT INTO users (email, phone, password_hash, first_name, last_name, patronymic, role)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, email, first_name, last_name, role, status, created_at`,
        [email, phone, passwordHash, firstName, lastName, patronymic, role]
      );

      const user = userResult.rows[0];

      // Generate email verification token
      const verificationToken = jwt.sign(
        { userId: user.id, type: 'email_verification' },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      // Store verification token in Redis
      const redis = getRedisClient();
      await redis.setEx(`email_verification:${user.id}`, 24 * 60 * 60, verificationToken);

      // Send verification email
      await sendEmail(user.email, 'emailVerification', {
        firstName: user.first_name,
        verificationToken
      });

      // Generate tokens
      const tokens = await generateTokens(user);

      res.status(201).json({
        message: 'User registered successfully. Please check your email for verification.',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          status: user.status
        },
        tokens
      });
    } catch (error) {
      next(error);
    }
  }

  async login(req, res, next) {
    try {
      const { error } = validateLogin(req.body);
      if (error) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.details.map(d => d.message)
        });
      }

      const { email, password, rememberMe = false } = req.body;
      const db = getDatabase();

      // Find user by email
      const userResult = await db.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({
          error: 'Invalid email or password'
        });
      }

      const user = userResult.rows[0];

      // Check if user is active
      if (user.status !== 'active') {
        return res.status(403).json({
          error: 'Account is not active. Please contact support.'
        });
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        return res.status(401).json({
          error: 'Invalid email or password'
        });
      }

      // Check if 2FA is enabled
      if (user.two_factor_enabled) {
        return res.json({
          requireTwoFactor: true,
          userId: user.id,
          message: 'Please provide your 2FA code'
        });
      }

      // Update last login
      await db.query(
        'UPDATE users SET last_login = NOW() WHERE id = $1',
        [user.id]
      );

      // Generate tokens
      const tokens = await generateTokens(user, rememberMe);

      res.json({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          emailVerified: user.email_verified,
          twoFactorEnabled: user.two_factor_enabled
        },
        tokens
      });
    } catch (error) {
      next(error);
    }
  }

  async verifyTwoFactor(req, res, next) {
    try {
      const { userId, token } = req.body;
      const db = getDatabase();

      // Get user
      const userResult = await db.query(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      const user = userResult.rows[0];

      // Verify 2FA token
      const verified = speakeasy.totp.verify({
        secret: user.two_factor_secret,
        encoding: 'base32',
        token: token,
        window: 2
      });

      if (!verified) {
        return res.status(401).json({
          error: 'Invalid 2FA code'
        });
      }

      // Update last login
      await db.query(
        'UPDATE users SET last_login = NOW() WHERE id = $1',
        [user.id]
      );

      // Generate tokens
      const tokens = await generateTokens(user);

      res.json({
        message: 'Two-factor authentication successful',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          emailVerified: user.email_verified,
          twoFactorEnabled: user.two_factor_enabled
        },
        tokens
      });
    } catch (error) {
      next(error);
    }
  }

  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(401).json({
          error: 'Refresh token is required'
        });
      }

      const result = await verifyRefreshToken(refreshToken);
      
      if (!result.valid) {
        return res.status(401).json({
          error: result.error || 'Invalid refresh token'
        });
      }

      const tokens = await generateTokens(result.user);

      res.json({
        message: 'Token refreshed successfully',
        tokens
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;
      const userId = req.user.id;

      // Remove refresh token from Redis
      if (refreshToken) {
        const redis = getRedisClient();
        await redis.del(`refresh_token:${refreshToken}`);
      }

      // Clear any user-specific cache
      const redis = getRedisClient();
      await redis.del(`user_session:${userId}`);

      res.json({
        message: 'Logged out successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  async verifyEmail(req, res, next) {
    try {
      const { token } = req.query;
      
      if (!token) {
        return res.status(400).json({
          error: 'Verification token is required'
        });
      }

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      if (decoded.type !== 'email_verification') {
        return res.status(400).json({
          error: 'Invalid verification token'
        });
      }

      const db = getDatabase();
      
      // Update user email verification status
      const result = await db.query(
        'UPDATE users SET email_verified = true WHERE id = $1 RETURNING id, email, first_name, last_name',
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      // Remove verification token from Redis
      const redis = getRedisClient();
      await redis.del(`email_verification:${decoded.userId}`);

      res.json({
        message: 'Email verified successfully',
        user: result.rows[0]
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(400).json({
          error: 'Verification token has expired'
        });
      }
      next(error);
    }
  }

  async resendVerificationEmail(req, res, next) {
    try {
      const { email } = req.body;
      const db = getDatabase();

      // Find user
      const userResult = await db.query(
        'SELECT id, email, first_name, email_verified FROM users WHERE email = $1',
        [email]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      const user = userResult.rows[0];

      if (user.email_verified) {
        return res.status(400).json({
          error: 'Email is already verified'
        });
      }

      // Generate new verification token
      const verificationToken = jwt.sign(
        { userId: user.id, type: 'email_verification' },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      // Store verification token in Redis
      const redis = getRedisClient();
      await redis.setEx(`email_verification:${user.id}`, 24 * 60 * 60, verificationToken);

      // Send verification email
      await sendEmail(user.email, 'emailVerification', {
        firstName: user.first_name,
        verificationToken
      });

      res.json({
        message: 'Verification email sent successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      const db = getDatabase();

      // Find user
      const userResult = await db.query(
        'SELECT id, email, first_name FROM users WHERE email = $1 AND status = $2',
        [email, 'active']
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          error: 'User not found or account is not active'
        });
      }

      const user = userResult.rows[0];

      // Generate password reset token
      const resetToken = jwt.sign(
        { userId: user.id, type: 'password_reset' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      // Store reset token in Redis
      const redis = getRedisClient();
      await redis.setEx(`password_reset:${user.id}`, 60 * 60, resetToken);

      // Send password reset email
      await sendEmail(user.email, 'passwordReset', {
        firstName: user.first_name,
        resetToken
      });

      res.json({
        message: 'Password reset email sent successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body;
      
      if (!token || !newPassword) {
        return res.status(400).json({
          error: 'Token and new password are required'
        });
      }

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      if (decoded.type !== 'password_reset') {
        return res.status(400).json({
          error: 'Invalid reset token'
        });
      }

      const db = getDatabase();
      const redis = getRedisClient();

      // Check if token exists in Redis
      const storedToken = await redis.get(`password_reset:${decoded.userId}`);
      if (!storedToken || storedToken !== token) {
        return res.status(400).json({
          error: 'Invalid or expired reset token'
        });
      }

      // Hash new password
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      const passwordHash = await bcrypt.hash(newPassword, saltRounds);

      // Update user password
      await db.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [passwordHash, decoded.userId]
      );

      // Remove reset token from Redis
      await redis.del(`password_reset:${decoded.userId}`);

      res.json({
        message: 'Password reset successfully'
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(400).json({
          error: 'Reset token has expired'
        });
      }
      next(error);
    }
  }

  async setupTwoFactor(req, res, next) {
    try {
      const userId = req.user.id;
      const db = getDatabase();

      // Generate secret
      const secret = speakeasy.generateSecret({
        name: `MaslaXat (${req.user.email})`,
        length: 32
      });

      // Generate QR code
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

      // Temporarily store secret (not saved until verified)
      const redis = getRedisClient();
      await redis.setEx(`2fa_setup:${userId}`, 10 * 60, secret.base32);

      res.json({
        secret: secret.base32,
        qrCode: qrCodeUrl,
        message: 'Please scan this QR code with your authenticator app'
      });
    } catch (error) {
      next(error);
    }
  }

  async verifyTwoFactorSetup(req, res, next) {
    try {
      const userId = req.user.id;
      const { token } = req.body;
      
      const redis = getRedisClient();
      const db = getDatabase();

      // Get temporary secret
      const secret = await redis.get(`2fa_setup:${userId}`);
      if (!secret) {
        return res.status(400).json({
          error: 'Two-factor setup session expired'
        });
      }

      // Verify token
      const verified = speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: token,
        window: 2
      });

      if (!verified) {
        return res.status(401).json({
          error: 'Invalid verification code'
        });
      }

      // Save 2FA secret to database
      await db.query(
        'UPDATE users SET two_factor_enabled = true, two_factor_secret = $1 WHERE id = $2',
        [secret, userId]
      );

      // Remove temporary secret
      await redis.del(`2fa_setup:${userId}`);

      res.json({
        message: 'Two-factor authentication enabled successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  async disableTwoFactor(req, res, next) {
    try {
      const userId = req.user.id;
      const { token } = req.body;
      const db = getDatabase();

      // Get user's 2FA secret
      const userResult = await db.query(
        'SELECT two_factor_secret FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0 || !userResult.rows[0].two_factor_secret) {
        return res.status(400).json({
          error: 'Two-factor authentication is not enabled'
        });
      }

      // Verify token
      const verified = speakeasy.totp.verify({
        secret: userResult.rows[0].two_factor_secret,
        encoding: 'base32',
        token: token,
        window: 2
      });

      if (!verified) {
        return res.status(401).json({
          error: 'Invalid 2FA code'
        });
      }

      // Disable 2FA
      await db.query(
        'UPDATE users SET two_factor_enabled = false, two_factor_secret = NULL WHERE id = $1',
        [userId]
      );

      res.json({
        message: 'Two-factor authentication disabled successfully'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();