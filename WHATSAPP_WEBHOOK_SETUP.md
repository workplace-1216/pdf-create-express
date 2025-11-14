# WhatsApp Webhook Setup Guide

This guide will help you set up WhatsApp webhooks to receive delivery receipts and message status updates.

## 🎯 What You'll Get

After completing this setup, your application will automatically receive:
- ✅ **Sent** - Message was sent to WhatsApp servers
- ✅ **Delivered** - Message was delivered to recipient's device
- ✅ **Read** - Message was read by recipient
- ❌ **Failed** - Message failed to send (with error details)

## 📋 Prerequisites

1. **Public HTTPS URL** - Your server must be accessible via HTTPS
   - For local development, use tools like:
     - [ngrok](https://ngrok.com/) - `ngrok http 5000`
     - [localtunnel](https://localtunnel.github.io/www/) - `lt --port 5000`
     - [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)

2. **Meta Developer Account** with WhatsApp Business App configured

3. **Access Token** - Already configured in your `.env` file

## 🚀 Step-by-Step Setup

### Step 1: Start Your Server

Make sure your backend server is running:

```bash
cd backend
npm start
```

Your webhook will be available at:
```
https://your-domain.com/webhook/whatsapp
```

### Step 2: Get Your Public HTTPS URL

#### Option A: Using ngrok (Recommended for Development)

1. Download and install [ngrok](https://ngrok.com/)
2. Run ngrok:
   ```bash
   ngrok http 5000
   ```
3. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

#### Option B: Using Your Production Domain

If you're deploying to production, use your actual domain:
```
https://api.yourcompany.com
```

### Step 3: Configure Webhook in Meta Developer Console

1. **Go to Meta Developer Console**
   - Visit: https://developers.facebook.com/apps
   - Select your app

2. **Navigate to WhatsApp > Configuration**
   - In the left sidebar, click "WhatsApp"
   - Click "Configuration"

3. **Edit Webhook**
   - Click "Edit" button in the Webhook section

4. **Enter Webhook Details**

   **Callback URL:**
   ```
   https://your-domain.com/webhook/whatsapp
   ```

   **Verify Token:**
   ```
   pdfportal_webhook_verify_token_2024_secure
   ```

   ⚠️ **Important**: This verify token must match the `WHATSAPP_VERIFY_TOKEN` in your `.env` file!

5. **Click "Verify and Save"**
   - Meta will send a GET request to your webhook
   - Your server will respond with the challenge
   - If successful, you'll see "Webhook verified"

6. **Subscribe to Webhook Fields**

   Click "Manage" and subscribe to these fields:
   - ✅ **messages** (Required) - For message status updates

   Click "Save"

### Step 4: Test the Webhook

1. **Send a Test WhatsApp Message**

   Upload a document in your application, which will trigger a WhatsApp notification.

2. **Check Your Server Logs**

   You should see webhook events in your console:
   ```
   [WhatsApp Webhook] 📨 Incoming webhook event
   [WhatsApp Webhook] 📊 Message Status Update:
     Message ID: wamid.xxx...
     Recipient: 819078968589
     Status: sent
     Timestamp: 1234567890
   ```

3. **Monitor Status Progression**

   You should see status updates in this order:
   ```
   sent → delivered → read
   ```

## 🔧 Configuration Files

### `.env` Configuration

Your `.env` file should have these WhatsApp settings:

```env
# WhatsApp Configuration
WHATSAPP_ACCESS_TOKEN=EAALuEunYpnYBPyvtKN5QYWzbkoV9bZC8ZCHjdZBecJRIx0ROIlgZA0zEOjvpYCZA8Ggmnm9GSqL36OfRnmt9AHs4Na4VZCbPrxytyAGlpCZAaSAi4KgYmjjgWNCZBL2ZBuVFtZATI2ZCc0oF55LdimR0mNcLzSHZBd6gVNZAjuNFcj8aRLTuYAOLUjRPYZCn1BCneaKnraZACJTZBtM7hrCD9z8k89PPj4hjc2FOVxQfuxOMLkIQH0ZAmZAywZD
WHATSAPP_PHONE_NUMBER_ID=526643401359
WHATSAPP_BUSINESS_ACCOUNT_ID=824714953533046
WHATSAPP_API_VERSION=v21.0

# WhatsApp Webhook Configuration
WHATSAPP_VERIFY_TOKEN=pdfportal_webhook_verify_token_2024_secure
```

## 📊 Webhook Event Types

### Message Status Events

The webhook receives these status updates:

| Status | Description | Next Action |
|--------|-------------|-------------|
| `sent` | Message sent to WhatsApp servers | Wait for delivery |
| `delivered` | Message delivered to recipient's device | Wait for read (if read receipts enabled) |
| `read` | Message read by recipient | ✅ Complete |
| `failed` | Message failed to send | ❌ Check error details |

### Example Webhook Payload

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "824714953533046",
      "changes": [
        {
          "field": "messages",
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550123456",
              "phone_number_id": "526643401359"
            },
            "statuses": [
              {
                "id": "wamid.HBgLODE5MDc4OTY4NTg5FQIAERgSMEEwQ0Y1OTc3QTQzMkMxNjdDAA==",
                "status": "delivered",
                "timestamp": "1234567890",
                "recipient_id": "819078968589",
                "conversation": {
                  "id": "abc123...",
                  "origin": {
                    "type": "business_initiated"
                  }
                }
              }
            ]
          }
        }
      ]
    }
  ]
}
```

## 🔍 Troubleshooting

### Webhook Verification Fails

**Error**: "Verification token mismatch"

**Solution**:
- Check that `WHATSAPP_VERIFY_TOKEN` in `.env` matches the token you entered in Meta console
- Restart your server after changing `.env`
- Make sure your server is accessible via HTTPS

### Not Receiving Webhook Events

**Possible Causes**:
1. **Webhook not subscribed to "messages" field**
   - Go to Meta Console > WhatsApp > Configuration
   - Click "Manage" next to Webhook fields
   - Subscribe to "messages"

2. **Server not accessible**
   - Test your webhook URL in a browser: `https://your-domain.com/health`
   - If using ngrok, make sure it's still running

3. **HTTPS issues**
   - Meta requires valid SSL certificate
   - Self-signed certificates won't work

### Webhook Returns 500 Error

**Check Server Logs**:
```bash
# Look for error messages in console
[WhatsApp Webhook] ❌ Error processing webhook: ...
```

**Common Issues**:
- JSON parsing error - Check request body format
- Missing environment variables
- Database connection issues

## 🛡️ Security Best Practices

1. **Verify Webhook Signature** (Optional but Recommended)

   Meta signs webhook requests. You can verify the signature using the `x-hub-signature-256` header:

   ```javascript
   const crypto = require('crypto');

   function verifyWebhookSignature(req) {
     const signature = req.headers['x-hub-signature-256'];
     const expectedSignature = crypto
       .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
       .update(JSON.stringify(req.body))
       .digest('hex');

     return signature === `sha256=${expectedSignature}`;
   }
   ```

2. **Keep Tokens Secure**
   - Never commit `.env` file to git
   - Use environment variables in production
   - Rotate access tokens regularly

3. **Rate Limiting**
   - Implement rate limiting on webhook endpoint
   - Handle webhook retries gracefully

## 📝 Next Steps

After setting up webhooks, you can:

1. **Update Database** - Modify `webhookController.js` to update message status in database
2. **Send Notifications** - Notify users when messages are delivered/read
3. **Error Handling** - Alert admins when messages fail
4. **Analytics** - Track delivery rates and response times

## 🔗 Useful Links

- [Meta WhatsApp Cloud API Docs](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Webhook Setup Guide](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks)
- [Webhook Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components)
- [Testing Tools](https://developers.facebook.com/docs/whatsapp/cloud-api/support/testing)

## 💡 Tips

- **Development**: Use ngrok and restart it daily (free plan resets URL daily)
- **Production**: Use a stable domain with valid SSL certificate
- **Monitoring**: Set up logging to track webhook performance
- **Testing**: Use Meta's Test Phone Numbers before going live

---

**Need Help?**
- Check server logs for detailed error messages
- Review Meta's webhook configuration
- Test with curl:
  ```bash
  curl -X GET "https://your-domain.com/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=pdfportal_webhook_verify_token_2024_secure&hub.challenge=test123"
  ```
