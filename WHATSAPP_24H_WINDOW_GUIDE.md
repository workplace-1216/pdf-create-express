# WhatsApp 24-Hour Customer Service Window - Implementation Guide

## Overview

This implementation fully supports WhatsApp's 24-hour customer service window policy. The system tracks every incoming message from users and validates outgoing messages to ensure compliance with WhatsApp Business API policies.

## How WhatsApp's 24-Hour Window Works

- **Within 24 hours** of receiving a message from a user, you can send any freeform message
- **After 24 hours**, you can only send pre-approved **template messages**
- Each incoming message from the user **refreshes** the 24-hour window

## Files Created

### 1. Model
- `src/models/WhatsAppConversation.js` - Database model for tracking conversations

### 2. Services
- `src/services/whatsappConversationTracker.js` - Core tracking service (supports both memory and database)

### 3. Utilities
- `src/utils/whatsappWindowHelper.js` - Helper functions for window validation

### 4. Modified Files
- `src/services/whatsappService.js` - Enhanced with window validation
- `src/controllers/webhookController.js` - Now tracks incoming messages
- `src/models/index.js` - Added WhatsAppConversation model

## Configuration

Add to your `.env` file:

```env
# WhatsApp Tracking Mode: 'memory' or 'database'
WHATSAPP_TRACKING_MODE=database
```

## Usage Examples

### 1. Basic Usage - Sending Messages

```javascript
const whatsappService = require('./services/whatsappService');

// Send a document notification (automatically checks 24h window)
const result = await whatsappService.sendDocumentNotification({
  toWhatsApp: '+52 55 1234 5678',
  companyName: 'Acme Corp',
  fromName: 'John Doe',
  documentCount: 3
});

if (!result.success) {
  if (result.requiresTemplate) {
    console.log('⚠️ Need to use template message!');
    // Use sendTemplateMessage instead
  }
}
```

### 2. Checking Window Status Before Sending

```javascript
// Check if you can send a freeform message to a user
const windowStatus = await whatsappService.checkMessagingWindow('+52 55 1234 5678');

console.log('Can send freeform:', windowStatus.canSendFreeform);
console.log('Requires template:', windowStatus.requiresTemplate);
console.log('Time remaining:', windowStatus.timeRemaining);
console.log('Last message:', windowStatus.lastIncomingMessage);

if (windowStatus.canSendFreeform) {
  // Send freeform message
  await whatsappService.sendDocumentNotification({ /* ... */ });
} else {
  // Send template message
  await whatsappService.sendTemplateMessage({ /* ... */ });
}
```

### 3. Using Helper Functions Directly

```javascript
const {
  isWithin24Hours,
  getRemainingWindowTime,
  canSendMessage
} = require('./utils/whatsappWindowHelper');

// Check if timestamp is within 24 hours
const lastMessageAt = new Date('2025-01-18T10:00:00Z');
const within24h = isWithin24Hours(lastMessageAt); // true or false

// Get remaining time
const remaining = getRemainingWindowTime(lastMessageAt);
console.log(`Time left: ${remaining.formatted}`); // "15h 30m 45s"
console.log(`Expires at: ${remaining.expiresAt}`);

// Validate if message can be sent
const validation = canSendMessage(lastMessageAt, false);
if (validation.canSend) {
  console.log('✅ Can send:', validation.reason);
} else {
  console.log('❌ Cannot send:', validation.reason);
}
```

### 4. Working with Conversation Tracker

```javascript
const conversationTracker = require('./services/whatsappConversationTracker');

// Get conversation info
const info = await conversationTracker.getConversationInfo('+52 55 1234 5678');
console.log('Last message:', info.lastIncomingMessageAt);
console.log('Message count:', info.messageCount);
console.log('Within window:', info.isWithinWindow);

// Get statistics
const stats = await conversationTracker.getStats();
console.log('Total conversations:', stats.totalConversations);
console.log('Active windows:', stats.activeWindows);
console.log('Expired windows:', stats.expiredWindows);
```

### 5. Switching Between Memory and Database Mode

```javascript
const conversationTracker = require('./services/whatsappConversationTracker');

// Switch to in-memory mode (faster, but lost on restart)
conversationTracker.setTrackingMode('memory');

// Switch to database mode (persistent, recommended)
conversationTracker.setTrackingMode('database');
```

### 6. Forcing Template Messages or Skipping Validation

```javascript
// Force using a template message regardless of window
const result = await whatsappService.sendDocumentNotification({
  toWhatsApp: '+52 55 1234 5678',
  companyName: 'Acme Corp',
  fromName: 'John Doe',
  documentCount: 3,
  forceTemplate: true  // Forces template logic
});

// Skip window validation entirely (not recommended)
const result2 = await whatsappService.sendDocumentNotification({
  toWhatsApp: '+52 55 1234 5678',
  companyName: 'Acme Corp',
  fromName: 'John Doe',
  documentCount: 3,
  skipWindowCheck: true  // Bypasses validation
});
```

## Webhook Integration

The webhook controller automatically tracks incoming messages:

```javascript
// In webhookController.js - this is already implemented
async handleIncomingMessage(message) {
  const messageId = message.id;
  const from = message.from;
  const timestamp = message.timestamp;

  // Automatically tracks the message and opens/refreshes 24h window
  await conversationTracker.trackIncomingMessage(from, messageId, messageDate);

  // Your custom logic here...
}
```

## Database Migration

Run your database sync to create the new table:

```javascript
const { syncDatabase } = require('./models');
await syncDatabase();
```

Or manually create the table:

```sql
CREATE TABLE whatsapp_conversations (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(50) UNIQUE NOT NULL,
  last_incoming_message_at TIMESTAMP NOT NULL,
  last_message_id VARCHAR(255),
  conversation_status VARCHAR(20) DEFAULT 'active',
  message_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_phone_number ON whatsapp_conversations(phone_number);
CREATE INDEX idx_last_message_at ON whatsapp_conversations(last_incoming_message_at);
```

## API Response Examples

### Success Response (Within Window)
```json
{
  "success": true,
  "messageId": "wamid.HBgNMTIzNDU2Nzg5MA==",
  "recipientNumber": "5215512345678"
}
```

### Error Response (Window Expired)
```json
{
  "success": false,
  "error": "24-hour window expired. Use a template message.",
  "requiresTemplate": true,
  "suggestion": "Use sendTemplateMessage() or set forceTemplate: true"
}
```

### Window Status Response
```json
{
  "phoneNumber": "5215512345678",
  "canSendFreeform": true,
  "requiresTemplate": false,
  "lastIncomingMessage": "2025-01-18T10:00:00.000Z",
  "windowStatus": "Within 24-hour window. Time remaining: 15h 30m 45s",
  "timeRemaining": "15h 30m 45s",
  "expiresAt": "2025-01-19T10:00:00.000Z"
}
```

## Best Practices

1. **Always check the window** before sending freeform messages
2. **Use database mode** in production for data persistence
3. **Handle validation errors** gracefully and fallback to templates
4. **Monitor conversation stats** to understand user engagement
5. **Test your webhook** to ensure incoming messages are tracked

## Testing

```javascript
// Test the 24-hour window logic
const conversationTracker = require('./services/whatsappConversationTracker');

// Simulate an incoming message
await conversationTracker.trackIncomingMessage(
  '5215512345678',
  'test-message-id',
  new Date()
);

// Check if within window
const within = await conversationTracker.isWithinWindow('5215512345678');
console.log('Within window:', within); // Should be true

// Test with old timestamp (25 hours ago)
const oldDate = new Date(Date.now() - (25 * 60 * 60 * 1000));
await conversationTracker.trackIncomingMessage(
  '5219876543210',
  'old-message-id',
  oldDate
);

const withinOld = await conversationTracker.isWithinWindow('5219876543210');
console.log('Within window (old):', withinOld); // Should be false
```

## Troubleshooting

### Issue: Messages not tracking
- Verify webhook is receiving incoming messages
- Check console logs for `[WhatsAppTracker]` messages
- Ensure database connection is working (if using database mode)

### Issue: Window validation failing
- Verify user has sent at least one message first
- Check timestamp format in webhook payload
- Use `checkMessagingWindow()` to debug window status

### Issue: Database errors
- Run `syncDatabase()` to create the table
- Verify PostgreSQL connection
- Check for schema conflicts

## Advanced: Custom Tracking Logic

You can extend the tracker for custom needs:

```javascript
// Example: Get all active conversations
const { WhatsAppConversation } = require('./models');
const { Op } = require('sequelize');

const twentyFourHoursAgo = new Date(Date.now() - (24 * 60 * 60 * 1000));

const activeConversations = await WhatsAppConversation.findAll({
  where: {
    lastIncomingMessageAt: {
      [Op.gte]: twentyFourHoursAgo
    }
  }
});

console.log(`${activeConversations.length} active conversations`);
```

## Support

For WhatsApp Business API documentation:
- [Message Templates](https://developers.facebook.com/docs/whatsapp/message-templates)
- [Pricing & Conversations](https://developers.facebook.com/docs/whatsapp/pricing#conversations)
- [Webhook Setup](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks)
