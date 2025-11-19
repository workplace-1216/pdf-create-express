# WhatsApp Template Message Setup Guide

## Overview

Your backend now intelligently switches between:
- **Freeform messages** (within 24h window) - No template needed
- **Template messages** (outside 24h window) - Requires approved template

## How It Works Now

```
Document uploaded
       ↓
Check 24-hour window
       ↓
    ┌─────────────────────┐
    │ Within 24 hours?    │
    └─────────────────────┘
            ↓
     ┌──────┴──────┐
   YES              NO
     │               │
     ↓               ↓
Freeform msg    Template msg
(existing)      (new template)
```

## Step 1: Create WhatsApp Template in Meta Business Manager

### 1.1 Access Meta Business Suite
1. Go to https://business.facebook.com
2. Select your WhatsApp Business Account
3. Click **Account Tools** → **Message Templates**

### 1.2 Create New Template
Click **Create Template** button

### 1.3 Template Configuration

**Category:** `UTILITY` (for transactional notifications)

**Name:** `document_notification` (lowercase, no spaces)

**Languages:** Spanish (es)

**Template Content:**

```
Hola {{1}},

Has recibido {{2}} documentos de {{3}}.

Los documentos están disponibles en tu panel de empresa.

Este es un mensaje automático del Portal PDF.
```

**Variables:**
- `{{1}}` = Company Name (e.g., "Acme Corp")
- `{{2}}` = Document Count (e.g., "3")
- `{{3}}` = Client Name/Email (e.g., "john@example.com")

### 1.4 Template Example

**Header:** None (optional)

**Body:**
```
Hola {{1}},

Has recibido {{2}} documentos de {{3}}.

Los documentos están disponibles en tu panel de empresa.

Este es un mensaje automático del Portal PDF.
```

**Footer:** None (optional)

**Buttons:** None (optional, or add a URL button to your dashboard)

### 1.5 Submit for Approval
- Click **Submit**
- WhatsApp will review (usually takes a few hours to 1 business day)
- Template status will change to **Approved** when ready

## Step 2: Configure Template Name in .env

Add to your `.env` file:

```env
# WhatsApp Template Configuration
WHATSAPP_DOCUMENT_TEMPLATE_NAME=document_notification
```

If you use a different template name, update this value.

## Step 3: Test the Template (Optional)

Once approved, test it manually:

```javascript
const whatsappService = require('./src/services/whatsappService');

await whatsappService.sendTemplateMessage({
  toWhatsApp: '+52 55 1234 5678',
  templateName: 'document_notification',
  languageCode: 'es',
  components: [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: 'Test Company' },      // {{1}}
        { type: 'text', text: '5' },                 // {{2}}
        { type: 'text', text: 'test@example.com' }   // {{3}}
      ]
    }
  ]
});
```

## Advanced: Template with Buttons

If you want to add a button to your template:

### Template Body (same as above)
```
Hola {{1}},

Has recibido {{2}} documentos de {{3}}.

Los documentos están disponibles en tu panel de empresa.
```

### Add Button
**Type:** URL Button
**Text:** "Ver Documentos"
**URL:** `{{1}}` (dynamic URL)

Then update your code:

```javascript
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const dashboardUrl = `${frontendUrl}/company/dashboard`;

whatsappResult = await whatsappService.sendTemplateMessage({
  toWhatsApp: company.whatsappNumber,
  templateName: 'document_notification_with_button',
  languageCode: 'es',
  components: [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: company.name },
        { type: 'text', text: documentIds.length.toString() },
        { type: 'text', text: currentUser.email }
      ]
    },
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [
        { type: 'text', text: dashboardUrl }  // Dynamic URL
      ]
    }
  ]
});
```

## Template Message Guidelines

### ✅ DO:
- Use clear, concise language
- Keep it transactional (not promotional)
- Use UTILITY category for notifications
- Test thoroughly before production
- Include unsubscribe option if required by law

### ❌ DON'T:
- Use marketing language (will be rejected)
- Include misleading information
- Use ALL CAPS excessively
- Add too many emojis
- Violate WhatsApp policies

## Template Approval Checklist

Before submitting:
- [ ] Template name is lowercase, no spaces, underscores only
- [ ] Category is UTILITY (for transactional notifications)
- [ ] Language is set correctly (es for Spanish)
- [ ] Variables are numbered correctly ({{1}}, {{2}}, {{3}})
- [ ] Content is clear and professional
- [ ] No promotional language
- [ ] Follows WhatsApp Business Policy

## Troubleshooting

### Template Rejected
**Common reasons:**
1. Contains promotional language
2. Misleading or unclear content
3. Too many variables
4. Doesn't match category (use UTILITY for notifications)

**Solution:** Revise template to be more transactional and resubmit

### Template Not Found Error
```
Error: Template 'document_notification' not found
```

**Solutions:**
1. Verify template is approved in Meta Business Manager
2. Check template name matches exactly (case-sensitive)
3. Ensure template is created for the correct WhatsApp Business Account
4. Wait for approval (can take up to 24 hours)

### Wrong Number of Parameters
```
Error: Parameter count mismatch
```

**Solution:** Ensure the number of parameters in your code matches the template variables

## Current Implementation

Your `documentController.js` now automatically:

1. **Checks 24-hour window** for each company
2. **If within window**: Sends freeform message (your existing message)
3. **If outside window**: Sends template message (requires approved template)

### Console Logs You'll See:

**Within 24h window:**
```
[DocumentController] 🕐 Window status: Within 24-hour window. Time remaining: 15h 30m 45s
[DocumentController] ✅ Within 24h window (15h 30m 45s remaining) - sending freeform message
[WhatsAppService] 📱 Preparing to send WhatsApp message to 5215512345678...
[WhatsAppService] ✅ WhatsApp message sent successfully!
```

**Outside 24h window:**
```
[DocumentController] 🕐 Window status: 24-hour window expired. Use a template message.
[DocumentController] ⚠️ Outside 24h window - using template message
[WhatsAppService] 📱 Sending WhatsApp template "document_notification" to 5215512345678...
[WhatsAppService] ✅ WhatsApp template sent successfully!
```

## Testing Scenarios

### Scenario 1: First-time recipient (no prior messages)
- **Expected:** Template message sent
- **Reason:** No 24h window exists yet

### Scenario 2: Company messaged 2 hours ago
- **Expected:** Freeform message sent
- **Reason:** Within 24h window

### Scenario 3: Company messaged 25 hours ago
- **Expected:** Template message sent
- **Reason:** 24h window expired

### Scenario 4: Company replies to your notification
- **Expected:** 24h window refreshes
- **Next notification:** Can use freeform message again

## Cost Implications

### Freeform Messages (Within 24h)
- **Cost:** Free or very low (business-initiated conversation)
- **Benefit:** Can send custom, personalized messages

### Template Messages (Outside 24h)
- **Cost:** Charged per template message (varies by country)
- **Benefit:** Can reach users anytime
- **Current pricing:** ~$0.005-0.01 USD per message (Mexico)

**💡 Tip:** Encourage companies to reply to notifications to keep the 24h window active and reduce costs!

## Next Steps

1. ✅ Create template in Meta Business Manager
2. ✅ Wait for approval (usually < 24 hours)
3. ✅ Add template name to `.env`
4. ✅ Test with a real phone number
5. ✅ Monitor logs for window status

## Support Resources

- [WhatsApp Message Templates](https://developers.facebook.com/docs/whatsapp/message-templates)
- [Template Guidelines](https://developers.facebook.com/docs/whatsapp/message-templates/guidelines)
- [Meta Business Manager](https://business.facebook.com)
- [WhatsApp Business Policy](https://www.whatsapp.com/legal/business-policy)

---

**Your implementation is complete! Create the template and you're ready to go. 🚀**
