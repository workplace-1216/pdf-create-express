const { DocumentOriginal, DocumentProcessed, User, Notification, DocumentHistory, Company, ClientCompany, CompanyNotification } = require('../models');
const storageService = require('../services/storageService');
const pdfProcessingService = require('../services/pdfProcessingService');
const { getCurrentUserId, getCurrentUserEmail, getCurrentUserRole } = require('../utils/helpers');
const { Op } = require('sequelize');
const archiver = require('archiver');

class DocumentController {
  async uploadDocument(req, res) {
    let document = null;
    const startTime = Date.now(); // Track processing time
    
    try {
      console.log('Upload request received');
      
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      if (req.file.mimetype !== 'application/pdf') {
        return res.status(400).json({ message: 'Only PDF files are allowed' });
      }

      // Validate file size (max 3MB)
      const maxSizeBytes = 3 * 1024 * 1024; // 3MB
      if (req.file.size > maxSizeBytes) {
        const sizeInMB = (req.file.size / (1024 * 1024)).toFixed(2);

        // Log failed upload to history
        const userId = getCurrentUserId(req);
        await DocumentHistory.logAction({
          actionType: DocumentHistory.ACTION_TYPES.UPLOAD_FAILED,
          userId: userId,
          userRole: 'Client',
          fileName: req.file.originalname,
          fileSizeBytes: req.file.size,
          errorMessage: `File size exceeds maximum limit of 3MB (${sizeInMB}MB)`
        });

        return res.status(400).json({
          message: `File size exceeds the maximum limit of 3MB. Your file is ${sizeInMB}MB.`,
          maxSize: '3MB',
          fileSize: `${sizeInMB}MB`
        });
      }

      const userId = getCurrentUserId(req);
      const userEmail = getCurrentUserEmail(req);
      const batchId = req.body.batchId || null;

      console.log(`File: ${req.file.originalname}, Size: ${req.file.size}`);

      const pdfBuffer = req.file.buffer;

      // Store original PDF in Cloudflare R2
      const originalPdfPath = await storageService.saveOriginalPdf(pdfBuffer, req.file.originalname, userEmail);

      // Create document record
      document = await DocumentOriginal.create({
        uploaderUserId: userId,
        originalFileName: req.file.originalname,
        filePath: originalPdfPath,
        fileSizeBytes: req.file.size,
        status: DocumentOriginal.STATUS.UPLOADED,
        uploadedAt: new Date(),
        uploadBatchId: batchId
      });

      // Log UPLOADED action to history
      await DocumentHistory.logAction({
        actionType: DocumentHistory.ACTION_TYPES.UPLOADED,
        documentId: document.id,
        userId: userId,
        userRole: 'Client',
        fileName: req.file.originalname,
        fileSizeBytes: req.file.size,
        batchId: batchId,
        metadata: { originalPath: originalPdfPath }
      });

      console.log('[DocumentController] ✅ STEP 1: Document record created in database (ID:', document.id, ')');

      // Process PDF (extract all text and create blank PDF)
      console.log('[DocumentController] 🔄 STEP 2: Processing PDF (extracting text and creating blank PDF)...');
      const processingResult = await pdfProcessingService.processPdf(
        pdfBuffer,
        { email: userEmail, userId: userId.toString() },
        document.originalFileName
      );
      console.log('[DocumentController] ✅ STEP 2: PDF processing completed. Output size:', processingResult.finalPdfBytes.length, 'bytes');

      // Generate RFC-based filename
      const currentUser = await User.findByPk(userId);
      let rfcPrefix = 'XXXX';
      let sequentialNumber = 1;

      if (currentUser && currentUser.rfc && currentUser.rfc.length >= 4) {
        rfcPrefix = currentUser.rfc.substring(0, 4).toUpperCase();
      }

      // Get sequential number
      const allUserDocs = await DocumentOriginal.findAll({
        where: { uploaderUserId: userId },
        order: [['uploadedAt', 'ASC'], ['id', 'ASC']]
      });
      sequentialNumber = allUserDocs.length;

      const processedFileName = `${rfcPrefix}-${sequentialNumber.toString().padStart(4, '0')}_document.pdf`;
      console.log(`[DocumentController] 📝 STEP 3: Generated processed filename: ${processedFileName}`);

      // Store processed document
      console.log('[DocumentController] 📤 STEP 4: Uploading processed PDF to R2...');
      const processedPdfPath = await storageService.saveProcessedPdf(
        processingResult.finalPdfBytes,
        processedFileName,
        userEmail
      );
      console.log('[DocumentController] ✅ STEP 4: Processed PDF uploaded to R2:', processedPdfPath);

      console.log('[DocumentController] 💾 STEP 5: Creating processed document record in database...');

      // Create processed document record
      const processedDocument = await DocumentProcessed.create({
        sourceDocumentId: document.id,
        templateRuleSetId: null,
        filePathFinalPdf: processedPdfPath,
        extractedJsonData: '{}',
        status: DocumentProcessed.STATUS.APPROVED,
        createdAt: new Date()
      });

      console.log('[DocumentController] ✅ STEP 5: Processed document saved to database (ID:', processedDocument.id, ')');
      console.log('[DocumentController] 🎉 ALL STEPS COMPLETED SUCCESSFULLY!');

      // Calculate processing time
      const processingTimeMs = Date.now() - startTime;

      // Log PROCESSED action to history
      await DocumentHistory.logAction({
        actionType: DocumentHistory.ACTION_TYPES.PROCESSED,
        documentId: document.id,
        userId: userId,
        userRole: 'Client',
        fileName: req.file.originalname,
        fileSizeBytes: req.file.size,
        batchId: batchId,
        processingTimeMs: processingTimeMs,
        metadata: {
          processedPath: processedPdfPath
        }
      });

      console.log(`[DocumentController] 📊 Processing completed in ${processingTimeMs}ms`);

      return res.status(200).json({
        documentId: document.id,
        status: 'Processed',
        message: 'Document uploaded and processed successfully'
      });
    } catch (error) {
      console.error('========================================');
      console.error('❌ UPLOAD ERROR DETAILS:');
      console.error('Error Message:', error.message);
      console.error('Error Stack:', error.stack);
      console.error('Error Name:', error.name);
      console.error('========================================');
      
      const processingTimeMs = Date.now() - startTime;
      
      // Log failure to history
      try {
        const userId = getCurrentUserId(req);
        await DocumentHistory.logAction({
          actionType: document ? DocumentHistory.ACTION_TYPES.PROCESSING_FAILED : DocumentHistory.ACTION_TYPES.UPLOAD_FAILED,
          documentId: document?.id || null,
          userId: userId,
          userRole: 'Client',
          fileName: req.file?.originalname || 'unknown',
          fileSizeBytes: req.file?.size || null,
          batchId: req.body?.batchId || null,
          processingTimeMs: processingTimeMs,
          errorMessage: error.message,
          metadata: { 
            errorStack: error.stack,
            errorName: error.name,
            errorCode: error.code
          }
        });
      } catch (historyError) {
        console.error('Failed to log error to history:', historyError.message);
      }
      
      // If document was created, mark it as REJECTED (Not fulfilled)
      if (document && document.id) {
        try {
          await document.update({ status: DocumentOriginal.STATUS.REJECTED });
          console.log(`[DocumentController] ❌ Document ${document.id} marked as REJECTED due to processing failure`);
        } catch (updateError) {
          console.error('Error updating document status:', updateError);
        }
      }
      
      return res.status(500).json({ 
        message: `Error uploading document: ${error.message}`,
        status: 'Failed',
        errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }

  async getProcessedDocuments(req, res) {
    try {
      const userRole = getCurrentUserRole(req);
      const userId = getCurrentUserId(req);
      const vendorId = req.query.vendorId ? parseInt(req.query.vendorId) : null;

      console.log(`[DocumentController] GetProcessedDocuments - Role: ${userRole}, UserId: ${userId}`);

      let processedDocuments;

      if (userRole === 'Admin') {
        // Admin sees only documents that clients have sent
        processedDocuments = await DocumentProcessed.findAll({
          where: {
            status: DocumentProcessed.STATUS.APPROVED,
            isSentToAdmin: true
          },
          include: [
            {
              model: DocumentOriginal,
              as: 'sourceDocument',
              include: [{ model: User, as: 'uploader' }]
            },
            {
              model: TemplateRuleSet,
              as: 'template'
            }
          ]
        });
      } else {
        // Clients see their own uploaded documents
        const userDocuments = await DocumentOriginal.findAll({
          where: { uploaderUserId: userId }
        });

        const documentIds = userDocuments.map(d => d.id);

        processedDocuments = await DocumentProcessed.findAll({
          where: {
            status: DocumentProcessed.STATUS.APPROVED,
            sourceDocumentId: { [Op.in]: documentIds }
          },
          include: [
            {
              model: DocumentOriginal,
              as: 'sourceDocument',
              include: [{ model: User, as: 'uploader' }]
            },
            {
              model: TemplateRuleSet,
              as: 'template'
            }
          ]
        });

        // Filter by vendorId if specified
        if (vendorId) {
          processedDocuments = processedDocuments.filter(
            d => d.sourceDocument && d.sourceDocument.uploaderUserId === vendorId
          );
        }
      }

      const documents = processedDocuments.map(doc => {
        const extractedData = JSON.parse(doc.extractedJsonData || '{}');
        
        return {
          id: doc.id,
          originalFileName: doc.sourceDocument?.originalFileName || 'N/A',
          fileSizeBytes: doc.sourceDocument?.fileSizeBytes || 0,
          status: doc.sourceDocument?.status || 1,
          uploadedAt: doc.sourceDocument?.uploadedAt,
          processedAt: doc.createdAt,
          vendorId: doc.sourceDocument?.uploader?.id,
          vendorEmail: doc.sourceDocument?.uploader?.email,
          templateId: doc.template?.id || 0,
          templateName: doc.template?.name || 'Default Template',
          extractedData: extractedData,
          isSentToAdmin: doc.isSentToAdmin || false,
          isSentToCompany: doc.isSentToCompany || false
        };
      });

      return res.status(200).json({
        documents: documents,
        totalCount: documents.length
      });
    } catch (error) {
      console.error('Get processed documents error:', error);
      return res.status(500).json({ message: `Error retrieving processed documents: ${error.message}` });
    }
  }

  async downloadProcessedDocument(req, res) {
    try {
      const id = parseInt(req.params.id);
      const userId = getCurrentUserId(req);
      const userRole = getCurrentUserRole(req);
      console.log(`[DownloadProcessedDocument] 📥 Document ID: ${id}, User Role: ${userRole}, User ID: ${userId}`);

      const processedDocument = await DocumentProcessed.findByPk(id, {
        include: [{
          model: DocumentOriginal,
          as: 'sourceDocument',
          include: [{ model: User, as: 'uploader' }]
        }]
      });

      if (!processedDocument) {
        return res.status(404).json({ message: 'Document not found' });
      }

      if (processedDocument.status !== DocumentProcessed.STATUS.APPROVED) {
        return res.status(400).json({ message: 'Document not approved' });
      }

      // Authorization and download logic by role
      let pdfBytes;
      
      if (userRole === 'Admin') {
        // Admin can download documents sent to them
        if (!processedDocument.isSentToAdmin) {
          console.log(`[DownloadProcessedDocument] ❌ Document ${id} was not sent to admin`);
          return res.status(403).json({ message: 'Document was not sent to admin' });
        }
        console.log(`[DownloadProcessedDocument] 📂 Admin downloading from sent folder`);
        pdfBytes = await storageService.getSentPdf(processedDocument.filePathFinalPdf);
      } else if (userRole === 'Company') {
        // Get company details
        const company = await Company.findOne({ where: { userId } });
        
        if (!company) {
          console.log(`[DownloadProcessedDocument] ❌ Company not found for userId ${userId}`);
          return res.status(403).json({ message: 'Company account not found' });
        }

        console.log(`[DownloadProcessedDocument] Company: ${company.name} (ID: ${company.id})`);

        // Verify document was sent to THIS specific company
        if (!processedDocument.isSentToCompany || processedDocument.sentToCompanyId !== company.id) {
          console.log(`[DownloadProcessedDocument] ❌ Authorization failed for company ${company.id}`);
          console.log(`[DownloadProcessedDocument]    Document ${id}: isSentToCompany=${processedDocument.isSentToCompany}, sentToCompanyId=${processedDocument.sentToCompanyId}`);
          return res.status(403).json({ 
            message: 'Document was not sent to your company',
            documentSentToCompanyId: processedDocument.sentToCompanyId,
            yourCompanyId: company.id
          });
        }

        console.log(`[DownloadProcessedDocument] ✅ Authorization passed - downloading from company folder`);
        pdfBytes = await storageService.getCompanyPdf(processedDocument.filePathFinalPdf, company.name);
      } else if (userRole === 'Client') {
        // Verify client owns this document
        if (processedDocument.sourceDocument?.uploaderUserId !== userId) {
          console.log(`[DownloadProcessedDocument] ❌ Client ${userId} does not own document ${id}`);
          return res.status(403).json({ message: 'You do not have permission to access this document' });
        }
        console.log(`[DownloadProcessedDocument] 📂 Client downloading own document from processed folder`);
        pdfBytes = await storageService.getProcessedPdf(processedDocument.filePathFinalPdf);
      } else {
        console.log(`[DownloadProcessedDocument] ❌ Unknown role: ${userRole}`);
        return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
      }

      // Generate filename
      let rfcPrefix = 'XXXX';
      let sequentialNumber = 1;

      if (processedDocument.sourceDocument?.uploader) {
        const uploader = processedDocument.sourceDocument.uploader;
        
        if (uploader.rfc && uploader.rfc.length >= 4) {
          rfcPrefix = uploader.rfc.substring(0, 4).toUpperCase();
        }

        // Get sequential number
        const allUserDocs = await DocumentOriginal.findAll({
          where: { uploaderUserId: uploader.id },
          order: [['uploadedAt', 'ASC'], ['id', 'ASC']]
        });

        const docIndex = allUserDocs.findIndex(d => d.id === processedDocument.sourceDocument.id);
        sequentialNumber = docIndex >= 0 ? docIndex + 1 : 1;
      }

      const fileName = `${rfcPrefix}-${sequentialNumber.toString().padStart(4, '0')}_document.pdf`;
      console.log(`[DownloadProcessedDocument] ✅ Generated filename: ${fileName}`);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(pdfBytes);
    } catch (error) {
      console.error('Download error:', error);
      return res.status(500).json({ message: `Error downloading document: ${error.message}` });
    }
  }

  async getClientReadyDocuments(req, res) {
    try {
      const userId = getCurrentUserId(req);
      const page = parseInt(req.query.page) || 1;
      const pageSize = parseInt(req.query.pageSize) || 10;

      // Get user's approved processed documents (not deleted)
      const userDocuments = await DocumentOriginal.findAll({
        where: { uploaderUserId: userId }
      });
      const documentIds = userDocuments.map(d => d.id);

      const { count, rows: processedDocuments } = await DocumentProcessed.findAndCountAll({
        where: {
          status: DocumentProcessed.STATUS.APPROVED,
          isDeletedByClient: false,
          sourceDocumentId: { [Op.in]: documentIds }
        },
        limit: pageSize,
        offset: (page - 1) * pageSize,
        order: [['createdAt', 'DESC']],
        include: [{
          model: DocumentOriginal,
          as: 'sourceDocument',
          include: [{ model: User, as: 'uploader' }]
        }]
      });

      const readyDocuments = processedDocuments.map(doc => {
        const extractedData = JSON.parse(doc.extractedJsonData || '{}');
        const vendor = doc.sourceDocument?.uploader;

        return {
          id: doc.id.toString(),
          proveedorEmail: vendor?.email || 'Unknown',
          readyAtUtc: doc.createdAt,
          uploadedAtUtc: doc.sourceDocument?.uploadedAt,
          uploadBatchId: doc.sourceDocument?.uploadBatchId,
          rfcEmisor: vendor?.rfc || 'No registrado',
          periodo: extractedData.periodo || 'N/A',
          montoTotalMxn: extractedData.monto_total || '0',
          complianceStatus: 'ListoParaEnviar'
        };
      });

      return res.status(200).json({
        items: readyDocuments,
        totalCount: count,
        page,
        pageSize,
        totalPages: Math.ceil(count / pageSize)
      });
    } catch (error) {
      console.error('Get client ready documents error:', error);
      return res.status(500).json({ message: `Error retrieving ready documents: ${error.message}` });
    }
  }

  async getClientDocumentDetail(req, res) {
    try {
      const id = parseInt(req.params.id);
      
      const processedDocument = await DocumentProcessed.findByPk(id, {
        include: [{
          model: DocumentOriginal,
          as: 'sourceDocument',
          include: [{ model: User, as: 'uploader' }]
        }]
      });

      if (!processedDocument) {
        return res.status(404).json({ message: 'Document not found' });
      }

      const extractedData = JSON.parse(processedDocument.extractedJsonData || '{}');
      const vendor = processedDocument.sourceDocument?.uploader;

      const detail = {
        id: processedDocument.id.toString(),
        proveedorEmail: vendor?.email || 'Unknown',
        readyAtUtc: processedDocument.createdAt,
        fiscalData: {
          rfcEmisor: vendor?.rfc || 'No registrado',
          periodo: extractedData.periodo || 'N/A',
          montoTotalMxn: extractedData.monto_total || '0'
        },
        documentStructure: {
          addedStandardCoverPage: true,
          addedFooterTraceability: true,
          removedExtraPages: true,
          removedInteractiveElements: true,
          structureNote: 'Carátula estándar aplicada; páginas extra eliminadas; pie de página con trazabilidad insertado.'
        },
        appliedMetadata: {
          title: 'Factura Maquila Normalizada',
          rfcEmisorField: vendor?.rfc || 'No registrado',
          periodoField: extractedData.periodo || 'N/A',
          normalizedAtUtc: processedDocument.createdAt,
          normalizedByEmail: vendor?.email || 'Unknown'
        },
        technicalCompliance: {
          isPdf: true,
          grayscale8bit: true,
          dpi300: true,
          sizeUnder3MB: processedDocument.sourceDocument?.fileSizeBytes <= (3 * 1024 * 1024),
          noInteractiveStuff: true,
          hasRequiredMetadata: true
        },
        downloadLinks: {
          pdfFinalUrl: `/api/documents/client/documents/${id}/file`,
          dataJsonUrl: `/api/documents/client/documents/${id}/data`
        }
      };

      return res.status(200).json(detail);
    } catch (error) {
      console.error('Get document detail error:', error);
      return res.status(500).json({ message: `Error retrieving document detail: ${error.message}` });
    }
  }

  async downloadClientDocumentFile(req, res) {
    try {
      const id = parseInt(req.params.id);
      const userId = getCurrentUserId(req);

      const processedDocument = await DocumentProcessed.findByPk(id, {
        include: [{
          model: DocumentOriginal,
          as: 'sourceDocument',
          include: [{ model: User, as: 'uploader' }]
        }]
      });

      if (!processedDocument) {
        return res.status(404).json({ message: 'Document not found' });
      }

      // Verify ownership
      if (processedDocument.sourceDocument?.uploaderUserId !== userId) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const pdfBytes = await storageService.getProcessedPdf(processedDocument.filePathFinalPdf);

      // Generate filename
      const currentUser = await User.findByPk(userId);
      let rfcPrefix = 'XXXX';
      let sequentialNumber = 1;

      if (currentUser && currentUser.rfc && currentUser.rfc.length >= 4) {
        rfcPrefix = currentUser.rfc.substring(0, 4).toUpperCase();
      }

      const allUserDocs = await DocumentOriginal.findAll({
        where: { uploaderUserId: userId },
        order: [['uploadedAt', 'ASC'], ['id', 'ASC']]
      });

      const docIndex = allUserDocs.findIndex(d => d.id === processedDocument.sourceDocument.id);
      sequentialNumber = docIndex >= 0 ? docIndex + 1 : 1;

      const fileName = `${rfcPrefix}-${sequentialNumber.toString().padStart(4, '0')}_document.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(pdfBytes);
    } catch (error) {
      console.error('Download client document error:', error);
      return res.status(500).json({ message: `Error downloading document: ${error.message}` });
    }
  }

  async downloadClientDocumentData(req, res) {
    try {
      const id = parseInt(req.params.id);
      
      const processedDocument = await DocumentProcessed.findByPk(id);

      if (!processedDocument) {
        return res.status(404).json({ message: 'Document not found' });
      }

      const jsonData = processedDocument.extractedJsonData;

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="document_${id}_data.json"`);
      return res.send(jsonData);
    } catch (error) {
      console.error('Download document data error:', error);
      return res.status(500).json({ message: `Error downloading document data: ${error.message}` });
    }
  }

  async downloadBatch(req, res) {
    try {
      const { documentIds } = req.body;

      if (!documentIds || documentIds.length === 0) {
        return res.status(400).json({ message: 'No document IDs provided' });
      }

      const userId = getCurrentUserId(req);
      const userRole = getCurrentUserRole(req);
      const currentUser = await User.findByPk(userId);

      let rfcPrefix = 'XXXX';
      if (currentUser && currentUser.rfc && currentUser.rfc.length >= 4) {
        rfcPrefix = currentUser.rfc.substring(0, 4).toUpperCase();
      }

      // Single document - return as PDF
      if (documentIds.length === 1) {
        const doc = await DocumentProcessed.findByPk(documentIds[0], {
          include: [{
            model: DocumentOriginal,
            as: 'sourceDocument'
          }]
        });

        if (!doc) {
          return res.status(404).json({ message: 'Document not found' });
        }

        // Admin gets from sent folder, Company from company folder, clients from processed folder
        let pdfBytes;
        if (userRole === 'Admin') {
          if (!doc.isSentToAdmin) {
            return res.status(403).json({ message: 'Document was not sent to admin' });
          }
          pdfBytes = await storageService.getSentPdf(doc.filePathFinalPdf);
        } else if (userRole === 'Company') {
          const company = await Company.findOne({ where: { userId } });
          if (!company) {
            return res.status(403).json({ message: 'Company account not found' });
          }
          // Verify document was sent to THIS company
          if (!doc.isSentToCompany || doc.sentToCompanyId !== company.id) {
            return res.status(403).json({ message: 'Document was not sent to your company' });
          }
          pdfBytes = await storageService.getCompanyPdf(doc.filePathFinalPdf, company.name);
        } else if (userRole === 'Client') {
          if (doc.sourceDocument?.uploaderUserId !== userId) {
            return res.status(403).json({ message: 'You do not have permission to access this document' });
          }
          pdfBytes = await storageService.getProcessedPdf(doc.filePathFinalPdf);
        } else {
          return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
        }
        
        const fileName = `${rfcPrefix}-0001_document.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        return res.send(pdfBytes);
      }

      // Multiple documents - return as ZIP with maximum compression
      const archive = archiver('zip', { 
        zlib: { level: 9 }, // Maximum compression level
        store: false // Always compress, never store uncompressed
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${rfcPrefix}_docs_${new Date().toISOString().split('T')[0]}.zip"`);

      archive.pipe(res);

      // Get company info once if user is a company
      let companyInfo = null;
      if (userRole === 'Company') {
        companyInfo = await Company.findOne({ where: { userId } });
      }

      for (let i = 0; i < documentIds.length; i++) {
        const doc = await DocumentProcessed.findByPk(documentIds[i], {
          include: [{
            model: DocumentOriginal,
            as: 'sourceDocument'
          }]
        });
        
        if (!doc) continue;

        // Authorization check for each document
        let pdfBytes;
        if (userRole === 'Admin') {
          if (!doc.isSentToAdmin) continue; // Skip documents not sent to admin
          pdfBytes = await storageService.getSentPdf(doc.filePathFinalPdf);
        } else if (userRole === 'Company') {
          if (!companyInfo) continue;
          // Skip documents not sent to THIS company
          if (!doc.isSentToCompany || doc.sentToCompanyId !== companyInfo.id) continue;
          pdfBytes = await storageService.getCompanyPdf(doc.filePathFinalPdf, companyInfo.name);
        } else if (userRole === 'Client') {
          // Skip documents not owned by this client
          if (doc.sourceDocument?.uploaderUserId !== userId) continue;
          pdfBytes = await storageService.getProcessedPdf(doc.filePathFinalPdf);
        } else {
          continue; // Skip for unknown roles
        }
        
        const fileName = `${rfcPrefix}-${(i + 1).toString().padStart(4, '0')}_document.pdf`;
        archive.append(pdfBytes, { name: fileName });
      }

      await archive.finalize();
    } catch (error) {
      console.error('Download batch error:', error);
      return res.status(500).json({ message: `Error downloading batch: ${error.message}` });
    }
  }

  async sendByEmail(req, res) {
    try {
      const { documentIds, toEmail, adminId, companyId } = req.body;

      console.log(`[SendByEmail] Request body:`, { documentIds, toEmail, adminId, companyId });

      if (!documentIds || documentIds.length === 0) {
        return res.status(400).json({ message: 'No document IDs provided' });
      }

      const userId = getCurrentUserId(req);
      const userRole = getCurrentUserRole(req);
      const selectedAdminId = adminId ? parseInt(adminId) : null;
      const selectedCompanyId = companyId ? parseInt(companyId) : null;
      const currentUser = await User.findByPk(userId);

      console.log(`[SendByEmail] Parsed values: adminId=${selectedAdminId}, companyId=${selectedCompanyId}, userRole=${userRole}`);

      // Determine if sending to company or admin
      const sendingToCompany = userRole === 'Client' && selectedCompanyId;

      console.log(`[SendByEmail] Sending to company: ${sendingToCompany}, Selected company ID: ${selectedCompanyId}`);

      // Get documents to copy to sent folder (include source document for metadata)
      const documents = await DocumentProcessed.findAll({
        where: { id: { [Op.in]: documentIds } },
        include: [{
          model: DocumentOriginal,
          as: 'sourceDocument'
        }]
      });

      if (documents.length === 0) {
        console.log(`[SendByEmail] ❌ No documents found for IDs: ${documentIds.join(', ')}`);
        return res.status(404).json({ message: 'No documents found for the provided IDs' });
      }

      console.log(`[SendByEmail] ✅ Found ${documents.length} documents to send`);

      // Calculate total size
      let totalSize = 0;
      for (const doc of documents) {
        if (doc.sourceDocument?.fileSizeBytes) {
          totalSize += doc.sourceDocument.fileSizeBytes;
        }
      }

      console.log(`[DocumentController] 📋 Preparing to send ${documents.length} documents (Total size: ${Math.round(totalSize / 1024)}KB)...`);

      // Copy each document to appropriate folder and log to history
      if (sendingToCompany) {
        // Get company details
        const company = await Company.findByPk(selectedCompanyId);
        
        if (!company) {
          console.log(`[SendByEmail] ❌ Company not found for ID: ${selectedCompanyId}`);
          return res.status(404).json({ message: 'Company not found' });
        }

        const companyName = company.name;
        
        console.log(`[DocumentController] 📋 Copying ${documents.length} documents to company folder: ${companyName} (ID: ${company.id})...`);
        for (const doc of documents) {
          try {
            const companyPath = await storageService.copyToCompanyFolder(doc.filePathFinalPdf, companyName);
            console.log(`[DocumentController] ✅ Document ${doc.id} copied to company folder: ${companyPath}`);
            
            // Log action to history (could add a new action type for SENT_TO_COMPANY)
            await DocumentHistory.logAction({
              actionType: DocumentHistory.ACTION_TYPES.SENT_TO_ADMIN, // Reusing for now, or create SENT_TO_COMPANY
              documentId: doc.id,
              userId: userId,
              userRole: 'Client',
              fileName: doc.sourceDocument?.originalFileName || 'unknown',
              fileSizeBytes: doc.sourceDocument?.fileSizeBytes || null,
              batchId: doc.sourceDocument?.uploadBatchId || null,
              metadata: {
                sentPath: companyPath,
                processedPath: doc.filePathFinalPdf,
                sentToCompany: companyName,
                companyId: selectedCompanyId
              }
            });
          } catch (copyError) {
            console.error(`[DocumentController] ⚠️ Failed to copy document ${doc.id} to company folder:`, copyError.message);
            // Continue with other documents even if one fails
          }
        }
      } else {
        // Sending to admin - use sent folder
        console.log(`[DocumentController] 📋 Copying ${documents.length} documents to sent folder...`);
        for (const doc of documents) {
          try {
            const sentPath = await storageService.copyToSentFolder(doc.filePathFinalPdf);
            console.log(`[DocumentController] ✅ Document ${doc.id} copied to: ${sentPath}`);
            
            // Log SENT_TO_ADMIN action to history
            await DocumentHistory.logAction({
              actionType: DocumentHistory.ACTION_TYPES.SENT_TO_ADMIN,
              documentId: doc.id,
              userId: userId,
              userRole: 'Client',
              fileName: doc.sourceDocument?.originalFileName || 'unknown',
              fileSizeBytes: doc.sourceDocument?.fileSizeBytes || null,
              batchId: doc.sourceDocument?.uploadBatchId || null,
              metadata: {
                sentPath: sentPath,
                processedPath: doc.filePathFinalPdf
              }
            });
          } catch (copyError) {
            console.error(`[DocumentController] ⚠️ Failed to copy document ${doc.id} to sent folder:`, copyError.message);
            // Continue with other documents even if one fails
          }
        }
      }

      // Mark documents as sent (to company or admin)
      if (sendingToCompany) {
        console.log(`[DocumentController] 📝 Marking ${documentIds.length} documents as sent to company ${selectedCompanyId}...`);
        console.log(`[DocumentController] Document IDs: ${documentIds.join(', ')}`);
        
        const updateResult = await DocumentProcessed.update(
          { 
            isSentToCompany: true,
            sentToCompanyId: selectedCompanyId,
            sentToCompanyAt: new Date()
          },
          {
            where: { id: { [Op.in]: documentIds } }
          }
        );

        console.log(`[DocumentController] 📝 Update result: ${updateResult[0]} rows affected`);

        // Verify the update worked
        const verifyDocs = await DocumentProcessed.findAll({
          where: { id: { [Op.in]: documentIds } },
          attributes: ['id', 'isSentToCompany', 'sentToCompanyId', 'sentToCompanyAt']
        });

        console.log(`[DocumentController] 🔍 Verification after update:`);
        verifyDocs.forEach(doc => {
          console.log(`  - Doc ${doc.id}: isSentToCompany=${doc.isSentToCompany}, sentToCompanyId=${doc.sentToCompanyId}, sentAt=${doc.sentToCompanyAt}`);
        });

        // Create notification for company
        const notification = await CompanyNotification.create({
          companyId: selectedCompanyId,
          clientUserId: userId,
          documentCount: documentIds.length,
          sentAt: new Date(),
          isRead: false,
          createdAt: new Date()
        });

        console.log(`[DocumentController] ✅ Documents sent to company ${selectedCompanyId} and notification created (ID: ${notification.id})`);
      } else {
        await DocumentProcessed.update(
          { 
            isSentToAdmin: true,
            sentToAdminAt: new Date()
          },
          {
            where: { id: { [Op.in]: documentIds } }
          }
        );

        // Create notification for admin (with selected admin if specified)
        await Notification.create({
          clientUserId: userId,
          adminUserId: selectedAdminId,
          documentCount: documentIds.length,
          sentAt: new Date(),
          isRead: false,
          createdAt: new Date()
        });

        console.log(`[DocumentController] ✅ Documents marked as sent to admin${selectedAdminId ? ` ${selectedAdminId}` : ''}`);
      }

      // Return response
      const recipientName = sendingToCompany 
        ? (await Company.findByPk(selectedCompanyId))?.name || 'company'
        : 'admin';

      return res.status(200).json({
        status: 'queued',
        to: sendingToCompany ? recipientName : (toEmail || 'admin'),
        subject: `FILE-0001 Documentos`,
        message: 'Documents sent successfully',
        documentCount: documentIds.length,
        totalSizeBytes: totalSize,
        sentTo: sendingToCompany ? 'company' : 'admin'
      });
    } catch (error) {
      console.error('Send by email error:', error);
      return res.status(500).json({ message: `Error sending documents: ${error.message}` });
    }
  }

  async deleteBatch(req, res) {
    try {
      const { documentIds } = req.body;

      if (!documentIds || documentIds.length === 0) {
        return res.status(400).json({ message: 'No document IDs provided' });
      }

      const userId = getCurrentUserId(req);
      const userRole = getCurrentUserRole(req);
      const isAdmin = userRole === 'Admin';

      let deleted = 0;

      for (const id of documentIds) {
        const processed = await DocumentProcessed.findByPk(id, {
          include: [{
            model: DocumentOriginal,
            as: 'sourceDocument'
          }]
        });

        if (!processed) continue;

        // Check ownership
        const isOwner = processed.sourceDocument?.uploaderUserId === userId;
        if (!isAdmin && !isOwner) continue;

        if (isAdmin) {
          // Admin: Hard delete
          await storageService.deleteFile(processed.filePathFinalPdf);
          
          if (processed.sourceDocument) {
            await storageService.deleteFile(processed.sourceDocument.filePath);
            await processed.sourceDocument.destroy();
          }
          
          await processed.destroy();
        } else {
          // Client: Hard delete (no history logging for client deletions)
          console.log(`[DocumentController] 🗑️ Client deleting document ${id}, cleaning up files...`);
          
          // Delete processed PDF from Cloudflare
          const deletedProcessed = await storageService.deleteFile(processed.filePathFinalPdf);
          console.log(`[DocumentController] ${deletedProcessed ? '✅' : '⚠️'} Processed PDF deleted: ${processed.filePathFinalPdf}`);
          
          // Delete original PDF from Cloudflare
          if (processed.sourceDocument) {
            const deletedOriginal = await storageService.deleteFile(processed.sourceDocument.filePath);
            console.log(`[DocumentController] ${deletedOriginal ? '✅' : '⚠️'} Original PDF deleted: ${processed.sourceDocument.filePath}`);
            
            // Hard delete source document from DB
            await processed.sourceDocument.destroy();
          }
          
          // Hard delete processed document from DB
          await processed.destroy();
        }

        deleted++;
      }

      return res.status(200).json({ deleted });
    } catch (error) {
      console.error('Delete batch error:', error);
      return res.status(500).json({ message: `Error deleting documents: ${error.message}` });
    }
  }
}

module.exports = new DocumentController();

