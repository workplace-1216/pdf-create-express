const axios = require('axios');
const conversationTracker = require('./whatsappConversationTracker');
const { canSendMessage, getRemainingWindowTime, cleanPhoneNumber } = require('../utils/whatsappWindowHelper');

class WhatsAppService {
  constructor() {
    // Initialize WhatsApp Cloud API configuration
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    this.businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    this.apiVersion = process.env.WHATSAPP_API_VERSION || 'v22.0';
    this.apiUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    this.initializeWhatsApp();
  }

  initializeWhatsApp() {
    if (this.accessToken && this.phoneNumberId) {
      console.log('✅ WhatsApp Cloud API service initialized');
      console.log(`   Phone Number ID: ${this.phoneNumberId}`);
    } else {
      console.warn('⚠️ WhatsApp service not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env');
    }
  }

  /**
   * Send document notification to company via WhatsApp
   * @param {Object} params - WhatsApp parameters
   * @param {string} params.toWhatsApp - Company WhatsApp number (with country code, e.g., "5215512345678")
   * @param {string} params.companyName - Company name
   * @param {string} params.fromName - Client name or email
   * @param {number} params.documentCount - Number of documents
   * @param {boolean} params.forceTemplate - Force using template message (optional, default: false)
   * @param {boolean} params.skipWindowCheck - Skip 24-hour window validation (optional, default: false)
   * @returns {Promise<Object>} - WhatsApp send result
   */
  async sendDocumentNotification({ toWhatsApp, companyName, fromName, documentCount, forceTemplate = false, skipWindowCheck = false }) {
    if (!this.accessToken || !this.phoneNumberId) {
      console.warn('⚠️ WhatsApp service not configured. Message not sent.');
      return { success: false, message: 'WhatsApp service not configured' };
    }

    try {
      // Clean phone number (remove + and spaces)
      const cleanNumber = cleanPhoneNumber(toWhatsApp);

      console.log(`[WhatsAppService] 📱 Preparing to send WhatsApp message to ${cleanNumber}...`);

      // Check 24-hour window unless skipWindowCheck is true
      if (!skipWindowCheck) {
        const lastMessageAt = await conversationTracker.getLastMessageTimestamp(cleanNumber);
        const validation = canSendMessage(lastMessageAt, forceTemplate);

        console.log(`[WhatsAppService] 🕐 Window Status: ${validation.reason}`);

        if (!validation.canSend) {
          console.warn(`[WhatsAppService] ⚠️ Cannot send message: ${validation.reason}`);
          return {
            success: false,
            error: validation.reason,
            requiresTemplate: validation.requiresTemplate,
            suggestion: 'Use sendTemplateMessage() or set forceTemplate: true'
          };
        }

        if (validation.expiresAt) {
          console.log(`[WhatsAppService] ⏰ Window expires at: ${validation.expiresAt.toISOString()}`);
        }
      } else {
        console.log(`[WhatsAppService] ⚠️ Skipping 24-hour window check (skipWindowCheck: true)`);
      }

      // Compose message
      const message = this._composeDocumentMessage(companyName, fromName, documentCount);

      // Send via WhatsApp Cloud API
      const response = await axios.post(
        this.apiUrl,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanNumber,
          type: 'text',
          text: {
            preview_url: true,
            body: message
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[WhatsAppService] ✅ WhatsApp message sent successfully! Message ID: ${response.data.messages[0].id}`);

      return {
        success: true,
        messageId: response.data.messages[0].id,
        recipientNumber: cleanNumber
      };
    } catch (error) {
      console.error('[WhatsAppService] ❌ Error sending WhatsApp message:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  /**
   * Compose document notification message
   * @private
   */
  _composeDocumentMessage(companyName, fromName, documentCount) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const dashboardUrl = `${frontendUrl}/company/dashboard`;

    return `📄 *Nuevos Documentos*

Hola *${companyName}*,

Has recibido *${documentCount}* ${documentCount === 1 ? 'documento' : 'documentos'} de *${fromName}*.

📎 Los documentos están disponibles en tu panel de empresa.

👉 Ver documentos: ${dashboardUrl}

_Este es un mensaje automático del Portal PDF._`;
  }

  /**
   * Send template message (for pre-approved templates)
   * @param {Object} params - Template parameters
   * @param {string} params.toWhatsApp - Recipient WhatsApp number
   * @param {string} params.templateName - Template name from Meta
   * @param {string} params.languageCode - Template language (e.g., 'es', 'en')
   * @param {Array} params.components - Template components with variables
   * @returns {Promise<Object>} - WhatsApp send result
   */
  async sendTemplateMessage({ toWhatsApp, templateName, languageCode = 'es', components = [] }) {
    if (!this.accessToken || !this.phoneNumberId) {
      console.warn('⚠️ WhatsApp service not configured. Template message not sent.');
      return { success: false, message: 'WhatsApp service not configured' };
    }

    try {
      const cleanNumber = toWhatsApp.replace(/[\s+()-]/g, '');

      console.log(`[WhatsAppService] 📱 Sending WhatsApp template "${templateName}" to ${cleanNumber}...`);

      const response = await axios.post(
        this.apiUrl,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanNumber,
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: languageCode
            },
            components: components
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[WhatsAppService] ✅ WhatsApp template sent successfully! Message ID: ${response.data.messages[0].id}`);

      return {
        success: true,
        messageId: response.data.messages[0].id,
        recipientNumber: cleanNumber
      };
    } catch (error) {
      console.error('[WhatsAppService] ❌ Error sending WhatsApp template:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message
      };
    }
  }

  /**
   * Test WhatsApp configuration
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    if (!this.accessToken || !this.phoneNumberId) {
      console.error('❌ WhatsApp not configured');
      return false;
    }

    try {
      // Test by checking phone number details
      const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}`;
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      console.log('✅ WhatsApp connection verified');
      console.log(`   Display Name: ${response.data.display_phone_number}`);
      console.log(`   Quality Rating: ${response.data.quality_rating}`);
      return true;
    } catch (error) {
      console.error('❌ WhatsApp connection failed:', error.response?.data?.error?.message || error.message);
      return false;
    }
  }

  /**
   * Check if a recipient is within the 24-hour messaging window
   * @param {string} phoneNumber - Recipient WhatsApp number
   * @returns {Promise<Object>} - Window status information
   */
  async checkMessagingWindow(phoneNumber) {
    const cleanNumber = cleanPhoneNumber(phoneNumber);
    const lastMessageAt = await conversationTracker.getLastMessageTimestamp(cleanNumber);
    const validation = canSendMessage(lastMessageAt, false);
    const remaining = getRemainingWindowTime(lastMessageAt);

    return {
      phoneNumber: cleanNumber,
      canSendFreeform: validation.canSend,
      requiresTemplate: validation.requiresTemplate,
      lastIncomingMessage: lastMessageAt,
      windowStatus: validation.reason,
      timeRemaining: remaining.formatted,
      expiresAt: remaining.expiresAt
    };
  }

  /**
   * Get conversation information for a recipient
   * @param {string} phoneNumber - Recipient WhatsApp number
   * @returns {Promise<Object|null>} - Conversation info or null
   */
  async getConversationInfo(phoneNumber) {
    const cleanNumber = cleanPhoneNumber(phoneNumber);
    return await conversationTracker.getConversationInfo(cleanNumber);
  }

  /**
   * Get statistics about all conversations
   * @returns {Promise<Object>} - Conversation statistics
   */
  async getConversationStats() {
    return await conversationTracker.getStats();
  }
}

module.exports = new WhatsAppService();
