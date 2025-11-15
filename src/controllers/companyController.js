const { Company, User, DocumentProcessed, DocumentOriginal, ClientCompany, AdminNotification } = require('../models');
const authService = require('../services/authService');
const bcrypt = require('bcryptjs');
const { getCurrentUserId, getCurrentUserRole } = require('../utils/helpers');
const { Op } = require('sequelize');
const otpService = require('../services/otpService');
const emailService = require('../services/emailService');

class CompanyController {
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

      // Find company by email
      const company = await Company.findOne({ where: { email } });

      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
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

      // Find company by email
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
      const { name, rfc, email, whatsappNumber, password } = req.body;

      // Validate required fields
      if (!name || !rfc || !email || !whatsappNumber || !password) {
        return res.status(400).json({ message: 'Name, RFC, email, WhatsApp number, and password are required' });
      }

      // Validate password length
      if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
      }

      // Check if company with RFC or email already exists
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

      // Hash password for later use when approved
      const passwordHash = await bcrypt.hash(password, 10);

      // Generate OTP for email verification (2FA)
      const otpCode = otpService.generateOTP();
      const otpExpiry = otpService.getOTPExpiry();

      // Create company with pending status and email NOT verified
      const company = await Company.create({
        name,
        rfc,
        email,
        whatsappNumber,
        passwordHash,
        status: Company.STATUS.PENDING,
        isEmailVerified: false,
        otpCode,
        otpExpiry,
        otpAttempts: 0,
        createdAt: new Date()
      });

      console.log(`[CompanyController] ✅ Company registered (pending email verification): ${name} (${rfc})`);
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

      // NOTE: Admin notification will be created AFTER email verification (in verifyCompanyOTP)

      return res.status(201).json({
        id: company.id,
        name: company.name,
        rfc: company.rfc,
        email: company.email,
        status: company.status,
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

      // Get documents sent to this company
      const documents = await DocumentProcessed.findAll({
        where: {
          isSentToCompany: true,
          sentToCompanyId: company.id
        },
        include: [
          {
            model: DocumentOriginal,
            as: 'sourceDocument',
            include: [{ model: User, as: 'uploader' }]
          }
        ],
        order: [['sentToCompanyAt', 'DESC']]
      });

      console.log(`[GetReceivedDocuments] 📋 Found ${documents.length} documents for company ${company.id}`);

      // Debug: Show all documents with sentToCompanyId
      const allSentDocs = await DocumentProcessed.findAll({
        where: { isSentToCompany: true },
        attributes: ['id', 'sentToCompanyId', 'isSentToCompany', 'sentToCompanyAt']
      });
      console.log(`[GetReceivedDocuments] 🔍 Debug: Total documents marked as sent to any company: ${allSentDocs.length}`);
      allSentDocs.forEach(doc => {
        console.log(`  - Doc ${doc.id}: sentToCompanyId=${doc.sentToCompanyId}, isSentToCompany=${doc.isSentToCompany}, sentAt=${doc.sentToCompanyAt}`);
      });

      const documentDtos = documents.map(doc => ({
        id: doc.id,
        fileName: doc.sourceDocument?.originalFileName || 'unknown',
        clientEmail: doc.sourceDocument?.uploader?.email || 'unknown',
        sentAt: doc.sentToCompanyAt,
        extractedData: JSON.parse(doc.extractedJsonData || '{}')
      }));

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

      // Get the document
      const document = await DocumentProcessed.findByPk(documentId);

      if (!document) {
        console.log(`[DeleteReceivedDocument] ❌ Document ${documentId} not found`);
        return res.status(404).json({ message: 'Document not found' });
      }

      // Verify document was sent to THIS company
      if (!document.isSentToCompany || document.sentToCompanyId !== company.id) {
        console.log(`[DeleteReceivedDocument] ❌ Document ${documentId} was not sent to company ${company.id}`);
        console.log(`[DeleteReceivedDocument]    isSentToCompany: ${document.isSentToCompany}, sentToCompanyId: ${document.sentToCompanyId}`);
        return res.status(403).json({ message: 'Document was not sent to your company' });
      }

      console.log(`[DeleteReceivedDocument] ✅ Authorization passed for company ${company.id}`);

      // Delete PDF from company folder in Cloudflare R2
      const storageService = require('../services/storageService');
      const sanitizedCompanyName = company.name
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_{2,}/g, '_')
        .toLowerCase();
      
      const fileName = document.filePathFinalPdf.split('/').pop();
      const companyPdfPath = `company/${sanitizedCompanyName}/${fileName}`;

      console.log(`[DeleteReceivedDocument] 🗑️ Deleting PDF from company folder: ${companyPdfPath}`);

      const deleted = await storageService.deleteFile(companyPdfPath);
      
      if (deleted) {
        console.log(`[DeleteReceivedDocument] ✅ PDF deleted from company folder`);
      } else {
        console.log(`[DeleteReceivedDocument] ⚠️ Failed to delete PDF from company folder (may not exist)`);
      }

      // Update document to mark as not sent to this company anymore
      // If the document was only sent to this company, we can unmark it
      // But we DON'T delete it from database or client's folder
      await DocumentProcessed.update(
        {
          isSentToCompany: false,
          sentToCompanyId: null,
          sentToCompanyAt: null
        },
        {
          where: { id: documentId, sentToCompanyId: company.id }
        }
      );

      console.log(`[DeleteReceivedDocument] ✅ Document ${documentId} unmarked from company ${company.id}`);

      return res.status(200).json({ 
        message: 'Document deleted from your company successfully',
        deletedFromStorage: deleted
      });
    } catch (error) {
      console.error('[DeleteReceivedDocument] ❌ Error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }
}

module.exports = new CompanyController();

