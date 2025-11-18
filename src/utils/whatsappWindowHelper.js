/**
 * WhatsApp 24-Hour Window Helper Functions
 *
 * WhatsApp Business API Policy:
 * - You can send messages freely within 24 hours of receiving a user message
 * - After 24 hours, you must use pre-approved message templates
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/pricing#conversations
 */

/**
 * Check if a timestamp is within the 24-hour customer service window
 * @param {Date} lastMessageAt - Timestamp of the last incoming message from user
 * @returns {boolean} - True if within 24 hours, false otherwise
 */
function isWithin24Hours(lastMessageAt) {
  if (!lastMessageAt) {
    return false;
  }

  const now = new Date();
  const messageTime = new Date(lastMessageAt);
  const hoursSinceMessage = (now - messageTime) / (1000 * 60 * 60);

  return hoursSinceMessage < 24;
}

/**
 * Get remaining time in the 24-hour window
 * @param {Date} lastMessageAt - Timestamp of the last incoming message from user
 * @returns {Object} - Object with hours, minutes, and formatted string
 */
function getRemainingWindowTime(lastMessageAt) {
  if (!lastMessageAt) {
    return {
      hours: 0,
      minutes: 0,
      seconds: 0,
      isExpired: true,
      formatted: 'Expired'
    };
  }

  const now = new Date();
  const messageTime = new Date(lastMessageAt);
  const expiresAt = new Date(messageTime.getTime() + (24 * 60 * 60 * 1000));

  const remainingMs = expiresAt - now;

  if (remainingMs <= 0) {
    return {
      hours: 0,
      minutes: 0,
      seconds: 0,
      isExpired: true,
      formatted: 'Expired'
    };
  }

  const hours = Math.floor(remainingMs / (1000 * 60 * 60));
  const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);

  return {
    hours,
    minutes,
    seconds,
    isExpired: false,
    formatted: `${hours}h ${minutes}m ${seconds}s`,
    expiresAt
  };
}

/**
 * Calculate the expiration time for a 24-hour window
 * @param {Date} lastMessageAt - Timestamp of the last incoming message from user
 * @returns {Date} - Expiration timestamp
 */
function getWindowExpirationTime(lastMessageAt) {
  if (!lastMessageAt) {
    return null;
  }

  const messageTime = new Date(lastMessageAt);
  return new Date(messageTime.getTime() + (24 * 60 * 60 * 1000));
}

/**
 * Check if we need to use a template message
 * @param {Date} lastMessageAt - Timestamp of the last incoming message from user
 * @returns {boolean} - True if template required (outside 24h window), false otherwise
 */
function requiresTemplate(lastMessageAt) {
  return !isWithin24Hours(lastMessageAt);
}

/**
 * Clean phone number to standard format (remove spaces, +, -, etc.)
 * @param {string} phoneNumber - Raw phone number
 * @returns {string} - Cleaned phone number
 */
function cleanPhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    return '';
  }
  return phoneNumber.replace(/[\s+()-]/g, '');
}

/**
 * Validate if a message can be sent (within 24h or using template)
 * @param {Date} lastMessageAt - Timestamp of the last incoming message
 * @param {boolean} isTemplate - Whether this is a template message
 * @returns {Object} - Validation result with canSend and reason
 */
function canSendMessage(lastMessageAt, isTemplate = false) {
  // If it's a template message, it can always be sent
  if (isTemplate) {
    return {
      canSend: true,
      reason: 'Template message can be sent anytime',
      requiresTemplate: false
    };
  }

  // If no last message timestamp, user hasn't messaged us yet
  if (!lastMessageAt) {
    return {
      canSend: false,
      reason: 'User has not sent any message yet. Use a template message.',
      requiresTemplate: true
    };
  }

  // Check if within 24-hour window
  const within24h = isWithin24Hours(lastMessageAt);

  if (within24h) {
    const remaining = getRemainingWindowTime(lastMessageAt);
    return {
      canSend: true,
      reason: `Within 24-hour window. Time remaining: ${remaining.formatted}`,
      requiresTemplate: false,
      expiresAt: remaining.expiresAt
    };
  } else {
    return {
      canSend: false,
      reason: '24-hour window expired. Use a template message.',
      requiresTemplate: true
    };
  }
}

module.exports = {
  isWithin24Hours,
  getRemainingWindowTime,
  getWindowExpirationTime,
  requiresTemplate,
  cleanPhoneNumber,
  canSendMessage
};
