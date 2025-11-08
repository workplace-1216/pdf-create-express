const { Company, User, DocumentProcessed, DocumentOriginal, ClientCompany, AdminNotification } = require('../models');
const authService = require('../services/authService');
const bcrypt = require('bcryptjs');
const { getCurrentUserId, getCurrentUserRole } = require('../utils/helpers');
const { Op } = require('sequelize');

class CompanyController {
  // Get all companies (for client selection during registration)
  async getApprovedCompanies(req, res) {
    try {
      const companies = await Company.findAll({
        where: { status: Company.STATUS.APPROVED },
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
          where: { status: Company.STATUS.APPROVED },
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

  // Register new company
  async registerCompany(req, res) {
    try {
      const { name, rfc, email, phone, password } = req.body;

      // Validate required fields
      if (!name || !rfc || !email || !password) {
        return res.status(400).json({ message: 'Name, RFC, email, and password are required' });
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

      // Create company with pending status
      const company = await Company.create({
        name,
        rfc,
        email,
        phone: phone || null,
        passwordHash,
        status: Company.STATUS.PENDING,
        createdAt: new Date()
      });

      console.log(`[CompanyController] ✅ Company registered: ${name} (${rfc}) - Status: PENDING`);

      // Create admin notification for new company registration
      await AdminNotification.create({
        notificationType: AdminNotification.TYPES.NEW_COMPANY,
        relatedCompanyId: company.id,
        message: `Nueva empresa registrada: ${name} (${rfc})`,
        isRead: false,
        createdAt: new Date()
      });

      return res.status(201).json({
        id: company.id,
        name: company.name,
        rfc: company.rfc,
        email: company.email,
        status: company.status,
        message: 'Company registered successfully. Waiting for admin approval.'
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

      const where = {};
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
        phone: company.phone,
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
            isActive: true
          });
          console.log(`[CompanyController] ✅ User created with ID: ${user.id}, Role: ${user.role}, Role Name: ${User.getRoleName(user.role)}`);
        } else {
          // Generate temporary password
          const tempPassword = Math.random().toString(36).slice(-8);
          user = await authService.registerUser(
            company.email,
            tempPassword,
            User.ROLES.COMPANY
          );
          console.log(`[CompanyController] ✅ User created via authService, ID: ${user.id}`);
        }
        
        userId = user.id;
        console.log(`[CompanyController] ✅ User account created for company: ${company.email}, userId: ${userId}`);
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

      console.log(`[AddCompanyToClient] userId: ${userId}, companyId: ${companyId}`);

      const company = await Company.findByPk(companyId);

      if (!company) {
        console.log(`[AddCompanyToClient] ❌ Company ${companyId} not found`);
        return res.status(404).json({ message: 'Company not found' });
      }

      console.log(`[AddCompanyToClient] Company found: ${company.name}, status: ${company.status}`);

      if (company.status !== Company.STATUS.APPROVED) {
        console.log(`[AddCompanyToClient] ❌ Company ${companyId} not approved`);
        return res.status(400).json({ message: 'Company is not approved' });
      }

      // Check if already added
      const existing = await ClientCompany.findOne({
        where: { clientUserId: userId, companyId }
      });

      if (existing) {
        console.log(`[AddCompanyToClient] ⚠️ Company ${companyId} already associated with user ${userId}`);
        return res.status(400).json({ message: 'Company already added' });
      }

      const clientCompany = await ClientCompany.create({
        clientUserId: userId,
        companyId,
        createdAt: new Date()
      });

      console.log(`[AddCompanyToClient] ✅ Company ${companyId} added to user ${userId}, record ID: ${clientCompany.id}`);

      return res.status(200).json({ 
        message: 'Company added successfully',
        clientCompanyId: clientCompany.id
      });
    } catch (error) {
      console.error('[AddCompanyToClient] ❌ Error:', error);
      console.error('[AddCompanyToClient] Error stack:', error.stack);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
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

