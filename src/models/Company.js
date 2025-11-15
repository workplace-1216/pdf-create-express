const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Company = sequelize.define('Company', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  rfc: {
    type: DataTypes.STRING(13),
    allowNull: false,
    unique: true
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  whatsappNumber: {
    type: DataTypes.STRING(20),
    allowNull: false,
    field: 'whatsapp_number',
    comment: 'WhatsApp contact number for company (required)'
  },
  passwordHash: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'password_hash',
    comment: 'Temporary password hash until company is approved'
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true, // Nullable until approved
    field: 'user_id',
    references: {
      model: 'users',
      key: 'id'
    },
    comment: 'User account for company login (created when approved)'
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'pending',
    comment: 'pending, approved, rejected'
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'approved_at'
  },
  approvedByAdminId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'approved_by_admin_id',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  rejectionReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'rejection_reason',
    comment: 'Reason for rejection if status is rejected'
  },
  isEmailVerified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_email_verified',
    comment: '2FA: Whether the company has verified their email with OTP during registration'
  },
  otpCode: {
    type: DataTypes.STRING(6),
    allowNull: true,
    field: 'otp_code',
    comment: '2FA: 6-digit OTP code for email verification during registration'
  },
  otpExpiry: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'otp_expiry',
    comment: '2FA: Expiry time for the OTP code'
  },
  otpAttempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'otp_attempts',
    comment: '2FA: Number of failed OTP verification attempts during registration'
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    field: 'updated_at'
  }
}, {
  tableName: 'companies',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// Status enum
Company.STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected'
};

module.exports = Company;

