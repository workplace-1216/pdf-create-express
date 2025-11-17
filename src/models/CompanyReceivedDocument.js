const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Junction table to track which documents were sent to which companies
 * This allows:
 * - One document to be sent to multiple companies
 * - Each company to independently delete their copy
 * - Client to delete source document without affecting company copies
 */
const CompanyReceivedDocument = sequelize.define('CompanyReceivedDocument', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  companyId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'company_id',
    references: {
      model: 'companies',
      key: 'id'
    }
  },
  documentProcessedId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'document_processed_id',
    references: {
      model: 'document_processeds',
      key: 'id'
    }
  },
  clientEmail: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'client_email',
    comment: 'Email of the client who sent this document'
  },
  sentAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'sent_at'
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'company_received_documents',
  timestamps: false
});

module.exports = CompanyReceivedDocument;
