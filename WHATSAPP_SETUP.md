# WhatsApp Setup Guide - Using Meta Cloud API

## Overview
When a client sends documents to a company, the system will:
1. ✅ Display documents in the company dashboard
2. ✅ Send an email to the company's email address
3. ✅ **Send a WhatsApp message to the company's WhatsApp number** 📱

## Why Meta Cloud API?

**WhatsApp Cloud API** is the official Meta solution that's:
- ✅ **Free** - No charges from Meta (standard messaging rates apply)
- ✅ **Official** - Direct from Meta/Facebook
- ✅ **No Twilio needed** - Use your own WhatsApp Business number
- ✅ **Reliable** - 99.9% uptime
- ✅ **Fast** - Instant delivery
- ✅ **Feature-rich** - Text, images, documents, templates

## Quick Setup (15 minutes)

### Step 1: Create a Meta Business Account

1. Go to **https://business.facebook.com**
2. Click **"Create Account"** (if you don't have one)
3. Follow the setup wizard
4. Verify your business information

### Step 2: Create a Meta App

1. Go to **https://developers.facebook.com/apps**
2. Click **"Create App"**
3. Select **"Business"** as app type
4. Fill in details:
   - **App Name**: `PDF Portal`
   - **App Contact Email**: Your email
   - **Business Account**: Select your business
5. Click **"Create App"**

### Step 3: Add WhatsApp Product

1. In your app dashboard, find **"Add products"**
2. Find **"WhatsApp"** and click **"Set up"**
3. Select your **Business Account**
4. Choose **"Get started with the API"**

### Step 4: Get Your Phone Number

**Option A: Use Test Number (Quick Start)**
1. In WhatsApp > **Getting Started**, you'll see a test number
2. This is perfect for development/testing
3. **Limitation**: Can only send to 5 pre-registered numbers

**Option B: Add Your Own Number (Production)**
1. Go to WhatsApp > **Getting Started**
2. Click **"Add phone number"**
3. Enter your **WhatsApp Business number**
4. Verify via SMS code
5. **Wait 24-72 hours** for Meta approval (usually faster)

### Step 5: Get Your Credentials

In the WhatsApp > **Getting Started** section, you'll see:

1. **Temporary Access Token** (for testing):
   ```
   Copy this token - it expires in 24 hours
   ```

2. **Phone Number ID**:
   ```
   Look for "Phone number ID" under your phone number
   Example: 123456789012345
   ```

3. **Business Account ID**:
   ```
   Go to Business Settings > Business Info
   Example: 987654321098765
   ```

### Step 6: Generate Permanent Access Token

For production, you need a permanent token:

1. In your Meta App, go to **Settings > Basic**
2. Copy your **App ID** and **App Secret**
3. Go to **WhatsApp > Getting Started**
4. Click on **"Add a phone number"** section
5. Click on **"System User"** to create one
6. Go to **Business Settings > Users > System Users**
7. Click **"Add"** to create a new system user
8. Name it: `PDF Portal System User`
9. Click on **"Generate New Token"**
10. Select your app
11. Select permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
12. Click **"Generate Token"**
13. **Copy and save** this token (it won't be shown again!)

### Step 7: Configure Your `.env` File

Update these values in your `.env` file:

```env
# WhatsApp Configuration (Meta Cloud API)
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_BUSINESS_ACCOUNT_ID=987654321098765
WHATSAPP_API_VERSION=v21.0
```

**Important:**
- `WHATSAPP_ACCESS_TOKEN` - Your permanent access token (starts with `EAA`)
- `WHATSAPP_PHONE_NUMBER_ID` - The ID of your phone number (not the actual number!)
- `WHATSAPP_BUSINESS_ACCOUNT_ID` - Your business account ID
- `WHATSAPP_API_VERSION` - API version (v21.0 is latest, can be updated)

### Step 8: Add Test Recipients (If Using Test Number)

If using the test number, you must register recipients:

1. Go to WhatsApp > **Getting Started**
2. Scroll to **"Send and receive messages"**
3. Under **"To"**, click **"Manage phone number list"**
4. Add phone numbers you want to send test messages to
5. Format: `+[country_code][number]` (e.g., `+5215512345678`)

### Step 9: Restart Backend Server

```bash
# Stop the server (Ctrl+C)
# Start again
npm run dev
```

You should see:
```
✅ WhatsApp Cloud API service initialized
   Phone Number ID: 123456789012345
```

## Testing WhatsApp

1. **Register a test company** with WhatsApp number (include country code)
   - Example: `+5215512345678` (Mexico)
   - Example: `+14155551234` (USA)
2. **Have admin approve** the company
3. **Login as a client**
4. **Upload and send** a document to that company
5. **Check the company's WhatsApp** - they should receive a message!

## WhatsApp Message Template

The company will receive:

```
📄 Nuevos Documentos

Hola Company Name,

Has recibido 3 documentos de client@example.com.

📎 Los documentos están disponibles en tu panel de empresa.

👉 Ver documentos: http://localhost:5173/company/dashboard

Este es un mensaje automático del Portal PDF.
```

## Important Notes

### Phone Number Format

WhatsApp numbers must include the **country code** without `+` or spaces:

✅ **Correct formats:**
- `5215512345678` (Mexico)
- `14155551234` (USA)
- `5491112345678` (Argentina)
- `34612345678` (Spain)

❌ **Wrong formats:**
- `+52 55 1234 5678` (spaces and +)
- `(55) 1234-5678` (local format)
- `5512345678` (missing country code)

The system automatically cleans the number, but it's best to store it correctly in the database.

### Rate Limits

**Test Number:**
- **5 numbers** can be registered
- **250 messages/day** per phone number
- **1,000 conversations/month**

**Production Number:**
- **Unlimited recipients**
- **Rate limits** depend on your tier (starts at 1,000 conversations/month)
- **Quality rating** affects limits

### Message Types

**1. Text Messages** (current implementation):
- Simple text messages
- Can include URLs
- Preview URLs automatically

**2. Template Messages** (for marketing):
- Pre-approved by Meta
- Must be submitted for review
- Used for notifications, promotions
- Service included in `whatsappService.sendTemplateMessage()`

**3. Media Messages** (future):
- Images, PDFs, videos
- Up to 100MB
- Not yet implemented

## Troubleshooting

### WhatsApp message not sending?

**Check backend logs:**

✅ **Success:**
```
✅ WhatsApp Cloud API service initialized
📱 Sending WhatsApp message to 5215512345678...
✅ WhatsApp message sent successfully! Message ID: wamid.xxx
```

❌ **Not configured:**
```
⚠️ WhatsApp service not configured. Message not sent.
```

**Common issues:**

1. **Invalid Access Token**
   - Make sure you're using the **permanent token**, not temporary
   - Check for extra spaces in `.env`
   - Token should start with `EAA`

2. **Invalid Phone Number ID**
   - This is NOT the actual phone number
   - It's the **ID** from Meta dashboard
   - Usually 15 digits long

3. **Recipient not registered** (test number only)
   - Add recipient to phone number list in Meta dashboard
   - Include country code: `+5215512345678`

4. **Number not verified**
   - Wait for Meta to approve your number (24-72 hours)
   - Check verification status in Meta dashboard

5. **Rate limit exceeded**
   - Check your messaging tier in Meta dashboard
   - Upgrade tier if needed
   - Wait for limit reset (usually 24 hours)

### Error Messages

**Error: `(#132000) Number not registered`**
- Solution: Add the recipient to your test number list

**Error: `(#131048) Number not verified`**
- Solution: Complete phone number verification in Meta dashboard

**Error: `(#131031) Access token expired`**
- Solution: Generate a new permanent access token

**Error: `(#100) Invalid parameter`**
- Solution: Check phone number format (must include country code)

## Message Delivery Status

### Check Message Status

1. Go to Meta App Dashboard
2. Click **WhatsApp > Messaging Activity**
3. See delivery, read, and failure rates

### Webhook for Delivery Updates (Advanced)

To receive delivery receipts:

1. In Meta App, go to **WhatsApp > Configuration**
2. Click **"Edit"** on Webhook
3. Set **Callback URL**: `https://yourdomain.com/webhook/whatsapp`
4. Set **Verify Token**: Your secret token
5. Subscribe to **messages** events

This requires additional backend implementation (not included yet).

## Production Checklist

Before going live:

- [ ] **Business verification** - Verify your Meta Business Account
- [ ] **Phone number verified** - Add and verify your WhatsApp Business number
- [ ] **Permanent access token** - Replace temporary token with permanent
- [ ] **Display name** - Set a professional display name in Meta dashboard
- [ ] **Business profile** - Complete profile (photo, description, website)
- [ ] **Quality rating** - Maintain "High" quality rating
- [ ] **Tier upgrade** - Request higher messaging tier if needed
- [ ] **Templates approved** - Create and get approval for message templates
- [ ] **HTTPS required** - Use HTTPS for production webhooks
- [ ] **Error monitoring** - Set up logging and alerts

## Pricing

### WhatsApp Cloud API Costs

**Free Tier:**
- ✅ **1,000 conversations/month** - FREE
- ✅ After that: **$0.005 - $0.09 per conversation** (varies by country)

**What is a conversation?**
- A 24-hour window between business and customer
- Multiple messages in 24 hours = 1 conversation
- After 24 hours = new conversation

**Cost Examples:**
- **Mexico**: $0.0268 per conversation
- **USA**: $0.0205 per conversation
- **Spain**: $0.0893 per conversation
- **Argentina**: $0.0322 per conversation

### Comparison with Twilio

| Feature | Meta Cloud API | Twilio WhatsApp |
|---------|---------------|-----------------|
| Setup | Free | Free |
| First 1,000 conversations | **FREE** | $0.005/msg |
| After 1,000 conversations | $0.005-$0.09 | $0.005-$0.12 |
| Phone number cost | **$0/month** | $1.50/month |
| API complexity | Simple | Simple |
| Official Meta API | ✅ Yes | ❌ No (3rd party) |

👉 **Meta Cloud API is cheaper and official!**

## Advanced Features

### Using Message Templates

Templates must be pre-approved by Meta:

```javascript
await whatsappService.sendTemplateMessage({
  toWhatsApp: '5215512345678',
  templateName: 'document_notification',
  languageCode: 'es',
  components: [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: 'Company Name' },
        { type: 'text', text: '5' }
      ]
    }
  ]
});
```

### Creating a Template

1. Go to **WhatsApp > Message Templates**
2. Click **"Create Template"**
3. Fill in details:
   - **Name**: `document_notification`
   - **Category**: `UTILITY`
   - **Language**: Spanish
   - **Body**: `Hola {{1}}, has recibido {{2}} documentos.`
4. Submit for approval
5. Wait for approval (usually 1-24 hours)

## Support & Resources

- 📚 **Official Docs**: https://developers.facebook.com/docs/whatsapp/cloud-api
- 💬 **Developer Forum**: https://developers.facebook.com/community
- 📧 **Business Support**: https://business.facebook.com/business/help
- 🐛 **Report Issues**: https://developers.facebook.com/support
- 📖 **API Reference**: https://developers.facebook.com/docs/whatsapp/cloud-api/reference

## Security Best Practices

- **Never commit** your `.env` file to version control
- **Keep access token secret** - it has full control of your WhatsApp
- **Use system user tokens** for production (not temporary tokens)
- **Rotate tokens** periodically
- **Use different tokens** for dev/staging/production
- **Monitor API usage** in Meta dashboard
- **Set up webhook security** for production
- **Implement rate limiting** on your end

---

🎉 **You're all set!** Companies will now receive WhatsApp notifications when clients send them documents!
