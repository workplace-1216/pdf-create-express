const WhatsAppConversation = require('../models/WhatsAppConversation');
const { cleanPhoneNumber, isWithin24Hours } = require('../utils/whatsappWindowHelper');

/**
 * WhatsApp Conversation Tracker Service
 *
 * Provides both in-memory and database-backed tracking of WhatsApp conversations
 * to enforce the 24-hour customer service window policy.
 *
 * Usage:
 * - Use setTrackingMode('memory') for in-memory tracking (fast, but lost on restart)
 * - Use setTrackingMode('database') for persistent tracking (default, recommended)
 */
class WhatsAppConversationTracker {
  constructor() {
    // In-memory storage: Map of phoneNumber -> { lastMessageAt, messageId, count }
    this.conversations = new Map();

    // Tracking mode: 'memory' or 'database'
    this.trackingMode = process.env.WHATSAPP_TRACKING_MODE || 'database';

    console.log(`[WhatsAppTracker] Initialized with tracking mode: ${this.trackingMode}`);
  }

  /**
   * Set the tracking mode
   * @param {string} mode - 'memory' or 'database'
   */
  setTrackingMode(mode) {
    if (mode !== 'memory' && mode !== 'database') {
      throw new Error('Invalid tracking mode. Use "memory" or "database"');
    }
    this.trackingMode = mode;
    console.log(`[WhatsAppTracker] Tracking mode changed to: ${mode}`);
  }

  /**
   * Track an incoming message from a user
   * @param {string} phoneNumber - User's WhatsApp number
   * @param {string} messageId - WhatsApp message ID
   * @param {Date} timestamp - Message timestamp (optional, defaults to now)
   */
  async trackIncomingMessage(phoneNumber, messageId, timestamp = new Date()) {
    const cleanNumber = cleanPhoneNumber(phoneNumber);

    if (this.trackingMode === 'memory') {
      return this._trackInMemory(cleanNumber, messageId, timestamp);
    } else {
      return this._trackInDatabase(cleanNumber, messageId, timestamp);
    }
  }

  /**
   * Get the last message timestamp for a user
   * @param {string} phoneNumber - User's WhatsApp number
   * @returns {Promise<Date|null>} - Last message timestamp or null
   */
  async getLastMessageTimestamp(phoneNumber) {
    const cleanNumber = cleanPhoneNumber(phoneNumber);

    if (this.trackingMode === 'memory') {
      return this._getFromMemory(cleanNumber);
    } else {
      return this._getFromDatabase(cleanNumber);
    }
  }

  /**
   * Check if a user is within the 24-hour window
   * @param {string} phoneNumber - User's WhatsApp number
   * @returns {Promise<boolean>} - True if within 24 hours
   */
  async isWithinWindow(phoneNumber) {
    const lastMessageAt = await this.getLastMessageTimestamp(phoneNumber);
    return isWithin24Hours(lastMessageAt);
  }

  /**
   * Get conversation info for a user
   * @param {string} phoneNumber - User's WhatsApp number
   * @returns {Promise<Object|null>} - Conversation info or null
   */
  async getConversationInfo(phoneNumber) {
    const cleanNumber = cleanPhoneNumber(phoneNumber);

    if (this.trackingMode === 'memory') {
      const data = this.conversations.get(cleanNumber);
      if (!data) return null;

      return {
        phoneNumber: cleanNumber,
        lastIncomingMessageAt: data.lastMessageAt,
        lastMessageId: data.messageId,
        messageCount: data.count,
        isWithinWindow: isWithin24Hours(data.lastMessageAt)
      };
    } else {
      const conversation = await WhatsAppConversation.findOne({
        where: { phoneNumber: cleanNumber }
      });

      if (!conversation) return null;

      return {
        phoneNumber: conversation.phoneNumber,
        lastIncomingMessageAt: conversation.lastIncomingMessageAt,
        lastMessageId: conversation.lastMessageId,
        messageCount: conversation.messageCount,
        isWithinWindow: isWithin24Hours(conversation.lastIncomingMessageAt)
      };
    }
  }

  /**
   * Clear all conversation data (useful for testing)
   * WARNING: This will delete all tracking data!
   */
  async clearAll() {
    if (this.trackingMode === 'memory') {
      this.conversations.clear();
      console.log('[WhatsAppTracker] In-memory conversations cleared');
    } else {
      await WhatsAppConversation.destroy({ where: {} });
      console.log('[WhatsAppTracker] Database conversations cleared');
    }
  }

  /**
   * Get statistics about conversations
   * @returns {Promise<Object>} - Statistics
   */
  async getStats() {
    if (this.trackingMode === 'memory') {
      const now = new Date();
      let activeCount = 0;
      let expiredCount = 0;

      this.conversations.forEach((data) => {
        if (isWithin24Hours(data.lastMessageAt)) {
          activeCount++;
        } else {
          expiredCount++;
        }
      });

      return {
        totalConversations: this.conversations.size,
        activeWindows: activeCount,
        expiredWindows: expiredCount,
        trackingMode: 'memory'
      };
    } else {
      const total = await WhatsAppConversation.count();
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));

      const active = await WhatsAppConversation.count({
        where: {
          lastIncomingMessageAt: {
            [require('sequelize').Op.gte]: twentyFourHoursAgo
          }
        }
      });

      return {
        totalConversations: total,
        activeWindows: active,
        expiredWindows: total - active,
        trackingMode: 'database'
      };
    }
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Track message in memory
   * @private
   */
  _trackInMemory(phoneNumber, messageId, timestamp) {
    const existing = this.conversations.get(phoneNumber);

    if (existing) {
      existing.lastMessageAt = timestamp;
      existing.messageId = messageId;
      existing.count++;
      console.log(`[WhatsAppTracker] Updated conversation for ${phoneNumber} (count: ${existing.count})`);
    } else {
      this.conversations.set(phoneNumber, {
        lastMessageAt: timestamp,
        messageId: messageId,
        count: 1
      });
      console.log(`[WhatsAppTracker] New conversation started for ${phoneNumber}`);
    }

    return {
      success: true,
      phoneNumber,
      lastMessageAt: timestamp
    };
  }

  /**
   * Track message in database
   * @private
   */
  async _trackInDatabase(phoneNumber, messageId, timestamp) {
    try {
      const [conversation, created] = await WhatsAppConversation.findOrCreate({
        where: { phoneNumber },
        defaults: {
          phoneNumber,
          lastIncomingMessageAt: timestamp,
          lastMessageId: messageId,
          conversationStatus: 'active',
          messageCount: 1
        }
      });

      if (!created) {
        // Update existing conversation
        conversation.lastIncomingMessageAt = timestamp;
        conversation.lastMessageId = messageId;
        conversation.conversationStatus = 'active';
        conversation.messageCount++;
        await conversation.save();

        console.log(`[WhatsAppTracker] Updated conversation for ${phoneNumber} (count: ${conversation.messageCount})`);
      } else {
        console.log(`[WhatsAppTracker] New conversation started for ${phoneNumber}`);
      }

      return {
        success: true,
        phoneNumber,
        lastMessageAt: timestamp
      };
    } catch (error) {
      console.error('[WhatsAppTracker] Error tracking message in database:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get last message from memory
   * @private
   */
  _getFromMemory(phoneNumber) {
    const data = this.conversations.get(phoneNumber);
    return data ? data.lastMessageAt : null;
  }

  /**
   * Get last message from database
   * @private
   */
  async _getFromDatabase(phoneNumber) {
    try {
      const conversation = await WhatsAppConversation.findOne({
        where: { phoneNumber }
      });

      return conversation ? conversation.lastIncomingMessageAt : null;
    } catch (error) {
      console.error('[WhatsAppTracker] Error getting conversation from database:', error);
      return null;
    }
  }
}

// Export singleton instance
module.exports = new WhatsAppConversationTracker();
