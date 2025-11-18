const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * WhatsAppConversation Model
 * Tracks the last incoming message timestamp from each WhatsApp user
 * Used to enforce WhatsApp's 24-hour customer service window policy
 */
const WhatsAppConversation = sequelize.define('WhatsAppConversation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  phoneNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    comment: 'User WhatsApp phone number (cleaned, e.g., 5215512345678)'
  },
  lastIncomingMessageAt: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'Timestamp of the last incoming message from this user'
  },
  lastMessageId: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'WhatsApp message ID of the last incoming message'
  },
  conversationStatus: {
    type: DataTypes.ENUM('active', 'expired'),
    defaultValue: 'active',
    comment: 'Whether the 24-hour window is still active'
  },
  messageCount: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    comment: 'Total number of incoming messages from this user'
  }
}, {
  tableName: 'whatsapp_conversations',
  timestamps: true, // Adds createdAt and updatedAt
  indexes: [
    {
      fields: ['phoneNumber']
    },
    {
      fields: ['lastIncomingMessageAt']
    }
  ]
});

module.exports = WhatsAppConversation;
