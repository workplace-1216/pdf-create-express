const { Company, User, DocumentProcessed, DocumentOriginal, ClientCompany, AdminNotification } = require('../models');
const authService = require('../services/authService');
const bcrypt = require('bcryptjs');
const { getCurrentUserId, getCurrentUserRole } = require('../utils/helpers');
const { Op } = require('sequelize');
const otpService = require('../services/otpService');
const emailService = require('../services/emailService');

class CompanyController {
  constructor() {
    // Store pending company registrations (not yet in database)
    // Map: email -> { name, rfc, email, whatsappNumber, passwordHash, otpCode, otpExpiry, otpAttempts }
    this.pendingCompanies = new Map();
    console.log('[CompanyController] Constructor called, pendingCompanies initialized');

    // Bind methods to preserve 'this' context when called by Express routes
    this.registerCompany = this.registerCompany.bind(this);
    this.verifyCompanyOTP = this.verifyCompanyOTP.bind(this);
    this.resendCompanyOTP = this.resendCompanyOTP.bind(this);
    this.getApprovedCompanies = this.getApprovedCompanies.bind(this);
    this.getClientCompanies = this.getClientCompanies.bind(this);
    this.addCompanyToClient = this.addCompanyToClient.bind(this);
    this.removeCompanyFromClient = this.removeCompanyFromClient.bind(this);
    this.getReceivedDocuments = this.getReceivedDocuments.bind(this);
    this.deleteReceivedDocument = this.deleteReceivedDocument.bind(this);
    this.getAllCompanies = this.getAllCompanies.bind(this);
    this.approveCompany = this.approveCompany.bind(this);
    this.rejectCompany = this.rejectCompany.bind(this);
    this.deleteCompany = this.deleteCompany.bind(this);
    this.getCompanyUsers = this.getCompanyUsers.bind(this);
    this.createCompanyUser = this.createCompanyUser.bind(this);
    this.updateCompanyUser = this.updateCompanyUser.bind(this);
    this.deleteCompanyUser = this.deleteCompanyUser.bind(this);
  }
  // Get all companies (for client selection during registration)
  async getApprovedCompanies(req, res) {
    try {
      const companies = await Company.findAll({
        where: {
          status: Company.STATUS.APPROVED,
          isEmailVerified: true // Only show verified companies
        },
        attributes: ['id', 'name', 'rfc', 'email'],
        order: [['name', 'ASC']]
      });

      return res.status(200).json(companies);
    } catch (error) {
      console.error('Get approved companies error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Get companies for a specific client
  async getClientCompanies(req, res) {
    try {
      const userId = getCurrentUserId(req);
      
      // Use the User model with the many-to-many association
      const user = await User.findByPk(userId, {
        include: [{
          model: Company,
          as: 'companies',
          where: {
            status: Company.STATUS.APPROVED,
            isEmailVerified: true // Only show verified companies
          },
          through: { attributes: [] }, // Exclude junction table attributes
          attributes: ['id', 'name', 'rfc', 'email']
        }]
      });

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      return res.status(200).json(user.companies || []);
    } catch (error) {
      console.error('Get client companies error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Verify company email OTP
  async verifyCompanyOTP(req, res) {
    try {
      const { email, otpCode } = req.body;

      if (!email || !otpCode) {
        return res.status(400).json({ message: 'Email and OTP code are required' });
      }

      console.log(`[CompanyController] 🔐 Verifying OTP for company ${email}...`);

      // Check if this is a pending registration (not in DB yet)
      if (this.pendingCompanies.has(email)) {
        console.log(`[CompanyController] Found pending company registration for ${email}`);
        const pendingData = this.pendingCompanies.get(email);

        // Check for too many failed attempts
        if (otpService.isLockedOut(pendingData.otpAttempts)) {
          return res.status(429).json({
            message: 'Too many failed attempts. Please request a new verification code.'
          });
        }

        // Verify OTP
        const verification = otpService.verifyOTP(otpCode, pendingData.otpCode, pendingData.otpExpiry);

        if (!verification.valid) {
          // Increment failed attempts
          pendingData.otpAttempts += 1;
          this.pendingCompanies.set(email, pendingData);
          console.log(`[CompanyController] ❌ OTP verification failed: ${verification.reason}`);
          return res.status(400).json({ message: verification.reason });
        }

        // OTP is valid! Create company in database NOW
        console.log(`[CompanyController] ✅ OTP verified! Creating company in database: ${email}`);

        const company = await Company.create({
          name: pendingData.name,
          rfc: pendingData.rfc,
          email: pendingData.email,
          whatsappNumber: pendingData.whatsappNumber,
          passwordHash: pendingData.passwordHash,
          status: Company.STATUS.PENDING,
          isEmailVerified: true,
          otpCode: null,
          otpExpiry: null,
          otpAttempts: 0,
          createdAt: new Date()
        });

        // Remove from pending registrations
        this.pendingCompanies.delete(email);

        console.log(`[CompanyController] ✅ Company created in database with ID: ${company.id}`);
        console.log(`[CompanyController] Company can now wait for admin approval`);

        // NOW create admin notification (only after email is verified)
        await AdminNotification.create({
          notificationType: AdminNotification.TYPES.NEW_COMPANY,
          relatedCompanyId: company.id,
          message: `Nueva empresa registrada: ${company.name} (${company.rfc})`,
          isRead: false,
          createdAt: new Date()
        });

        console.log(`[CompanyController] 📢 Admin notification created for verified company`);

        return res.status(200).json({
          success: true,
          message: 'Email verified successfully. Your company registration is now pending admin approval.',
          companyId: company.id
        });
      }

      // Check if company exists in database (for existing companies who need to verify)
      const company = await Company.findOne({ where: { email } });

      if (!company) {
        console.log(`[CompanyController] ❌ Company not found in pending registrations or database: ${email}`);
        return res.status(404).json({ message: 'Company not found. Please register first.' });
      }

      // Check if already verified
      if (company.isEmailVerified) {
        return res.status(400).json({ message: 'Email already verified' });
      }

      // Check for too many failed attempts
      if (otpService.isLockedOut(company.otpAttempts)) {
        return res.status(429).json({
          message: 'Too many failed attempts. Please request a new verification code.'
        });
      }

      // Verify OTP
      const verification = otpService.verifyOTP(otpCode, company.otpCode, company.otpExpiry);

      if (!verification.valid) {
        // Increment failed attempts
        await company.update({ otpAttempts: company.otpAttempts + 1 });
        console.log(`[CompanyController] ❌ OTP verification failed: ${verification.reason}`);
        return res.status(400).json({ message: verification.reason });
      }

      // Mark email as verified
      await company.update({
        isEmailVerified: true,
        otpCode: null,
        otpExpiry: null,
        otpAttempts: 0
      });

      console.log(`[CompanyController] ✅ Company email verified: ${email}`);

      return res.status(200).json({
        success: true,
        message: 'Email verified successfully.',
        companyId: company.id
      });
    } catch (error) {
      console.error('Verify company OTP error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Resend company OTP
  async resendCompanyOTP(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: 'Email is required' });
      }

      console.log(`[CompanyController] 📧 Resending OTP to company ${email}...`);

      // Check if this is a pending registration
      if (this.pendingCompanies.has(email)) {
        console.log(`[CompanyController] Resending OTP for pending company: ${email}`);
        const pendingData = this.pendingCompanies.get(email);

        // Generate new OTP
        const otpCode = otpService.generateOTP();
        const otpExpiry = otpService.getOTPExpiry();

        // Update pending data
        pendingData.otpCode = otpCode;
        pendingData.otpExpiry = otpExpiry;
        pendingData.otpAttempts = 0;
        this.pendingCompanies.set(email, pendingData);

        console.log(`[CompanyController] 🔄 New OTP generated for pending company ${email}: ${otpCode}`);

        // Send OTP email
        const emailResult = await emailService.sendOTPEmail({
          toEmail: email,
          otpCode,
          userType: 'company'
        });

        if (!emailResult.success) {
          console.error(`[CompanyController] ⚠️ Failed to send OTP email to ${email}:`, emailResult.error);
          return res.status(500).json({ message: 'Failed to send verification email' });
        }

        console.log(`[CompanyController] ✅ OTP resent successfully to ${email}`);

        return res.status(200).json({
          success: true,
          message: 'A new verification code has been sent to your email.'
        });
      }

      // Find company by email in database
      const company = await Company.findOne({ where: { email } });

      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      // Check if already verified
      if (company.isEmailVerified) {
        return res.status(400).json({ message: 'Email already verified' });
      }

      // Generate new OTP
      const otpCode = otpService.generateOTP();
      const otpExpiry = otpService.getOTPExpiry();

      // Update company with new OTP and reset attempts
      await company.update({
        otpCode,
        otpExpiry,
        otpAttempts: 0
      });

      console.log(`[CompanyController] 🔄 New OTP generated for ${email}: ${otpCode}`);

      // Send OTP email
      const emailResult = await emailService.sendOTPEmail({
        toEmail: email,
        otpCode,
        userType: 'company'
      });

      if (!emailResult.success) {
        console.error(`[CompanyController] ⚠️ Failed to send OTP email to ${email}:`, emailResult.error);
        return res.status(500).json({ message: 'Failed to send verification email' });
      }

      console.log(`[CompanyController] ✅ OTP resent successfully to ${email}`);

      return res.status(200).json({
        success: true,
        message: 'A new verification code has been sent to your email.'
      });
    } catch (error) {
      console.error('Resend company OTP error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Register new company
  async registerCompany(req, res) {
    try {
      console.log('[CompanyController] registerCompany called, this:', typeof this);
      console.log('[CompanyController] this.pendingCompanies:', this.pendingCompanies);

      const { name, rfc, email, whatsappNumber, password } = req.body;

      // Validate required fields
      if (!name || !rfc || !email || !whatsappNumber || !password) {
        return res.status(400).json({ message: 'Name, RFC, email, WhatsApp number, and password are required' });
      }

      // Validate password length
      if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
      }

      // Check if company with RFC or email already exists in database
      const existing = await Company.findOne({
        where: {
          [Op.or]: [{ rfc }, { email }]
        }
      });

      if (existing) {
        return res.status(400).json({
          message: existing.rfc === rfc ? 'Company with this RFC already exists' : 'Company with this email already exists'
        });
      }

      // Check if already pending
      if (this.pendingCompanies.has(email)) {
        console.log(`[CompanyController] ⚠️ Company registration already pending for ${email}`);
        // Allow re-registration to update OTP
      }

      // Hash password for later use when approved
      const passwordHash = await bcrypt.hash(password, 10);

      // Generate OTP for email verification (2FA)
      const otpCode = otpService.generateOTP();
      const otpExpiry = otpService.getOTPExpiry();

      // Store in pending registrations (NOT in database yet)
      this.pendingCompanies.set(email, {
        name,
        rfc,
        email,
        whatsappNumber,
        passwordHash,
        otpCode,
        otpExpiry,
        otpAttempts: 0,
        createdAt: new Date()
      });

      console.log(`[CompanyController] ✅ Pending company registration stored (NOT in DB): ${name} (${rfc})`);
      console.log(`[CompanyController] 📧 OTP generated: ${otpCode}`);

      // Send OTP email
      const emailResult = await emailService.sendOTPEmail({
        toEmail: email,
        otpCode,
        userType: 'company'
      });

      if (!emailResult.success) {
        console.error(`[CompanyController] ⚠️ Failed to send OTP email to ${email}:`, emailResult.error);
      }

      // NOTE: Company will be created in database AFTER email verification (in verifyCompanyOTP)

      return res.status(201).json({
        id: 0, // Not created yet
        name: name,
        rfc: rfc,
        email: email,
        status: 'pending',
        message: 'Company registration initiated. Please check your email for the verification code.',
        requiresEmailVerification: true
      });
    } catch (error) {
      console.error('Register company error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Admin: Get all companies (with filter by status)
  async getAllCompanies(req, res) {
    try {
      const status = req.query.status || '';
      const page = parseInt(req.query.page) || 1;
      const pageSize = parseInt(req.query.pageSize) || 10;

      const where = {
        isEmailVerified: true // Only show companies that have verified their email
      };
      if (status && status !== 'All') {
        where.status = status.toLowerCase();
      }

      const { count, rows: companies } = await Company.findAndCountAll({
        where,
        include: [{
          model: User,
          as: 'user',
          attributes: ['email'],
          required: false
        }],
        limit: pageSize,
        offset: (page - 1) * pageSize,
        order: [['createdAt', 'DESC']]
      });

      const companyDtos = companies.map(company => ({
        id: company.id.toString(),
        name: company.name,
        rfc: company.rfc,
        email: company.email,
        whatsappNumber: company.whatsappNumber,
        status: company.status,
        hasUserAccount: !!company.userId,
        userEmail: company.user?.email || null,
        createdAt: company.createdAt ? company.createdAt.toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
      }));

      return res.status(200).json({
        items: companyDtos,
        totalCount: count,
        page,
        pageSize,
        totalPages: Math.ceil(count / pageSize)
      });
    } catch (error) {
      console.error('Get all companies error:', error);
      console.error('Error stack:', error.stack);
      
      // If table doesn't exist or other database error, return empty result
      if (error.name === 'SequelizeDatabaseError' || error.message.includes('relation') || error.message.includes('does not exist')) {
        console.warn('⚠️ Companies table may not exist yet. Run: npm run migrate:companies');
        return res.status(200).json({
          items: [],
          totalCount: 0,
          page,
          pageSize,
          totalPages: 0
        });
      }
      
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Admin: Approve company
  async approveCompany(req, res) {
    try {
      const companyId = parseInt(req.params.id);
      const adminId = getCurrentUserId(req);
      const { createUserAccount } = req.body; // Whether to create login credentials

      const company = await Company.findByPk(companyId);

      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      // Check if company has verified their email
      if (!company.isEmailVerified) {
        return res.status(400).json({
          message: 'Company must verify their email before approval. Email verification is pending.'
        });
      }

      if (company.status !== Company.STATUS.PENDING) {
        return res.status(400).json({ message: 'Company is not pending approval' });
      }

      // Create user account if requested (default to true if not specified)
      const shouldCreateAccount = createUserAccount !== false; // Default to true
      let userId = null;
      
      if (shouldCreateAccount) {
        // Use the stored password hash if available, otherwise generate temp password
        let user;
        if (company.passwordHash) {
          // Create user with the password they registered with
          console.log(`[CompanyController] Creating user with role: ${User.ROLES.COMPANY} (Company)`);
          user = await User.create({
            email: company.email,
            passwordHash: company.passwordHash,
            role: User.ROLES.COMPANY,
            rfc: company.rfc,  // ✅ Copy RFC from company to user
            whatsappNumber: company.whatsappNumber,  // ✅ Copy WhatsApp from company to user
            isActive: true,
            isEmailVerified: true, // ✅ Email already verified during company registration
            otpCode: null,
            otpExpiry: null,
            otpAttempts: 0
          });
          console.log(`[CompanyController] ✅ User created with ID: ${user.id}, Role: ${user.role}, Role Name: ${User.getRoleName(user.role)}, RFC: ${company.rfc}, WhatsApp: ${company.whatsappNumber}`);
        } else {
          // Generate temporary password
          const tempPassword = Math.random().toString(36).slice(-8);
          user = await authService.registerUser(
            company.email,
            tempPassword,
            User.ROLES.COMPANY,
            company.rfc,  // ✅ Pass RFC to authService
            company.whatsappNumber  // ✅ Pass WhatsApp to authService
          );
          console.log(`[CompanyController] ✅ User created via authService, ID: ${user.id}, RFC: ${company.rfc}, WhatsApp: ${company.whatsappNumber}`);

          // Mark email as verified (since company already verified their email)
          await user.update({
            isEmailVerified: true,
            otpCode: null,
            otpExpiry: null,
            otpAttempts: 0
          });
        }

        userId = user.id;
        console.log(`[CompanyController] ✅ User account created for company: ${company.email}, userId: ${userId}, RFC: ${company.rfc}`);
      } else {
        console.log(`[CompanyController] ⚠️ Skipping user account creation (createUserAccount=false)`);
      }

      // Update company
      company.status = Company.STATUS.APPROVED;
      company.approvedAt = new Date();
      company.approvedByAdminId = adminId;
      if (userId) {
        company.userId = userId;
      }
      await company.save();

      console.log(`[CompanyController] ✅ Company approved: ${company.name}`);

      return res.status(200).json({
        id: company.id,
        name: company.name,
        status: company.status,
        hasUserAccount: !!userId,
        message: 'Company approved successfully'
      });
    } catch (error) {
      console.error('Approve company error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Admin: Reject company
  async rejectCompany(req, res) {
    try {
      const companyId = parseInt(req.params.id);
      const { reason } = req.body;
      const company = await Company.findByPk(companyId);

      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      company.status = Company.STATUS.REJECTED;
      company.rejectionReason = reason || null;
      await company.save();

      console.log(`[CompanyController] ❌ Company rejected: ${company.name}, Reason: ${reason || 'Not specified'}`);

      return res.status(200).json({
        message: 'Company rejected',
        reason: reason
      });
    } catch (error) {
      console.error('Reject company error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Admin: Delete company
  async deleteCompany(req, res) {
    try {
      const companyId = parseInt(req.params.id);
      const company = await Company.findByPk(companyId);

      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }

      // Delete related data
      await ClientCompany.destroy({ where: { companyId } });

      // Delete user account if exists
      if (company.userId) {
        await User.destroy({ where: { id: company.userId } });
      }

      await company.destroy();

      return res.status(200).json({ message: 'Company deleted successfully' });
    } catch (error) {
      console.error('Delete company error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Client: Add company to their list
  async addCompanyToClient(req, res) {
    try {
      const userId = getCurrentUserId(req);
      const { companyId } = req.body;

      console.log('========================================');
      console.log('[AddCompanyToClient] 📥 Request received');
      console.log(`[AddCompanyToClient] User ID: ${userId}`);
      console.log(`[AddCompanyToClient] Company ID: ${companyId}`);
      console.log(`[AddCompanyToClient] Request body:`, req.body);

      // Validate companyId
      if (!companyId) {
        console.log('[AddCompanyToClient] ❌ No companyId provided in request body');
        return res.status(400).json({ message: 'Company ID is required' });
      }

      const company = await Company.findByPk(companyId);

      if (!company) {
        console.log(`[AddCompanyToClient] ❌ Company ${companyId} not found in database`);
        return res.status(404).json({ message: 'Company not found' });
      }

      console.log(`[AddCompanyToClient] ✅ Company found: ${company.name}`);
      console.log(`[AddCompanyToClient] Company status: ${company.status}`);
      console.log(`[AddCompanyToClient] Required status: ${Company.STATUS.APPROVED}`);

      if (company.status !== Company.STATUS.APPROVED) {
        console.log(`[AddCompanyToClient] ❌ Company ${companyId} not approved (status: ${company.status})`);
        return res.status(400).json({ 
          message: 'Company is not approved',
          companyStatus: company.status,
          requiredStatus: Company.STATUS.APPROVED
        });
      }

      // Check if already added
      console.log(`[AddCompanyToClient] 🔍 Checking for existing association...`);
      const existing = await ClientCompany.findOne({
        where: { clientUserId: userId, companyId }
      });

      if (existing) {
        console.log(`[AddCompanyToClient] ⚠️ Company ${companyId} already associated with user ${userId}`);
        console.log(`[AddCompanyToClient] Existing record ID: ${existing.id}`);
        return res.status(400).json({ 
          message: 'Company already added',
          existingId: existing.id
        });
      }

      console.log(`[AddCompanyToClient] ✅ No existing association found`);
      console.log(`[AddCompanyToClient] 💾 Creating new client_companies record...`);
      console.log(`[AddCompanyToClient] Data: { clientUserId: ${userId}, companyId: ${companyId} }`);

      const clientCompany = await ClientCompany.create({
        clientUserId: userId,
        companyId,
        createdAt: new Date()
      });

      console.log(`[AddCompanyToClient] ✅ SUCCESS! Record created in client_companies table`);
      console.log(`[AddCompanyToClient] Record ID: ${clientCompany.id}`);
      console.log(`[AddCompanyToClient] Client User ID: ${clientCompany.clientUserId}`);
      console.log(`[AddCompanyToClient] Company ID: ${clientCompany.companyId}`);
      console.log(`[AddCompanyToClient] Created At: ${clientCompany.createdAt}`);
      console.log('========================================');

      return res.status(200).json({ 
        message: 'Company added successfully',
        clientCompanyId: clientCompany.id,
        success: true
      });
    } catch (error) {
      console.error('========================================');
      console.error('[AddCompanyToClient] ❌ CRITICAL ERROR');
      console.error('[AddCompanyToClient] Error name:', error.name);
      console.error('[AddCompanyToClient] Error message:', error.message);
      console.error('[AddCompanyToClient] Error stack:', error.stack);
      
      if (error.name === 'SequelizeForeignKeyConstraintError') {
        console.error('[AddCompanyToClient] ❌ Foreign key constraint error');
        console.error('[AddCompanyToClient] This usually means:');
        console.error('[AddCompanyToClient]   1. The user ID or company ID does not exist');
        console.error('[AddCompanyToClient]   2. The foreign key constraints are not properly set up');
      } else if (error.name === 'SequelizeUniqueConstraintError') {
        console.error('[AddCompanyToClient] ❌ Unique constraint error');
        console.error('[AddCompanyToClient] The association already exists (race condition?)');
      } else if (error.name === 'SequelizeDatabaseError') {
        console.error('[AddCompanyToClient] ❌ Database error');
        console.error('[AddCompanyToClient] Check if client_companies table exists and has correct schema');
      }
      
      console.error('========================================');
      
      return res.status(500).json({ 
        message: `An error occurred: ${error.message}`,
        errorType: error.name,
        success: false
      });
    }
  }

  // Client: Remove company from their list
  async removeCompanyFromClient(req, res) {
    try {
      const userId = getCurrentUserId(req);
      const companyId = parseInt(req.params.companyId);

      await ClientCompany.destroy({
        where: { clientUserId: userId, companyId }
      });

      return res.status(200).json({ message: 'Company removed successfully' });
    } catch (error) {
      console.error('Remove company from client error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Company: Get received documents
  async getReceivedDocuments(req, res) {
    try {
      const userRole = getCurrentUserRole(req);
      const userId = getCurrentUserId(req);

      console.log(`[GetReceivedDocuments] UserRole: ${userRole}, UserId: ${userId}`);

      if (userRole !== 'Company') {
        console.log(`[GetReceivedDocuments] ❌ Forbidden: User is not a Company (role: ${userRole})`);
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Get company for this user
      const company = await Company.findOne({ where: { userId } });

      if (!company) {
        console.log(`[GetReceivedDocuments] ❌ Company not found for userId: ${userId}`);
        return res.status(404).json({ message: 'Company not found for this user' });
      }

      console.log(`[GetReceivedDocuments] ✅ Company found: ${company.name} (ID: ${company.id})`);

      // Get documents sent to this company from junction table
      const CompanyReceivedDocument = require('../models').CompanyReceivedDocument;

      const receivedDocs = await CompanyReceivedDocument.findAll({
        where: {
          companyId: company.id
        },
        include: [
          {
            model: DocumentProcessed,
            as: 'documentProcessed',
            include: [
              {
                model: DocumentOriginal,
                as: 'sourceDocument',
                required: false, // LEFT JOIN - document might be deleted by client
                include: [{ model: User, as: 'uploader' }]
              }
            ]
          }
        ],
        order: [['sentAt', 'DESC']]
      });

      // Filter out records where document was deleted
      const validReceivedDocs = receivedDocs.filter(rec => rec.documentProcessed);

      console.log(`[GetReceivedDocuments] 📋 Found ${validReceivedDocs.length} documents for company ${company.id}`);

      // Debug: Show all documents with sentToCompanyId
      const allSentDocs = await DocumentProcessed.findAll({
        where: { isSentToCompany: true },
        attributes: ['id', 'sentToCompanyId', 'isSentToCompany', 'sentToCompanyAt']
      });
      console.log(`[GetReceivedDocuments] 🔍 Debug: Total documents marked as sent to any company: ${allSentDocs.length}`);
      allSentDocs.forEach(doc => {
        console.log(`  - Doc ${doc.id}: sentToCompanyId=${doc.sentToCompanyId}, isSentToCompany=${doc.isSentToCompany}, sentAt=${doc.sentToCompanyAt}`);
      });

      const documentDtos = validReceivedDocs.map(rec => {
        const doc = rec.documentProcessed;

        // Generate RFC-timestamp filename to match download filename
        let rfcPrefix = 'XXXX';
        let uploaderRFC = null;
        const extractedData = JSON.parse(doc.extractedJsonData || '{}');

        // Use the uploader's RFC (same logic as download function)
        if (doc.sourceDocument?.uploader?.rfc && doc.sourceDocument.uploader.rfc.length >= 4) {
          uploaderRFC = doc.sourceDocument.uploader.rfc;
          rfcPrefix = uploaderRFC.substring(0, 4).toUpperCase();
        }

        // Use the document creation date for timestamp (same as download)
        const createdAt = new Date(doc.createdAt);
        const year = createdAt.getFullYear();
        const month = String(createdAt.getMonth() + 1).padStart(2, '0');
        const day = String(createdAt.getDate()).padStart(2, '0');
        const hours = String(createdAt.getHours()).padStart(2, '0');
        const minutes = String(createdAt.getMinutes()).padStart(2, '0');
        const seconds = String(createdAt.getSeconds()).padStart(2, '0');
        const timestamp = `${year}${month}${day}-${hours}${minutes}${seconds}`;

        const fileName = `${rfcPrefix}-${timestamp}.pdf`;

        return {
          id: doc.id,
          fileName: fileName,
          clientEmail: doc.sourceDocument?.uploader?.email || 'unknown',
          sentAt: rec.sentAt, // Use junction table's sentAt (when it was sent to THIS company)
          extractedData: {
            ...extractedData,
            rfc: uploaderRFC || extractedData.rfc // Use uploader's RFC, fallback to extracted RFC
          }
        };
      });

      console.log(`[GetReceivedDocuments] ✅ Returning ${documentDtos.length} documents`);

      return res.status(200).json({ documents: documentDtos });
    } catch (error) {
      console.error('[GetReceivedDocuments] ❌ Error:', error);
      console.error('[GetReceivedDocuments] Stack:', error.stack);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Company: Delete received document
  async deleteReceivedDocument(req, res) {
    try {
      const documentId = parseInt(req.params.id);
      const userId = getCurrentUserId(req);
      const userRole = getCurrentUserRole(req);

      console.log(`[DeleteReceivedDocument] Document ID: ${documentId}, User Role: ${userRole}, User ID: ${userId}`);

      if (userRole !== 'Company') {
        console.log(`[DeleteReceivedDocument] ❌ Forbidden: User is not a Company`);
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Get company for this user
      const company = await Company.findOne({ where: { userId } });

      if (!company) {
        console.log(`[DeleteReceivedDocument] ❌ Company not found for userId: ${userId}`);
        return res.status(404).json({ message: 'Company not found for this user' });
      }

      console.log(`[DeleteReceivedDocument] Company: ${company.name} (ID: ${company.id})`);

      const CompanyReceivedDocument = require('../models').CompanyReceivedDocument;

      // Verify document was sent to THIS company by checking junction table
      const receivedRecord = await CompanyReceivedDocument.findOne({
        where: {
          companyId: company.id,
          documentProcessedId: documentId
        }
      });

      if (!receivedRecord) {
        console.log(`[DeleteReceivedDocument] ❌ Document ${documentId} was not sent to company ${company.id}`);
        return res.status(403).json({ message: 'Document was not sent to your company' });
      }

      console.log(`[DeleteReceivedDocument] ✅ Authorization passed for company ${company.id}`);

      // Company: Delete from company_received_documents table only
      console.log(`[DeleteReceivedDocument] 🗑️ Company deleting received document record...`);

      // Delete the record from company_received_documents table
      const deleteCount = await CompanyReceivedDocument.destroy({
        where: {
          companyId: company.id,
          documentProcessedId: documentId
        }
      });

      if (deleteCount > 0) {
        console.log(`[DeleteReceivedDocument] ✅ Document ${documentId} removed from company ${company.id}'s received list`);
        console.log(`[DeleteReceivedDocument] ℹ️ Source document remains intact - client can still access it`);

        return res.status(200).json({
          message: 'Document deleted from your company successfully'
        });
      } else {
        console.log(`[DeleteReceivedDocument] ⚠️ No record found to delete`);
        return res.status(404).json({
          message: 'Document record not found'
        });
      }
    } catch (error) {
      console.error('[DeleteReceivedDocument] ❌ Error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Company: Get all users for this company
  async getCompanyUsers(req, res) {
    try {
      const userId = getCurrentUserId(req);
      const userRole = getCurrentUserRole(req);
      const page = parseInt(req.query.page) || 1;
      const pageSize = 5; // Fixed to 5 per page

      console.log(`[GetCompanyUsers] User ID: ${userId}, Role: ${userRole}, Page: ${page}`);

      if (userRole !== 'Company') {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Get company for this user
      const company = await Company.findOne({ where: { userId } });

      if (!company) {
        return res.status(404).json({ message: 'Company not found for this user' });
      }

      console.log(`[GetCompanyUsers] Company: ${company.name} (ID: ${company.id})`);

      // Get clients associated with this company via client_companies table
      const { count, rows: clientCompanies } = await ClientCompany.findAndCountAll({
        where: { companyId: company.id },
        include: [{
          model: User,
          as: 'client',
          where: { role: User.ROLES.CLIENT },
          attributes: ['id', 'email', 'rfc', 'whatsappNumber', 'isActive', 'createdAt']
        }],
        limit: pageSize,
        offset: (page - 1) * pageSize,
        order: [['createdAt', 'DESC']]
      });

      console.log(`[GetCompanyUsers] Found ${count} clients for company ${company.id}`);

      // Map to user objects
      const users = clientCompanies.map(cc => ({
        id: cc.client.id,
        name: cc.client.email.split('@')[0], // Use email username as name
        email: cc.client.email,
        role: 'client',
        status: cc.client.isActive ? 'active' : 'inactive',
        rfc: cc.client.rfc,
        whatsapp: cc.client.whatsappNumber,
        createdAt: cc.client.createdAt
      }));

      return res.status(200).json({
        users,
        totalCount: count,
        page,
        pageSize,
        totalPages: Math.ceil(count / pageSize)
      });
    } catch (error) {
      console.error('[GetCompanyUsers] Error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Company: Create a new user for this company
  async createCompanyUser(req, res) {
    try {
      const userId = getCurrentUserId(req);
      const userRole = getCurrentUserRole(req);
      const { name, email, role, status } = req.body;

      console.log(`[CreateCompanyUser] User ID: ${userId}, Role: ${userRole}`);

      if (userRole !== 'Company') {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Get company for this user
      const company = await Company.findOne({ where: { userId } });

      if (!company) {
        return res.status(404).json({ message: 'Company not found for this user' });
      }

      // Validate required fields
      if (!name || !email || !role || !status) {
        return res.status(400).json({ message: 'Name, email, role, and status are required' });
      }

      // Check if user with this email already exists
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ message: 'User with this email already exists' });
      }

      // For now, return a message that multi-user support is not yet implemented
      return res.status(501).json({
        message: 'Multi-user support for companies is not yet implemented. Only the main company account is currently supported.'
      });
    } catch (error) {
      console.error('[CreateCompanyUser] Error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Company: Update a user
  async updateCompanyUser(req, res) {
    try {
      const userId = getCurrentUserId(req);
      const userRole = getCurrentUserRole(req);
      const targetUserId = parseInt(req.params.id);
      const { name, email, role, status } = req.body;

      console.log(`[UpdateCompanyUser] User ID: ${userId}, Role: ${userRole}, Target User: ${targetUserId}`);

      if (userRole !== 'Company') {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Get company for this user
      const company = await Company.findOne({ where: { userId } });

      if (!company) {
        return res.status(404).json({ message: 'Company not found for this user' });
      }

      // For now, only allow updating the main company account
      if (targetUserId !== userId) {
        return res.status(403).json({ message: 'You can only update your own account' });
      }

      // Update company name if changed
      if (name && name !== company.name) {
        await company.update({ name });
      }

      // Update user email if changed
      if (email && email !== company.email) {
        const user = await User.findByPk(userId);
        if (user) {
          await user.update({ email });
          await company.update({ email });
        }
      }

      return res.status(200).json({
        message: 'User updated successfully',
        user: {
          id: userId,
          name: company.name,
          email: company.email,
          role: 'admin',
          status: 'active'
        }
      });
    } catch (error) {
      console.error('[UpdateCompanyUser] Error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  // Company: Delete a user
  async deleteCompanyUser(req, res) {
    try {
      const userId = getCurrentUserId(req);
      const userRole = getCurrentUserRole(req);
      const targetUserId = parseInt(req.params.id);

      console.log(`[DeleteCompanyUser] User ID: ${userId}, Role: ${userRole}, Target User: ${targetUserId}`);

      if (userRole !== 'Company') {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Get company for this user
      const company = await Company.findOne({ where: { userId } });

      if (!company) {
        return res.status(404).json({ message: 'Company not found for this user' });
      }

      // Don't allow deleting the main company account
      if (targetUserId === userId) {
        return res.status(400).json({ message: 'You cannot delete your own account' });
      }

      // For now, return not implemented since we only support one user per company
      return res.status(501).json({
        message: 'Multi-user support for companies is not yet implemented.'
      });
    } catch (error) {
      console.error('[DeleteCompanyUser] Error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }
}

module.exports = new CompanyController();

