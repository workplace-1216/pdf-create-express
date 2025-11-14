/**
 * WhatsApp Webhook Routes
 * Routes for handling WhatsApp Cloud API webhooks
 */

const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

/**
 * GET /webhook/whatsapp
 * Webhook verification endpoint
 * Meta will call this to verify your webhook URL when you set it up
 */
router.get('/whatsapp', webhookController.verifyWebhook.bind(webhookController));

/**
 * POST /webhook/whatsapp
 * Webhook event handler
 * Receives delivery receipts, message status updates, and incoming messages
 */
router.post('/whatsapp', webhookController.handleWebhookEvent.bind(webhookController));

module.exports = router;
