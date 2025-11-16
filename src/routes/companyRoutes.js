const express = require('express');
const router = express.Router();
const companyController = require('../controllers/companyController');
const { authenticate, authorize } = require('../middleware/auth');

// Public routes (NO authentication required)
router.post('/register', companyController.registerCompany);
router.post('/verify-otp', companyController.verifyCompanyOTP);
router.post('/resend-otp', companyController.resendCompanyOTP);
router.get('/approved', companyController.getApprovedCompanies);

// Protected routes (authentication required)
router.use(authenticate);

// Client: Manage their companies
router.get('/my-companies', authorize('Client'), companyController.getClientCompanies);
router.post('/my-companies', authorize('Client'), companyController.addCompanyToClient);
router.delete('/my-companies/:companyId', authorize('Client'), companyController.removeCompanyFromClient);

// Company: Manage received documents
router.get('/received-documents', authorize('Company'), companyController.getReceivedDocuments);
router.delete('/documents/:id', authorize('Company'), companyController.deleteReceivedDocument);

// Company: Manage users
router.get('/users', authorize('Company'), companyController.getCompanyUsers);
router.post('/users', authorize('Company'), companyController.createCompanyUser);
router.put('/users/:id', authorize('Company'), companyController.updateCompanyUser);
router.delete('/users/:id', authorize('Company'), companyController.deleteCompanyUser);

// Admin: Manage all companies
router.get('/all', authorize('Admin'), companyController.getAllCompanies);
router.post('/:id/approve', authorize('Admin'), companyController.approveCompany);
router.post('/:id/reject', authorize('Admin'), companyController.rejectCompany);
router.delete('/:id', authorize('Admin'), companyController.deleteCompany);

module.exports = router;

