/**
 * WhatsApp Webhook Controller
 * Handles webhook verification and incoming events from WhatsApp Cloud API
 */

const conversationTracker = require('../services/whatsappConversationTracker');

class WebhookController {
  /**
   * Verify webhook endpoint (GET request)
   * Meta will call this to verify your webhook URL
   *
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  verifyWebhook(req, res) {
    try {
      // Get verification parameters from query string
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      console.log('[WhatsApp Webhook] Verification request received');
      console.log(`[WhatsApp Webhook] Mode: ${mode}`);
      console.log(`[WhatsApp Webhook] Token: ${token}`);
      console.log(`[WhatsApp Webhook] Challenge: ${challenge}`);

      // Get verify token from environment
      const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'your_verify_token_here';

      // Check if mode and token are valid
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('[WhatsApp Webhook] ✅ Webhook verified successfully');

        // Respond with challenge to verify the webhook
        return res.status(200).send(challenge);
      } else {
        console.error('[WhatsApp Webhook] ❌ Verification failed - Invalid token');
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Verification token mismatch'
        });
      }
    } catch (error) {
      console.error('[WhatsApp Webhook] ❌ Verification error:', error);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: error.message
      });
    }
  }

  /**
   * Handle incoming webhook events (POST request)
   * Receives delivery receipts, message status updates, etc.
   *
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  handleWebhookEvent(req, res) {
    try {
      const body = req.body;

      console.log('[WhatsApp Webhook] 📨 Incoming webhook event');
      console.log('[WhatsApp Webhook] Event data:', JSON.stringify(body, null, 2));

      // Respond immediately to acknowledge receipt (required by Meta)
      res.status(200).json({ status: 'received' });

      // Check if this is a WhatsApp status update
      if (body.object === 'whatsapp_business_account') {
        // Process each entry in the webhook
        body.entry?.forEach(entry => {
          // Get changes from entry
          entry.changes?.forEach(change => {
            // Check if this is a message status change
            if (change.field === 'messages') {
              const value = change.value;

              // Handle message statuses
              if (value.statuses) {
                value.statuses.forEach(status => {
                  this.handleMessageStatus(status);
                });
              }

              // Handle incoming messages (if you want to receive messages)
              if (value.messages) {
                value.messages.forEach(message => {
                  this.handleIncomingMessage(message);
                });
              }
            }
          });
        });
      }
    } catch (error) {
      console.error('[WhatsApp Webhook] ❌ Error processing webhook:', error);
      // Still return 200 to prevent Meta from retrying
      return res.status(200).json({ status: 'error', message: error.message });
    }
  }

  /**
   * Handle message status updates
   * Statuses: sent, delivered, read, failed
   *
   * @param {Object} status - Status object from webhook
   */
  handleMessageStatus(status) {
    const messageId = status.id;
    const recipientId = status.recipient_id;
    const statusType = status.status;
    const timestamp = status.timestamp;

    console.log('[WhatsApp Webhook] 📊 Message Status Update:');
    console.log(`  Message ID: ${messageId}`);
    console.log(`  Recipient: ${recipientId}`);
    console.log(`  Status: ${statusType}`);
    console.log(`  Timestamp: ${timestamp}`);

    // Handle different status types
    switch (statusType) {
      case 'sent':
        console.log(`[WhatsApp Webhook] ✅ Message ${messageId} sent successfully`);
        // TODO: Update database to mark message as sent
        break;

      case 'delivered':
        console.log(`[WhatsApp Webhook] ✅ Message ${messageId} delivered`);
        // TODO: Update database to mark message as delivered
        break;

      case 'read':
        console.log(`[WhatsApp Webhook] ✅ Message ${messageId} read by recipient`);
        // TODO: Update database to mark message as read
        break;

      case 'failed':
        console.error(`[WhatsApp Webhook] ❌ Message ${messageId} failed`);
        if (status.errors) {
          status.errors.forEach(error => {
            console.error(`  Error: ${error.title} - ${error.message}`);
          });
        }
        // TODO: Update database to mark message as failed
        break;

      default:
        console.log(`[WhatsApp Webhook] ℹ️ Unknown status: ${statusType}`);
    }
  }

  /**
   * Handle incoming messages from users
   * (Optional - only if you want to receive replies)
   *
   * @param {Object} message - Message object from webhook
   */
  async handleIncomingMessage(message) {
    const messageId = message.id;
    const from = message.from;
    const timestamp = message.timestamp;
    const type = message.type;

    console.log('[WhatsApp Webhook] 📥 Incoming Message:');
    console.log(`  Message ID: ${messageId}`);
    console.log(`  From: ${from}`);
    console.log(`  Type: ${type}`);
    console.log(`  Timestamp: ${timestamp}`);

    // Track this incoming message to open/refresh the 24-hour window
    try {
      const messageDate = timestamp ? new Date(parseInt(timestamp) * 1000) : new Date();
      await conversationTracker.trackIncomingMessage(from, messageId, messageDate);
      console.log(`[WhatsApp Webhook] ✅ 24-hour window opened/refreshed for ${from}`);
    } catch (error) {
      console.error('[WhatsApp Webhook] ❌ Error tracking conversation:', error);
    }

    // Handle different message types
    if (type === 'text' && message.text) {
      console.log(`  Text: ${message.text.body}`);
      // TODO: Process incoming text message
      // You can add auto-reply logic here if needed
    }

    // You can handle other types: image, document, audio, video, etc.
  }
}

module.exports = new WebhookController();
