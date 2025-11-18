# WhatsApp 24-Hour Window - Implementation Summary

## What Was Implemented

A complete, production-ready implementation of WhatsApp's 24-hour customer service window policy for your Node.js backend.

## Files Created

### 1. Database Model
**`src/models/WhatsAppConversation.js`**
- Sequelize model for tracking conversations
- Stores: phone number, last message timestamp, message ID, status, count
- Indexed for performance

### 2. Conversation Tracker Service
**`src/services/whatsappConversationTracker.js`**
- **Supports two modes**: in-memory (fast) and database (persistent)
- Tracks incoming messages automatically
- Provides window validation
- Exports singleton instance

**Key methods:**
```javascript
await conversationTracker.trackIncomingMessage(phoneNumber, messageId, timestamp)
await conversationTracker.getLastMessageTimestamp(phoneNumber)
await conversationTracker.isWithinWindow(phoneNumber)
await conversationTracker.getConversationInfo(phoneNumber)
await conversationTracker.getStats()
conversationTracker.setTrackingMode('memory' | 'database')
```

### 3. Window Helper Utilities
**`src/utils/whatsappWindowHelper.js`**
- Pure functions for window calculations
- No dependencies on database or services

**Key functions:**
```javascript
isWithin24Hours(lastMessageAt: Date): boolean
getRemainingWindowTime(lastMessageAt: Date): Object
canSendMessage(lastMessageAt: Date, isTemplate: boolean): Object
cleanPhoneNumber(phoneNumber: string): string
```

### 4. Enhanced WhatsApp Service
**`src/services/whatsappService.js`** (Modified)

**New features:**
- Automatic 24-hour window validation before sending
- New optional parameters: `forceTemplate`, `skipWindowCheck`
- New methods:
  ```javascript
  await whatsappService.checkMessagingWindow(phoneNumber)
  await whatsappService.getConversationInfo(phoneNumber)
  await whatsappService.getConversationStats()
  ```

### 5. Enhanced Webhook Controller
**`src/controllers/webhookController.js`** (Modified)
- Automatically tracks incoming messages
- Opens/refreshes 24-hour window on each message
- Handles timestamp conversion from WhatsApp format

### 6. Documentation & Examples
- **`WHATSAPP_24H_WINDOW_GUIDE.md`** - Complete usage guide
- **`examples/whatsapp-24h-window-examples.js`** - 9 practical examples
- **`src/types/whatsapp.d.ts`** - TypeScript type definitions

## How It Works

### 1. Incoming Message Flow
```
User sends message to WhatsApp
         ↓
WhatsApp webhook calls your server
         ↓
webhookController.handleIncomingMessage()
         ↓
conversationTracker.trackIncomingMessage()
         ↓
Saves to DB (or memory): phoneNumber → timestamp
         ↓
24-hour window OPENED/REFRESHED
```

### 2. Outgoing Message Flow
```
Your code wants to send message
         ↓
whatsappService.sendDocumentNotification()
         ↓
Check: Get last incoming message timestamp
         ↓
Validate: Is it within 24 hours?
         ↓
YES → Send freeform message ✅
NO  → Return error, suggest template ❌
```

## Quick Start

### 1. Configure Environment
Add to `.env`:
```env
WHATSAPP_TRACKING_MODE=database  # or 'memory'
```

### 2. Run Database Migration
```javascript
const { syncDatabase } = require('./src/models');
await syncDatabase();
```

### 3. Send Messages with Validation
```javascript
const whatsappService = require('./src/services/whatsappService');

// Automatically checks 24h window
const result = await whatsappService.sendDocumentNotification({
  toWhatsApp: '+52 55 1234 5678',
  companyName: 'Acme Corp',
  fromName: 'John Doe',
  documentCount: 3
});

if (!result.success && result.requiresTemplate) {
  // Fall back to template message
  await whatsappService.sendTemplateMessage({
    toWhatsApp: '+52 55 1234 5678',
    templateName: 'your_approved_template',
    languageCode: 'es'
  });
}
```

### 4. Check Window Status
```javascript
const status = await whatsappService.checkMessagingWindow('+52 55 1234 5678');

console.log('Can send freeform:', status.canSendFreeform);
console.log('Time remaining:', status.timeRemaining);
console.log('Expires at:', status.expiresAt);
```

## API Reference

### Helper Functions (Sync)

```typescript
// Check if within 24 hours
isWithin24Hours(lastMessageAt: Date): boolean

// Get remaining time
getRemainingWindowTime(lastMessageAt: Date): {
  hours: number,
  minutes: number,
  seconds: number,
  isExpired: boolean,
  formatted: string,
  expiresAt: Date
}

// Validate message sending
canSendMessage(lastMessageAt: Date, isTemplate: boolean): {
  canSend: boolean,
  reason: string,
  requiresTemplate: boolean,
  expiresAt?: Date
}

// Clean phone number
cleanPhoneNumber(phoneNumber: string): string
```

### Conversation Tracker (Async)

```typescript
// Track incoming message
trackIncomingMessage(
  phoneNumber: string,
  messageId: string,
  timestamp?: Date
): Promise<TrackingResult>

// Get last message timestamp
getLastMessageTimestamp(phoneNumber: string): Promise<Date | null>

// Check if within window
isWithinWindow(phoneNumber: string): Promise<boolean>

// Get conversation info
getConversationInfo(phoneNumber: string): Promise<ConversationInfo | null>

// Get statistics
getStats(): Promise<ConversationStats>

// Set tracking mode
setTrackingMode(mode: 'memory' | 'database'): void
```

### WhatsApp Service (Async)

```typescript
// Send document notification (with window check)
sendDocumentNotification(params: {
  toWhatsApp: string,
  companyName: string,
  fromName: string,
  documentCount: number,
  forceTemplate?: boolean,
  skipWindowCheck?: boolean
}): Promise<WhatsAppSendResult>

// Send template message (always allowed)
sendTemplateMessage(params: {
  toWhatsApp: string,
  templateName: string,
  languageCode?: string,
  components?: Array
}): Promise<WhatsAppSendResult>

// Check messaging window
checkMessagingWindow(phoneNumber: string): Promise<WindowStatus>

// Get conversation info
getConversationInfo(phoneNumber: string): Promise<ConversationInfo | null>

// Get statistics
getConversationStats(): Promise<ConversationStats>
```

## Response Examples

### Success (Within Window)
```json
{
  "success": true,
  "messageId": "wamid.HBgNMTIzNDU2Nzg5MA==",
  "recipientNumber": "5215512345678"
}
```

### Error (Window Expired)
```json
{
  "success": false,
  "error": "24-hour window expired. Use a template message.",
  "requiresTemplate": true,
  "suggestion": "Use sendTemplateMessage() or set forceTemplate: true"
}
```

### Window Status
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

## Memory vs Database Mode

### Memory Mode
- ✅ Faster (no DB queries)
- ✅ Simple setup
- ❌ Lost on server restart
- ❌ Doesn't work with multiple server instances
- **Use case**: Development, testing, single-server deployments

### Database Mode (Recommended)
- ✅ Persistent across restarts
- ✅ Works with multiple servers
- ✅ Can query conversation history
- ❌ Slightly slower (DB overhead)
- **Use case**: Production, multi-server deployments

## Testing

Run the examples:
```bash
node examples/whatsapp-24h-window-examples.js
```

Test individual scenarios:
```javascript
const { example6_checkWindowStatus } = require('./examples/whatsapp-24h-window-examples');
await example6_checkWindowStatus();
```

## Migration from Old Code

### Before (No Window Validation)
```javascript
await whatsappService.sendDocumentNotification({
  toWhatsApp: phoneNumber,
  companyName: 'Company',
  fromName: 'Client',
  documentCount: 5
});
```

### After (With Window Validation)
```javascript
// Option 1: Automatic validation (recommended)
const result = await whatsappService.sendDocumentNotification({
  toWhatsApp: phoneNumber,
  companyName: 'Company',
  fromName: 'Client',
  documentCount: 5
});

if (!result.success && result.requiresTemplate) {
  // Handle: use template message
}

// Option 2: Check first, then send
const status = await whatsappService.checkMessagingWindow(phoneNumber);
if (status.canSendFreeform) {
  await whatsappService.sendDocumentNotification({ /* ... */ });
} else {
  await whatsappService.sendTemplateMessage({ /* ... */ });
}
```

## Benefits

1. **Compliance**: Fully compliant with WhatsApp Business API policies
2. **Cost Savings**: Avoid failed messages and potential account restrictions
3. **Better UX**: Know when to use templates vs freeform messages
4. **Flexible**: Supports both in-memory and database tracking
5. **Production-Ready**: Error handling, logging, TypeScript support
6. **Well-Documented**: Complete guide, examples, and type definitions

## Common Use Cases

### 1. Document Notification After User Inquiry
```javascript
// User sends: "Do you have my documents ready?"
// Webhook tracks this message → Opens 24h window
// You can now send: "Yes! Here are your documents: [link]"
```

### 2. Proactive Notifications (Requires Template)
```javascript
// No recent message from user → Use template
await whatsappService.sendTemplateMessage({
  templateName: 'document_ready',
  // ...
});
```

### 3. Follow-up Within Window
```javascript
// User messaged 2 hours ago → Can send freeform
const status = await whatsappService.checkMessagingWindow(phoneNumber);
if (status.canSendFreeform) {
  await whatsappService.sendDocumentNotification({ /* ... */ });
}
```

## Support & Resources

- **Guide**: `WHATSAPP_24H_WINDOW_GUIDE.md`
- **Examples**: `examples/whatsapp-24h-window-examples.js`
- **Types**: `src/types/whatsapp.d.ts`
- **WhatsApp Docs**: https://developers.facebook.com/docs/whatsapp/pricing#conversations

## What's Next?

1. ✅ Run database migration
2. ✅ Test with the examples file
3. ✅ Update your existing code to use window validation
4. ✅ Set up template messages in Meta Business Manager (for outside-window messages)
5. ✅ Monitor conversation statistics

---

**All done! Your WhatsApp backend now fully supports the 24-hour customer service window. 🎉**
