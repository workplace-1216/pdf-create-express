const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DocumentProcessed = sequelize.define('DocumentProcessed', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  sourceDocumentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'source_document_id',
    references: {
      model: 'document_originals',
      key: 'id'
    }
  },
  templateRuleSetId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'template_rule_set_id',
    references: {
      model: 'template_rule_sets',
      key: 'id'
    }
  },
  filePathFinalPdf: {
    type: DataTypes.STRING(500),
    allowNull: false,
    field: 'file_path_final_pdf'
  },
  extractedJsonData: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '{}',
    field: 'extracted_json_data'
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'approved_at'
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  status: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: '1=Pending, 2=Approved, 3=Rejected'
  },
  isDeletedByClient: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_deleted_by_client'
  },
  isSentToAdmin: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_sent_to_admin'
  },
  sentToAdminAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'sent_to_admin_at'
  },
  isSentToCompany: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_sent_to_company'
  },
  sentToCompanyId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'sent_to_company_id',
    references: {
      model: 'companies',
      key: 'id'
    }
  },
  sentToCompanyAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'sent_to_company_at'
  }
}, {
  tableName: 'document_processeds',
  timestamps: false
});

// Status enum
DocumentProcessed.STATUS = {
  PENDING: 1,
  APPROVED: 2,
  REJECTED: 3
};

module.exports = DocumentProcessed;

