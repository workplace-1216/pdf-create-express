const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  rfc: {
    type: DataTypes.STRING(13),
    allowNull: true
  },
  passwordHash: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'password_hash'
  },
  role: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 2, // Client
    comment: '1=Admin, 2=Client, 3=Company'
  },
  whatsappNumber: {
    type: DataTypes.STRING(20),
    allowNull: true,
    field: 'whatsapp_number',
    comment: 'WhatsApp contact number for clients (optional)'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'is_active'
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
  tableName: 'users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// Role enum helper
User.ROLES = {
  ADMIN: 1,
  CLIENT: 2,
  COMPANY: 3
};

User.getRoleName = function(roleId) {
  if (roleId === 1) return 'Admin';
  if (roleId === 2) return 'Client';
  if (roleId === 3) return 'Company';
  return 'Client';
};

module.exports = User;

