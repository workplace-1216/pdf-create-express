const { User, DocumentOriginal, DocumentProcessed, TemplateRuleSet, Notification, DocumentHistory } = require('../models');
const authService = require('../services/authService');
const storageService = require('../services/storageService');
const { getCurrentUserId, formatFileSize } = require('../utils/helpers');
const { Op } = require('sequelize');

class AdminController {
  async getDashboardStats(req, res) {
    try {
      // Use DocumentHistory for permanent stats that persist after deletions
      const totalUploaded = await DocumentHistory.count({ 
        where: { actionType: DocumentHistory.ACTION_TYPES.UPLOADED } 
      });
      
      const totalProcessed = await DocumentHistory.count({ 
        where: { actionType: DocumentHistory.ACTION_TYPES.PROCESSED } 
      });
      
      const totalSentToAdmin = await DocumentHistory.count({ 
        where: { actionType: DocumentHistory.ACTION_TYPES.SENT_TO_ADMIN } 
      });
      
      const totalFailed = await DocumentHistory.count({
        where: { 
          actionType: { 
            [Op.in]: [
              DocumentHistory.ACTION_TYPES.UPLOAD_FAILED, 
              DocumentHistory.ACTION_TYPES.PROCESSING_FAILED
            ] 
          }
        }
      });

      // Current active documents (not deleted)
      const currentDocuments = await DocumentProcessed.count({ where: { isSentToAdmin: true } });
      const pendingDocuments = await DocumentProcessed.count({
        where: { isSentToAdmin: true, status: DocumentProcessed.STATUS.PENDING }
      });

      const totalUsers = await User.count();
      const activeUsers = await User.count({ where: { role: User.ROLES.CLIENT, isActive: true } });

      // Get today's processed documents count from history
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const processedToday = await DocumentHistory.count({
        where: {
          actionType: DocumentHistory.ACTION_TYPES.PROCESSED,
          createdAt: { [Op.gte]: today }
        }
      });

      console.log(`[AdminController] Stats from History - Uploaded: ${totalUploaded}, Processed: ${totalProcessed}, Sent: ${totalSentToAdmin}, Failed: ${totalFailed}`);

      return res.status(200).json({
        totalDocuments: totalSentToAdmin, // Total sent to admin (from history)
        processedDocuments: totalProcessed, // Total processed (from history)
        pendingDocuments: pendingDocuments, // Current pending (from DB)
        errorDocuments: totalFailed, // All failures (from history)
        totalUsers,
        activeUsers,
        processedToday
      });
    } catch (error) {
      console.error('Get stats error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async getAdminList(req, res) {
    try {
      // Get all active admin users (for client to select when sending documents)
      const admins = await User.findAll({
        where: { 
          role: User.ROLES.ADMIN,
          isActive: true
        },
        attributes: ['id', 'email'],
        order: [['email', 'ASC']]
      });

      const adminDtos = admins.map(admin => ({
        id: admin.id.toString(),
        name: admin.email.split('@')[0],
        email: admin.email
      }));

      return res.status(200).json(adminDtos);
    } catch (error) {
      console.error('Get admin list error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async getUsers(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const pageSize = parseInt(req.query.pageSize) || 10;
      const search = req.query.search || '';
      const role = req.query.role || '';

      const where = {};

      if (search) {
        where.email = { [Op.iLike]: `%${search}%` };
      }

      if (role && role !== 'All') {
        if (role === 'Admin') {
          where.role = User.ROLES.ADMIN;
        } else if (role === 'Cliente' || role === 'Client') {
          where.role = User.ROLES.CLIENT;
        } else if (role === 'Empresa' || role === 'Company') {
          where.role = User.ROLES.COMPANY;
        }
      }

      const { count, rows: users } = await User.findAndCountAll({
        where,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        order: [['createdAt', 'DESC']]
      });

      const userDtos = await Promise.all(users.map(async (user) => {
        const documentCount = await DocumentOriginal.count({
          where: { uploaderUserId: user.id }
        });

        const roleName = User.getRoleName(user.role);

        return {
          id: user.id.toString(),
          name: user.email.split('@')[0],
          email: user.email,
          role: roleName,
          status: user.isActive ? 'Activo' : 'Inactivo',
          lastLogin: user.createdAt.toISOString().split('T')[0],
          documentsCount: documentCount,
          rfc: user.rfc || null, // Include RFC for client users
          canEdit: roleName === 'Admin', // Only admins can be edited
          canDelete: true // All users can be deleted by admin
        };
      }));

      return res.status(200).json({
        items: userDtos,
        totalCount: count,
        page,
        pageSize,
        totalPages: Math.ceil(count / pageSize)
      });
    } catch (error) {
      console.error('Get users error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async getDocuments(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const pageSize = parseInt(req.query.pageSize) || 10;
      const status = req.query.status || '';

      console.log(`[AdminController] getDocuments - Page: ${page}, PageSize: ${pageSize}, Status: ${status}`);

      // Check if tables exist by trying a simple query first
      const where = { isSentToAdmin: true };

      if (status && status !== 'All') {
        const statusMap = {
          'Approved': DocumentProcessed.STATUS.APPROVED,
          'Pending': DocumentProcessed.STATUS.PENDING,
          'Rejected': DocumentProcessed.STATUS.REJECTED
        };
        where.status = statusMap[status] || DocumentProcessed.STATUS.APPROVED;
      }

      let count = 0;
      let documents = [];

      try {
        const result = await DocumentProcessed.findAndCountAll({
          where,
          limit: pageSize,
          offset: (page - 1) * pageSize,
          order: [['id', 'DESC']], // Use id instead of created_at to avoid potential column name issues
          include: [
            {
              model: DocumentOriginal,
              as: 'sourceDocument',
              required: false,
              include: [{ 
                model: User, 
                as: 'uploader',
                required: false
              }]
            }
          ]
        });
        
        count = result.count;
        documents = result.rows;
      } catch (queryError) {
        console.error('[AdminController] Database query error:', queryError.message);
        console.error('[AdminController] This might be because tables don\'t exist. Run: npm run seed');
        
        // Return empty result instead of throwing error
        return res.status(200).json({
          items: [],
          totalCount: 0,
          page,
          pageSize,
          totalPages: 0,
          warning: 'Database tables may not be initialized. Please run: npm run seed'
        });
      }

      console.log(`[AdminController] Found ${count} documents, returning ${documents.length} items`);

      const documentDtos = [];
      
      for (const doc of documents) {
        try {
          let extractedData = {};
          try {
            extractedData = JSON.parse(doc.extractedJsonData || '{}');
          } catch (jsonError) {
            console.error('[AdminController] Failed to parse JSON for doc', doc.id, jsonError);
            extractedData = {};
          }
          
          const uploaderRfc = doc.sourceDocument?.uploader?.rfc || 'No registrado';
          
          // Handle date safely
          let uploadDate = 'N/A';
          try {
            if (doc.createdAt) {
              uploadDate = new Date(doc.createdAt).toISOString().split('T')[0];
            }
          } catch (e) {
            uploadDate = 'N/A';
          }

          // Get status string
          let statusString = 'Pendiente de revisión';
          if (doc.status === DocumentProcessed.STATUS.APPROVED) {
            statusString = 'Completado';
          } else if (doc.status === DocumentProcessed.STATUS.PENDING) {
            statusString = 'Procesando';
          } else if (doc.status === DocumentProcessed.STATUS.REJECTED) {
            statusString = 'Error';
          }

          documentDtos.push({
            id: doc.id.toString(),
            fileName: doc.sourceDocument?.originalFileName || 'N/A',
            uploader: doc.sourceDocument?.uploader?.email || 'Unknown',
            uploadDate: uploadDate,
            status: statusString,
            fileSize: doc.sourceDocument ? formatFileSize(doc.sourceDocument.fileSizeBytes) : 'N/A',
            documentType: 'Factura',
            extractedData: {
              rfc: uploaderRfc,
              folio: extractedData.folio || extractedData.Folio || 'N/A',
              fecha: extractedData.fecha || extractedData.Fecha || 'N/A'
            }
          });
        } catch (docError) {
          console.error('[AdminController] Error processing document', doc.id, docError);
          // Skip this document and continue with others
          continue;
        }
      }

      console.log(`[AdminController] Returning ${documentDtos.length} processed documents`);

      return res.status(200).json({
        items: documentDtos,
        totalCount: count,
        page,
        pageSize,
        totalPages: Math.ceil(count / pageSize)
      });
    } catch (error) {
      console.error('Get documents error:', error);
      console.error('Error stack:', error.stack);
      return res.status(500).json({ 
        message: `An error occurred: ${error.message}`,
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  async createAdmin(req, res) {
    try {
      console.log('[AdminController] createAdmin - Request body:', req.body);

      const { email, password, name, whatsappNumber } = req.body;

      // Validate input
      if (!email) {
        console.log('[AdminController] createAdmin - Missing email');
        return res.status(400).json({ message: 'Email is required' });
      }

      if (!password) {
        console.log('[AdminController] createAdmin - Missing password');
        return res.status(400).json({ message: 'Password is required' });
      }

      if (password.length < 6) {
        console.log('[AdminController] createAdmin - Password too short');
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
      }

      // Check if email domain is admin.com (optional, can be removed if you want)
      // Comment this out if you want to allow any email for admin
      if (!email.endsWith('@admin.com')) {
        console.log('[AdminController] createAdmin - Invalid email domain:', email);
        return res.status(400).json({
          message: "Admin email must end with '@admin.com'. Example: admin@admin.com"
        });
      }

      console.log('[AdminController] createAdmin - Attempting to create admin:', email);

      // Use registerUserWith2FA so new admin must verify their email
      const user = await authService.registerUserWith2FA(email, password, User.ROLES.ADMIN, null, whatsappNumber);

      if (!user) {
        console.log('[AdminController] createAdmin - Email already exists:', email);
        return res.status(400).json({ message: 'Email already exists' });
      }

      console.log('[AdminController] createAdmin - Admin created (email verification required):', user.id);
      console.log('[AdminController] createAdmin - OTP sent to:', email);

      return res.status(200).json({
        id: user.id.toString(),
        name: name || email.split('@')[0],
        email: user.email,
        role: 'Admin',
        status: 'Activo',
        lastLogin: new Date().toISOString().split('T')[0],
        documentsCount: 0
      });
    } catch (error) {
      console.error('[AdminController] createAdmin - Error:', error);
      console.error('[AdminController] createAdmin - Stack:', error.stack);
      return res.status(500).json({
        message: `An error occurred: ${error.message}`,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  async updateUser(req, res) {
    try {
      const userId = parseInt(req.params.userId);
      const { name, email, status } = req.body;

      console.log('[AdminController] updateUser - userId:', userId, 'data:', req.body);

      const user = await User.findByPk(userId);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Update fields if provided
      if (email && email !== user.email) {
        // Check if new email already exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
          return res.status(400).json({ message: 'Email already exists' });
        }
        user.email = email;
      }

      // Update status to isActive field
      if (status) {
        user.isActive = status === 'Activo';
        console.log(`[AdminController] Setting user ${userId} isActive to:`, user.isActive);
      }

      await user.save();

      console.log('[AdminController] User updated successfully');

      return res.status(200).json({
        id: user.id.toString(),
        name: name || user.email.split('@')[0],
        email: user.email,
        role: User.getRoleName(user.role),
        status: user.isActive ? 'Activo' : 'Inactivo',
        lastLogin: user.createdAt.toISOString().split('T')[0],
        documentsCount: await DocumentOriginal.count({ where: { uploaderUserId: user.id } })
      });
    } catch (error) {
      console.error('Update user error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async deleteUser(req, res) {
    try {
      const userId = parseInt(req.params.userId);
      const user = await User.findByPk(userId);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Delete related data
      await Notification.destroy({ where: { clientUserId: userId } });

      // Reassign templates to current admin
      const currentAdminId = getCurrentUserId(req);
      await TemplateRuleSet.update(
        { createdByUserId: currentAdminId },
        { where: { createdByUserId: userId } }
      );

      // Delete documents
      const originals = await DocumentOriginal.findAll({ where: { uploaderUserId: userId } });
      const originalIds = originals.map(o => o.id);

      if (originalIds.length > 0) {
        await DocumentProcessed.destroy({ where: { sourceDocumentId: { [Op.in]: originalIds } } });
        await DocumentOriginal.destroy({ where: { uploaderUserId: userId } });
      }

      // Delete user
      await user.destroy();

      return res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
      console.error('Delete user error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async deleteDocuments(req, res) {
    try {
      const { documentIds } = req.body;

      if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
        return res.status(400).json({ message: 'Document IDs are required' });
      }

      console.log(`[AdminController] Deleting documents:`, documentIds);

      // Convert to integers
      const ids = documentIds.map(id => parseInt(id));

      // Find all processed documents with their source documents
      const processedDocs = await DocumentProcessed.findAll({
        where: { id: { [Op.in]: ids } },
        include: [{
          model: DocumentOriginal,
          as: 'sourceDocument'
        }]
      });

      if (processedDocs.length === 0) {
        return res.status(404).json({ message: 'No documents found' });
      }

      console.log(`[AdminController] 🗑️ Deleting ${processedDocs.length} documents from Cloudflare...`);

      const adminUserId = getCurrentUserId(req);

      // Delete files from Cloudflare storage and log to history
      for (const doc of processedDocs) {
        try {
          // Log DELETED_BY_ADMIN action to history BEFORE deletion
          await DocumentHistory.logAction({
            actionType: DocumentHistory.ACTION_TYPES.DELETED_BY_ADMIN,
            documentId: doc.id,
            userId: adminUserId,
            userRole: 'Admin',
            fileName: doc.sourceDocument?.originalFileName || 'unknown',
            fileSizeBytes: doc.sourceDocument?.fileSizeBytes || null,
            batchId: doc.sourceDocument?.uploadBatchId || null,
            metadata: {
              deletedFrom: {
                sent: doc.isSentToAdmin ? `sent/${doc.filePathFinalPdf.split('/').pop()}` : null
              },
              keptIn: {
                processed: doc.filePathFinalPdf,
                original: doc.sourceDocument?.filePath
              },
              wasSentToAdmin: doc.isSentToAdmin
            }
          });

          // Delete ONLY from sent folder (admin documents)
          // Keep files in pdf_processed and pdf_uploaded folders
          if (doc.isSentToAdmin) {
            const fileName = doc.filePathFinalPdf.split('/').pop();
            const sentPath = `sent/${fileName}`;
            const deletedSent = await storageService.deleteFile(sentPath);
            console.log(`[AdminController] ${deletedSent ? '✅' : '⚠️'} Deleted from sent folder: ${sentPath}`);
          }
          
          console.log(`[AdminController] ℹ️ Keeping files in pdf_processed and pdf_uploaded folders`);
          // pdf_processed and pdf_uploaded files are NOT deleted
        } catch (fileError) {
          console.error(`[AdminController] ⚠️ Error deleting files for document ${doc.id}:`, fileError.message);
          // Continue with other documents even if file deletion fails
        }
      }

      // Get source document IDs
      const sourceDocumentIds = processedDocs.map(doc => doc.sourceDocumentId).filter(id => id);

      // Delete processed documents from database
      await DocumentProcessed.destroy({
        where: { id: { [Op.in]: ids } }
      });

      // Delete related source documents from database if they exist
      if (sourceDocumentIds.length > 0) {
        await DocumentOriginal.destroy({
          where: { id: { [Op.in]: sourceDocumentIds } }
        });
      }

      console.log(`[AdminController] ✅ Successfully deleted ${processedDocs.length} document(s) from storage and database`);

      return res.status(200).json({ 
        message: `${processedDocs.length} document(s) deleted successfully`,
        deletedCount: processedDocs.length
      });
    } catch (error) {
      console.error('Delete documents error:', error);
      return res.status(500).json({ message: `An error occurred: ${error.message}` });
    }
  }

  async getAnalytics(req, res) {
    try {
      const period = req.query.period || '30d';
      const days = period.endsWith('d') ? parseInt(period.slice(0, -1)) : (period === '1y' ? 365 : 30);

      const since = new Date();
      since.setDate(since.getDate() - days + 1);
      since.setHours(0, 0, 0, 0);

      const processedDocs = await DocumentProcessed.findAll({
        where: {
          isSentToAdmin: true,
          createdAt: { [Op.gte]: since }
        }
      });

      const totalDocsCount = await DocumentProcessed.count({ where: { isSentToAdmin: true } });
      const errorDocsCount = await DocumentProcessed.count({
        where: { isSentToAdmin: true, status: DocumentProcessed.STATUS.REJECTED }
      });
      const successRate = totalDocsCount === 0 ? 0 : Math.round(((totalDocsCount - errorDocsCount) * 100) / totalDocsCount * 10) / 10;

      // Generate monthly trends for last 12 months from DocumentHistory
      const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      const monthlyTrends = [];
      
      for (let i = 11; i >= 0; i--) {
        const monthStart = new Date();
        monthStart.setMonth(monthStart.getMonth() - i);
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        const monthEnd = new Date(monthStart);
        monthEnd.setMonth(monthEnd.getMonth() + 1);

        // Count from history
        const documentsInMonth = await DocumentHistory.count({
          where: {
            actionType: DocumentHistory.ACTION_TYPES.UPLOADED,
            createdAt: { [Op.gte]: monthStart, [Op.lt]: monthEnd }
          }
        });

        const processedInMonth = await DocumentHistory.count({
          where: {
            actionType: DocumentHistory.ACTION_TYPES.PROCESSED,
            createdAt: { [Op.gte]: monthStart, [Op.lt]: monthEnd }
          }
        });

        const errorsInMonth = await DocumentHistory.count({
          where: {
            actionType: { 
              [Op.in]: [
                DocumentHistory.ACTION_TYPES.UPLOAD_FAILED,
                DocumentHistory.ACTION_TYPES.PROCESSING_FAILED
              ]
            },
            createdAt: { [Op.gte]: monthStart, [Op.lt]: monthEnd }
          }
        });

        const sentInMonth = await DocumentHistory.count({
          where: {
            actionType: DocumentHistory.ACTION_TYPES.SENT_TO_ADMIN,
            createdAt: { [Op.gte]: monthStart, [Op.lt]: monthEnd }
          }
        });

        monthlyTrends.push({
          month: monthNames[monthStart.getMonth()],
          documents: documentsInMonth,
          processed: processedInMonth,
          sent: sentInMonth,
          errors: errorsInMonth
        });
      }

      // User activity - last 24 hours in 6 time buckets (4-hour intervals)
      const now = new Date();
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      // Get documents from last 24 hours
      const recentDocs = await DocumentProcessed.findAll({
        where: {
          isSentToAdmin: true,
          createdAt: { [Op.gte]: last24Hours }
        },
        include: [{
          model: DocumentOriginal,
          as: 'sourceDocument',
          attributes: ['uploaderUserId']
        }]
      });

      console.log(`[AdminController] Found ${recentDocs.length} documents in last 24h for user activity`);

      const userActivity = [];
      
      for (let i = 0; i < 6; i++) {
        // Create 6 buckets: starting from 24 hours ago to now
        const bucketStart = new Date(now.getTime() - (6 - i) * 4 * 60 * 60 * 1000);
        const bucketEnd = new Date(bucketStart.getTime() + 4 * 60 * 60 * 1000);

        // Count documents in this bucket
        const docsInBucket = recentDocs.filter(d => {
          const docTime = new Date(d.createdAt);
          return docTime >= bucketStart && docTime < bucketEnd;
        });

        // Count unique users
        const uniqueUserIds = new Set(
          docsInBucket
            .filter(d => d.sourceDocument && d.sourceDocument.uploaderUserId)
            .map(d => d.sourceDocument.uploaderUserId)
        );

        userActivity.push({
          time: bucketStart.getHours().toString().padStart(2, '0') + ':00',
          documents: docsInBucket.length,
          users: uniqueUserIds.size
        });
      }

      console.log('[AdminController] User activity buckets:', userActivity);

      // If no activity in last 24h, provide default structure with zeros
      if (userActivity.length === 0) {
        for (let i = 0; i < 6; i++) {
          const bucketStart = new Date(now.getTime() - (6 - i) * 4 * 60 * 60 * 1000);
          userActivity.push({
            time: bucketStart.getHours().toString().padStart(2, '0') + ':00',
            documents: 0,
            users: 0
          });
        }
      }

      // Processing time distribution from DocumentHistory (permanent data) - 10 second intervals
      const processedHistory = await DocumentHistory.findAll({
        where: { 
          actionType: DocumentHistory.ACTION_TYPES.PROCESSED,
          processingTimeMs: { [Op.not]: null }
        },
        attributes: ['processingTimeMs']
      });
      
      console.log(`[AdminController] Total processed documents with time data: ${processedHistory.length}`);
      
      // Calculate actual distribution based on processing times (10 second intervals)
      let processingTime;
      
      if (processedHistory.length === 0) {
        // No documents - return empty structure with 10s intervals up to 60s
        processingTime = [
          { range: '0-10s', count: 0 },
          { range: '10-20s', count: 0 },
          { range: '20-30s', count: 0 },
          { range: '30-40s', count: 0 },
          { range: '40-50s', count: 0 },
          { range: '50-60s', count: 0 },
          { range: '60s+', count: 0 }
        ];
      } else {
        // Categorize by actual processing time in 10-second intervals
        const buckets = {
          '0-10s': 0,
          '10-20s': 0,
          '20-30s': 0,
          '30-40s': 0,
          '40-50s': 0,
          '50-60s': 0,
          '60s+': 0
        };

        processedHistory.forEach(doc => {
          const timeInSeconds = doc.processingTimeMs / 1000;
          if (timeInSeconds <= 10) buckets['0-10s']++;
          else if (timeInSeconds <= 20) buckets['10-20s']++;
          else if (timeInSeconds <= 30) buckets['20-30s']++;
          else if (timeInSeconds <= 40) buckets['30-40s']++;
          else if (timeInSeconds <= 50) buckets['40-50s']++;
          else if (timeInSeconds <= 60) buckets['50-60s']++;
          else buckets['60s+']++;
        });

        processingTime = Object.entries(buckets).map(([range, count]) => ({ range, count }));
      }
      
      console.log('[AdminController] Processing time distribution (10s intervals):', processingTime);

      // Error types distribution from DocumentHistory (permanent data)
      const errorTypes = [];
      
      const uploadFailed = await DocumentHistory.count({
        where: { actionType: DocumentHistory.ACTION_TYPES.UPLOAD_FAILED }
      });
      
      const processingFailed = await DocumentHistory.count({
        where: { actionType: DocumentHistory.ACTION_TYPES.PROCESSING_FAILED }
      });
      
      const pendingDocs = await DocumentProcessed.count({
        where: { isSentToAdmin: true, status: DocumentProcessed.STATUS.PENDING }
      });

      // Total for percentage calculation
      const totalHistoryDocs = await DocumentHistory.count({
        where: { actionType: DocumentHistory.ACTION_TYPES.UPLOADED }
      });

      if (uploadFailed > 0) {
        errorTypes.push({
          type: 'Error de Carga',
          count: uploadFailed,
          percentage: totalHistoryDocs === 0 ? 0 : Math.round((uploadFailed * 100) / totalHistoryDocs)
        });
      }

      if (processingFailed > 0) {
        errorTypes.push({
          type: 'Error de Procesamiento',
          count: processingFailed,
          percentage: totalHistoryDocs === 0 ? 0 : Math.round((processingFailed * 100) / totalHistoryDocs)
        });
      }

      if (pendingDocs > 0) {
        errorTypes.push({
          type: 'Procesamiento Pendiente',
          count: pendingDocs,
          percentage: totalHistoryDocs === 0 ? 0 : Math.round((pendingDocs * 100) / totalHistoryDocs)
        });
      }

      // If no errors, show a success message
      if (errorTypes.length === 0) {
        errorTypes.push({
          type: 'Sin Errores',
          count: 0,
          percentage: 0
        });
      }

      const stats = {
        totalDocuments: totalDocsCount,
        processedToday: await DocumentProcessed.count({
          where: {
            isSentToAdmin: true,
            createdAt: { [Op.gte]: new Date().setHours(0, 0, 0, 0) }
          }
        }),
        averageProcessingTime: processedDocs.length > 0 ? '45s' : '-',
        successRate,
        totalUsers: await User.count(),
        activeUsers: await User.count({ where: { role: User.ROLES.CLIENT } }),
        growthRate: 0
      };

      console.log('[AdminController] ========== Analytics Response ==========');
      console.log('Stats:', JSON.stringify(stats, null, 2));
      console.log('Monthly trends count:', monthlyTrends.length);
      console.log('User activity:', JSON.stringify(userActivity, null, 2));
      console.log('Processing time:', JSON.stringify(processingTime, null, 2));
      console.log('Error types:', JSON.stringify(errorTypes, null, 2));
      console.log('[AdminController] =======================================');

      return res.status(200).json({
        stats,
        monthlyTrends,
        userActivity,
        documentTypes: [{ name: 'Factura', value: processedDocs.length }],
        processingTime,
        errorTypes
      });
    } catch (error) {
      console.error('Get analytics error:', error);
      console.error('Error stack:', error.stack);
      return res.status(500).json({ 
        message: `An error occurred: ${error.message}`,
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  getDocumentStatusString(status) {
    const statusMap = {
      [DocumentProcessed.STATUS.APPROVED]: 'Completado',
      [DocumentProcessed.STATUS.PENDING]: 'Procesando',
      [DocumentProcessed.STATUS.REJECTED]: 'Error'
    };
    return statusMap[status] || 'Pendiente de revisión';
  }
}

module.exports = new AdminController();

