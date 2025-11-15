const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Company } = require('../models');
const otpService = require('./otpService');
const emailService = require('./emailService');

class AuthService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET_KEY || 'YourSuperSecretKeyThatIsAtLeast32CharactersLong!';
    this.jwtIssuer = process.env.JWT_ISSUER || 'PdfPortal';
    this.jwtAudience = process.env.JWT_AUDIENCE || 'PdfPortalUsers';
    this.jwtExpiryMinutes = process.env.JWT_EXPIRY_MINUTES || 60;
  }

  async hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
  }

  async verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }

  generateToken(userId, email, role) {
    const payload = {
      userId: userId.toString(),
      email: email,
      role: role
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: `${this.jwtExpiryMinutes}m`,
      issuer: this.jwtIssuer,
      audience: this.jwtAudience
    });
  }

  async validateUser(email, password) {
    // First check if user exists in users table
    const user = await User.findOne({ where: { email } });
    
    if (!user) {
      // Check if this email belongs to a pending/rejected company
      const company = await Company.findOne({ where: { email } });
      
      if (company) {
        // Verify password against company's stored hash
        const isValidPassword = await this.verifyPassword(password, company.passwordHash);
        
        if (!isValidPassword) {
          return null; // Invalid password
        }
        
        // Valid password, but check company status
        if (company.status === Company.STATUS.PENDING) {
          const error = new Error('Company account is pending approval. Please wait for admin approval.');
          error.isPending = true;
          error.companyName = company.name;
          throw error;
        }
        
        if (company.status === Company.STATUS.REJECTED) {
          throw new Error('Company account has been rejected. Please contact administrator.');
        }
        
        // If approved but no user account (shouldn't happen), return null
        return null;
      }
      
      // Not a user, not a company
      return null;
    }

    // Check if email is verified (2FA) - REQUIRED FOR ALL USERS
    if (!user.isEmailVerified) {
      // Generate and send OTP if user doesn't have one or it's expired
      const otpService = require('./otpService');
      const emailService = require('./emailService');

      const needsNewOTP = !user.otpCode || !user.otpExpiry || otpService.isOTPExpired(user.otpExpiry);

      if (needsNewOTP) {
        // Generate new OTP
        const otpCode = otpService.generateOTP();
        const otpExpiry = otpService.getOTPExpiry();

        // Update user with new OTP
        await user.update({
          otpCode,
          otpExpiry,
          otpAttempts: 0
        });

        console.log(`[AuthService] 📧 Sending OTP to unverified user ${user.email}: ${otpCode}`);

        // Send OTP email
        const userType = user.role === User.ROLES.ADMIN ? 'admin' : (user.role === User.ROLES.COMPANY ? 'company' : 'client');
        await emailService.sendOTPEmail({
          toEmail: user.email,
          otpCode,
          userType
        });
      }

      const error = new Error('Email not verified. Please check your email for the verification code.');
      error.requiresEmailVerification = true;
      error.email = user.email;
      throw error;
    }

    // Check if user is active
    if (!user.isActive) {
      throw new Error('User account is inactive. Please contact administrator.');
    }

    // Check if user is a company and if company is pending
    if (user.role === User.ROLES.COMPANY) {
      const company = await Company.findOne({ where: { userId: user.id } });
      if (company && company.status === Company.STATUS.PENDING) {
        const error = new Error('Company account is pending approval. Please wait for admin approval.');
        error.isPending = true;
        error.companyName = company.name;
        throw error;
      }
      if (company && company.status === Company.STATUS.REJECTED) {
        throw new Error('Company account has been rejected. Please contact administrator.');
      }
    }

    const isValid = await this.verifyPassword(password, user.passwordHash);
    return isValid ? user : null;
  }

  async registerUser(email, password, role = User.ROLES.CLIENT, rfc = null, whatsappNumber = null) {
    // Check if user exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return null;
    }

    const passwordHash = await this.hashPassword(password);

    const user = await User.create({
      email,
      passwordHash,
      role,
      rfc,
      whatsappNumber,
      isActive: true
    });

    return user;
  }

  async login(email, password) {
    const user = await this.validateUser(email, password);

    if (!user) {
      throw new Error('Invalid email or password');
    }

    // ✅ GENERATE OTP FOR ADMIN AND COMPANY LOGIN (2FA)
    // Clients only verify email once during registration, no OTP on login
    if (user.role === User.ROLES.ADMIN || user.role === User.ROLES.COMPANY) {
      const otpService = require('./otpService');
      const emailService = require('./emailService');

      const otpCode = otpService.generateOTP();
      const otpExpiry = otpService.getOTPExpiry();

      // Save OTP to user
      await user.update({
        otpCode,
        otpExpiry,
        otpAttempts: 0
      });

      console.log(`[AuthService] 🔐 Login OTP generated for ${user.email}: ${otpCode}`);

      // Send OTP email
      const userType = user.role === User.ROLES.ADMIN ? 'admin' : 'company';
      const emailResult = await emailService.sendOTPEmail({
        toEmail: user.email,
        otpCode,
        userType
      });

      if (!emailResult.success) {
        console.error(`[AuthService] ⚠️ Failed to send login OTP email to ${user.email}:`, emailResult.error);
      }

      // Don't return token yet - user must verify OTP first
      const error = new Error('Login OTP sent to your email. Please verify to continue.');
      error.requiresLoginOTP = true;
      error.email = user.email;
      throw error;
    }

    // For CLIENTS: Email is verified during registration, no OTP on login
    console.log(`[AuthService] ✅ Client login successful: ${user.email}`);

    const roleName = User.getRoleName(user.role);
    const token = this.generateToken(user.id, user.email, roleName);

    return {
      token,
      role: roleName
    };
  }

  /**
   * Verify login OTP and return JWT token
   */
  async verifyLoginOTP(email, inputOTP) {
    console.log(`[AuthService] verifyLoginOTP called with email: ${email}, inputOTP: ${inputOTP}`);

    // Find user by email
    const user = await User.findOne({ where: { email } });

    if (!user) {
      console.log(`[AuthService] ❌ User not found: ${email}`);
      return { success: false, message: 'User not found' };
    }

    const now = new Date();
    console.log(`[AuthService] User found. otpCode: ${user.otpCode}, otpExpiry: ${user.otpExpiry}, otpAttempts: ${user.otpAttempts}`);
    console.log(`[AuthService] Current time: ${now.toISOString()}, OTP expiry time: ${user.otpExpiry ? new Date(user.otpExpiry).toISOString() : 'null'}`);

    // Check for too many failed attempts
    const otpService = require('./otpService');
    if (otpService.isLockedOut(user.otpAttempts)) {
      console.log(`[AuthService] ❌ Too many failed attempts: ${user.otpAttempts}`);
      return {
        success: false,
        message: 'Too many failed attempts. Please login again to receive a new code.'
      };
    }

    // Verify OTP
    console.log(`[AuthService] Verifying OTP. Input: "${inputOTP}", Stored: "${user.otpCode}"`);
    const verification = otpService.verifyOTP(inputOTP, user.otpCode, user.otpExpiry);
    console.log(`[AuthService] Verification result:`, verification);

    if (!verification.valid) {
      // Increment failed attempts
      console.log(`[AuthService] ❌ OTP verification failed: ${verification.reason}`);
      await user.update({ otpAttempts: user.otpAttempts + 1 });
      return { success: false, message: verification.reason };
    }

    // Clear OTP after successful verification
    await user.update({
      otpCode: null,
      otpExpiry: null,
      otpAttempts: 0
    });

    console.log(`[AuthService] ✅ Login OTP verified successfully: ${email}`);

    // Generate and return JWT token
    const roleName = User.getRoleName(user.role);
    const token = this.generateToken(user.id, user.email, roleName);

    return {
      success: true,
      token,
      role: roleName,
      user: {
        id: user.id,
        email: user.email,
        role: roleName,
        rfc: user.rfc
      }
    };
  }

  async getUserById(userId) {
    return await User.findByPk(userId);
  }

  /**
   * Register user with 2FA (Email OTP verification)
   * User account is created but NOT active until email is verified
   */
  async registerUserWith2FA(email, password, role = User.ROLES.CLIENT, rfc = null, whatsappNumber = null) {
    // Check if user exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return null;
    }

    const passwordHash = await this.hashPassword(password);

    // Generate OTP
    const otpCode = otpService.generateOTP();
    const otpExpiry = otpService.getOTPExpiry();

    // Create user with email NOT verified
    const user = await User.create({
      email,
      passwordHash,
      role,
      rfc,
      whatsappNumber,
      isActive: false, // Account not active until email verified
      isEmailVerified: false,
      otpCode,
      otpExpiry,
      otpAttempts: 0
    });

    console.log(`[AuthService] 👤 User created (pending verification): ${email}, OTP: ${otpCode}`);

    // Send OTP email
    const userType = role === User.ROLES.ADMIN ? 'admin' : (role === User.ROLES.COMPANY ? 'company' : 'client');
    const emailResult = await emailService.sendOTPEmail({
      toEmail: email,
      otpCode,
      userType
    });

    if (!emailResult.success) {
      console.error(`[AuthService] ⚠️ Failed to send OTP email to ${email}:`, emailResult.error);
    }

    return user;
  }

  /**
   * Verify email OTP and activate user account
   */
  async verifyEmailOTP(email, inputOTP) {
    console.log(`[AuthService] verifyEmailOTP called with email: ${email}, inputOTP: ${inputOTP}`);

    // Find user by email
    const user = await User.findOne({ where: { email } });

    if (!user) {
      console.log(`[AuthService] ❌ User not found: ${email}`);
      return { success: false, message: 'User not found' };
    }

    console.log(`[AuthService] User found. isEmailVerified: ${user.isEmailVerified}, otpCode: ${user.otpCode}, otpExpiry: ${user.otpExpiry}, otpAttempts: ${user.otpAttempts}`);

    // Check if already verified
    if (user.isEmailVerified) {
      console.log(`[AuthService] ❌ Email already verified`);
      return { success: false, message: 'Email already verified' };
    }

    // Check for too many failed attempts
    if (otpService.isLockedOut(user.otpAttempts)) {
      console.log(`[AuthService] ❌ Too many failed attempts: ${user.otpAttempts}`);
      return {
        success: false,
        message: 'Too many failed attempts. Please request a new verification code.'
      };
    }

    // Verify OTP
    console.log(`[AuthService] Verifying OTP. Input: "${inputOTP}", Stored: "${user.otpCode}"`);
    const verification = otpService.verifyOTP(inputOTP, user.otpCode, user.otpExpiry);
    console.log(`[AuthService] Verification result:`, verification);

    if (!verification.valid) {
      // Increment failed attempts
      console.log(`[AuthService] ❌ OTP verification failed: ${verification.reason}`);
      await user.update({ otpAttempts: user.otpAttempts + 1 });
      return { success: false, message: verification.reason };
    }

    // Mark email as verified and activate account
    await user.update({
      isEmailVerified: true,
      isActive: true,
      otpCode: null,
      otpExpiry: null,
      otpAttempts: 0
    });

    console.log(`[AuthService] ✅ Email verified and account activated: ${email}`);

    return { success: true, message: 'Email verified successfully' };
  }

  /**
   * Resend OTP to user's email
   */
  async resendOTP(email) {
    // Find user by email
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    // Check if already verified
    if (user.isEmailVerified) {
      return { success: false, message: 'Email already verified' };
    }

    // Generate new OTP
    const otpCode = otpService.generateOTP();
    const otpExpiry = otpService.getOTPExpiry();

    // Update user with new OTP and reset attempts
    await user.update({
      otpCode,
      otpExpiry,
      otpAttempts: 0
    });

    console.log(`[AuthService] 🔄 New OTP generated for ${email}: ${otpCode}`);

    // Send OTP email
    const userType = user.role === User.ROLES.ADMIN ? 'admin' : (user.role === User.ROLES.COMPANY ? 'company' : 'client');
    const emailResult = await emailService.sendOTPEmail({
      toEmail: email,
      otpCode,
      userType
    });

    if (!emailResult.success) {
      console.error(`[AuthService] ⚠️ Failed to send OTP email to ${email}:`, emailResult.error);
      return { success: false, message: 'Failed to send verification email' };
    }

    return { success: true, message: 'New verification code sent to your email' };
  }
}

module.exports = new AuthService();

