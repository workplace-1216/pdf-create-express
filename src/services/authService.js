const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Company } = require('../models');

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

    const roleName = User.getRoleName(user.role);
    const token = this.generateToken(user.id, user.email, roleName);

    return {
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
}

module.exports = new AuthService();

