const { sequelize, testConnection } = require('../config/database');
const User = require('./User');
const DocumentOriginal = require('./DocumentOriginal');
const DocumentProcessed = require('./DocumentProcessed');
const TemplateRuleSet = require('./TemplateRuleSet');
const Notification = require('./Notification');
const DocumentHistory = require('./DocumentHistory');
const Company = require('./Company');
const ClientCompany = require('./ClientCompany');
const CompanyNotification = require('./CompanyNotification');
const AdminNotification = require('./AdminNotification');
const CompanyReceivedDocument = require('./CompanyReceivedDocument');
const WhatsAppConversation = require('./WhatsAppConversation');

// Define associations
User.hasMany(DocumentOriginal, { foreignKey: 'uploaderUserId', as: 'uploadedDocuments' });
DocumentOriginal.belongsTo(User, { foreignKey: 'uploaderUserId', as: 'uploader' });

DocumentOriginal.hasMany(DocumentProcessed, { foreignKey: 'sourceDocumentId', as: 'processedDocuments' });
DocumentProcessed.belongsTo(DocumentOriginal, { foreignKey: 'sourceDocumentId', as: 'sourceDocument' });

TemplateRuleSet.belongsTo(User, { foreignKey: 'createdByUserId', as: 'creator' });
User.hasMany(TemplateRuleSet, { foreignKey: 'createdByUserId', as: 'templates' });

DocumentProcessed.belongsTo(TemplateRuleSet, { foreignKey: 'templateRuleSetId', as: 'template' });
TemplateRuleSet.hasMany(DocumentProcessed, { foreignKey: 'templateRuleSetId', as: 'processedDocuments' });

Notification.belongsTo(User, { foreignKey: 'clientUserId', as: 'clientUser' });
User.hasMany(Notification, { foreignKey: 'clientUserId', as: 'notifications' });

DocumentHistory.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(DocumentHistory, { foreignKey: 'userId', as: 'documentHistory' });

// Company associations
Company.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasOne(Company, { foreignKey: 'userId', as: 'company' });

Company.belongsTo(User, { foreignKey: 'approvedByAdminId', as: 'approvedByAdmin' });

// Client-Company many-to-many
User.belongsToMany(Company, { through: ClientCompany, foreignKey: 'clientUserId', as: 'companies' });
Company.belongsToMany(User, { through: ClientCompany, foreignKey: 'companyId', as: 'clients' });

// ClientCompany direct associations (needed for include queries)
ClientCompany.belongsTo(User, { foreignKey: 'clientUserId', as: 'client' });
ClientCompany.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });

// Document-Company associations
DocumentProcessed.belongsTo(Company, { foreignKey: 'sentToCompanyId', as: 'sentToCompany' });
Company.hasMany(DocumentProcessed, { foreignKey: 'sentToCompanyId', as: 'receivedDocuments' });

// Company notification associations
CompanyNotification.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
Company.hasMany(CompanyNotification, { foreignKey: 'companyId', as: 'notifications' });

CompanyNotification.belongsTo(User, { foreignKey: 'clientUserId', as: 'clientUser' });
User.hasMany(CompanyNotification, { foreignKey: 'clientUserId', as: 'companyNotifications' });

// Admin notification associations
AdminNotification.belongsTo(User, { foreignKey: 'relatedUserId', as: 'relatedUser' });
AdminNotification.belongsTo(Company, { foreignKey: 'relatedCompanyId', as: 'relatedCompany' });

// Company received documents associations (junction table)
CompanyReceivedDocument.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
Company.hasMany(CompanyReceivedDocument, { foreignKey: 'companyId', as: 'receivedDocumentRecords' });

CompanyReceivedDocument.belongsTo(DocumentProcessed, { foreignKey: 'documentProcessedId', as: 'documentProcessed' });
DocumentProcessed.hasMany(CompanyReceivedDocument, { foreignKey: 'documentProcessedId', as: 'companyReceipts' });

// Sync database (create tables if they don't exist)
const syncDatabase = async () => {
  try {
    await sequelize.sync({ alter: false }); // Set to true only in development if you want auto-migration
    console.log('✓ Database models synchronized');
  } catch (error) {
    console.error('✗ Error synchronizing database:', error);
  }
};

module.exports = {
  sequelize,
  testConnection,
  syncDatabase,
  User,
  DocumentOriginal,
  DocumentProcessed,
  TemplateRuleSet,
  Notification,
  DocumentHistory,
  Company,
  ClientCompany,
  CompanyNotification,
  AdminNotification,
  CompanyReceivedDocument,
  WhatsAppConversation
};

