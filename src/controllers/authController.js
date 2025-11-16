const authService = require('../services/authService');
const { User, AdminNotification } = require('../models');
const { getCurrentUserId } = require('../utils/helpers');

class AuthController {
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
      }

      const result = await authService.login(email, password);

      return res.status(200).json({
        token: result.token,
        role: result.role
      });
    } catch (error) {
      if (error.message === 'Invalid email or password') {
        return res.status(401).json({ message: error.message });
      }
      if (error.requiresEmailVerification) {
        return res.status(403).json({
          message: error.message,
          requiresEmailVerification: true,
          email: error.email
        });
      }
      if (error.requiresLoginOTP) {
        return res.status(403).json({
          message: error.message,
          requiresLoginOTP: true,
          email: error.email
        });
      }
      if (error.message.includes('inactive')) {
        return res.status(403).json({ message: 'Su cuenta está inactiva. Contacte al administrador.' });
      }
      if (error.isPending) {
        return res.status(403).json({
          message: error.message,
          isPending: true,
          companyName: error.companyName
        });
      }
      if (error.message.includes('rejected')) {
        return res.status(403).json({ message: error.message });
      }
      console.error('Login error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async register(req, res) {
    try {
      const { email, tempPassword, rfc, whatsappNumber } = req.body;

      if (!email || !tempPassword) {
        return res.status(400).json({ message: 'Email and password are required' });
      }

      // Validate RFC if provided
      if (rfc) {
        const rfcPattern = /^[A-Z]{4}[0-9]{6}[A-Z0-9]{3}$/;
        if (!rfcPattern.test(rfc)) {
          return res.status(400).json({
            message: 'RFC inválido. Formato: 4 letras, 6 números, 3 alfanuméricos (Ej: AAAA123456ABC)'
          });
        }
      }

      // Create Client user with email NOT verified (2FA)
      const user = await authService.registerUserWith2FA(email, tempPassword, User.ROLES.CLIENT, rfc, whatsappNumber);

      if (!user) {
        return res.status(400).json({ message: 'Email already exists' });
      }

      console.log(`[AuthController] ✅ Client registered (pending email verification): ${email}`);
      console.log(`[AuthController] 📧 OTP sent to ${email}`);

      // NOTE: Admin notification will be created AFTER email verification (in verifyOTP)

      return res.status(200).json({
        userId: 0, // Not created in DB yet
        email: user.email,
        role: User.getRoleName(user.role),
        message: 'Registration successful. Please check your email for the verification code.',
        requiresEmailVerification: true,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Register error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async verifyOTP(req, res) {
    try {
      const { email, otpCode } = req.body;

      console.log(`[AuthController] 🔐 Received OTP verification request:`, { email, otpCode, bodyKeys: Object.keys(req.body) });

      if (!email || !otpCode) {
        console.log(`[AuthController] ❌ Missing email or otpCode. email: ${!!email}, otpCode: ${!!otpCode}`);
        return res.status(400).json({ message: 'Email and OTP code are required' });
      }

      // Trim whitespace
      const trimmedEmail = email.trim();
      const trimmedOTP = otpCode.trim();

      console.log(`[AuthController] 🔐 Verifying OTP for ${trimmedEmail} with code: ${trimmedOTP}`);

      const result = await authService.verifyEmailOTP(trimmedEmail, trimmedOTP);

      if (!result.success) {
        console.log(`[AuthController] ❌ OTP verification failed: ${result.message}`);
        return res.status(400).json({ message: result.message });
      }

      console.log(`[AuthController] ✅ Email verified successfully for ${email}`);

      return res.status(200).json({
        success: true,
        message: result.message,
        email: email,
        token: result.token || undefined,
        role: result.role || undefined
      });
    } catch (error) {
      console.error('Verify OTP error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async resendOTP(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: 'Email is required' });
      }

      console.log(`[AuthController] 📧 Resending OTP to ${email}...`);

      const result = await authService.resendOTP(email);

      if (!result.success) {
        console.log(`[AuthController] ❌ Resend OTP failed: ${result.message}`);
        return res.status(400).json({ message: result.message });
      }

      console.log(`[AuthController] ✅ OTP resent successfully to ${email}`);

      return res.status(200).json({
        success: true,
        message: 'A new verification code has been sent to your email.'
      });
    } catch (error) {
      console.error('Resend OTP error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async verifyLoginOTP(req, res) {
    try {
      const { email, otpCode } = req.body;

      console.log(`[AuthController] 🔐 Received login OTP verification request:`, { email, otpCode });

      if (!email || !otpCode) {
        console.log(`[AuthController] ❌ Missing email or otpCode. email: ${!!email}, otpCode: ${!!otpCode}`);
        return res.status(400).json({ message: 'Email and OTP code are required' });
      }

      // Trim whitespace
      const trimmedEmail = email.trim();
      const trimmedOTP = otpCode.trim();

      console.log(`[AuthController] 🔐 Verifying login OTP for ${trimmedEmail} with code: ${trimmedOTP}`);

      const result = await authService.verifyLoginOTP(trimmedEmail, trimmedOTP);

      if (!result.success) {
        console.log(`[AuthController] ❌ Login OTP verification failed: ${result.message}`);
        return res.status(400).json({ message: result.message });
      }

      console.log(`[AuthController] ✅ Login OTP verified successfully for ${email}`);

      return res.status(200).json({
        success: true,
        token: result.token,
        role: result.role,
        user: result.user
      });
    } catch (error) {
      console.error('Verify login OTP error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async getCurrentUser(req, res) {
    try {
      const userId = getCurrentUserId(req);
      const user = await authService.getUserById(userId);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      return res.status(200).json({
        id: user.id,
        email: user.email,
        role: User.getRoleName(user.role),
        createdAt: user.createdAt
      });
    } catch (error) {
      console.error('Get current user error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }
}

module.exports = new AuthController();

