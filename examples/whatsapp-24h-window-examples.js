/**
 * WhatsApp 24-Hour Window - Practical Examples
 *
 * Run this file to test the 24-hour window functionality
 * Usage: node examples/whatsapp-24h-window-examples.js
 */

// Import services and utilities
const whatsappService = require('../src/services/whatsappService');
const conversationTracker = require('../src/services/whatsappConversationTracker');
const {
  isWithin24Hours,
  getRemainingWindowTime,
  canSendMessage,
  cleanPhoneNumber
} = require('../src/utils/whatsappWindowHelper');

// =============================================================================
// EXAMPLE 1: Check if timestamp is within 24 hours
// =============================================================================
function example1_checkTimestamp() {
  console.log('\n=== EXAMPLE 1: Check Timestamp ===\n');

  // Test with current time (should be within 24h)
  const now = new Date();
  const result1 = isWithin24Hours(now);
  console.log(`Current time within 24h: ${result1}`); // true

  // Test with 12 hours ago (should be within 24h)
  const twelveHoursAgo = new Date(Date.now() - (12 * 60 * 60 * 1000));
  const result2 = isWithin24Hours(twelveHoursAgo);
  console.log(`12 hours ago within 24h: ${result2}`); // true

  // Test with 25 hours ago (should be outside 24h)
  const twentyFiveHoursAgo = new Date(Date.now() - (25 * 60 * 60 * 1000));
  const result3 = isWithin24Hours(twentyFiveHoursAgo);
  console.log(`25 hours ago within 24h: ${result3}`); // false
}

// =============================================================================
// EXAMPLE 2: Get remaining time in window
// =============================================================================
function example2_getRemainingTime() {
  console.log('\n=== EXAMPLE 2: Get Remaining Time ===\n');

  const twoHoursAgo = new Date(Date.now() - (2 * 60 * 60 * 1000));
  const remaining = getRemainingWindowTime(twoHoursAgo);

  console.log('Last message received:', twoHoursAgo.toISOString());
  console.log('Is expired:', remaining.isExpired);
  console.log('Time remaining:', remaining.formatted);
  console.log('Window expires at:', remaining.expiresAt?.toISOString());
  console.log('Hours left:', remaining.hours);
  console.log('Minutes left:', remaining.minutes);
}

// =============================================================================
// EXAMPLE 3: Validate if message can be sent
// =============================================================================
function example3_validateMessageSending() {
  console.log('\n=== EXAMPLE 3: Validate Message Sending ===\n');

  // Scenario 1: User messaged 5 hours ago
  const fiveHoursAgo = new Date(Date.now() - (5 * 60 * 60 * 1000));
  const validation1 = canSendMessage(fiveHoursAgo, false);
  console.log('Scenario 1 (5 hours ago):');
  console.log('  Can send:', validation1.canSend);
  console.log('  Reason:', validation1.reason);
  console.log('  Requires template:', validation1.requiresTemplate);

  // Scenario 2: User messaged 25 hours ago
  const twentyFiveHoursAgo = new Date(Date.now() - (25 * 60 * 60 * 1000));
  const validation2 = canSendMessage(twentyFiveHoursAgo, false);
  console.log('\nScenario 2 (25 hours ago):');
  console.log('  Can send:', validation2.canSend);
  console.log('  Reason:', validation2.reason);
  console.log('  Requires template:', validation2.requiresTemplate);

  // Scenario 3: User never messaged (null)
  const validation3 = canSendMessage(null, false);
  console.log('\nScenario 3 (never messaged):');
  console.log('  Can send:', validation3.canSend);
  console.log('  Reason:', validation3.reason);
  console.log('  Requires template:', validation3.requiresTemplate);

  // Scenario 4: Using template message (always allowed)
  const validation4 = canSendMessage(twentyFiveHoursAgo, true);
  console.log('\nScenario 4 (using template):');
  console.log('  Can send:', validation4.canSend);
  console.log('  Reason:', validation4.reason);
}

// =============================================================================
// EXAMPLE 4: Clean phone numbers
// =============================================================================
function example4_cleanPhoneNumbers() {
  console.log('\n=== EXAMPLE 4: Clean Phone Numbers ===\n');

  const phones = [
    '+52 55 1234 5678',
    '52-55-1234-5678',
    '(52) 55 1234 5678',
    '5215512345678'
  ];

  phones.forEach(phone => {
    const cleaned = cleanPhoneNumber(phone);
    console.log(`${phone} → ${cleaned}`);
  });
}

// =============================================================================
// EXAMPLE 5: Track incoming messages (async)
// =============================================================================
async function example5_trackIncomingMessages() {
  console.log('\n=== EXAMPLE 5: Track Incoming Messages ===\n');

  const testPhone = '5215512345678';
  const messageId = 'wamid.test123';

  // Track an incoming message
  console.log('Tracking incoming message from:', testPhone);
  const result = await conversationTracker.trackIncomingMessage(
    testPhone,
    messageId,
    new Date()
  );

  console.log('Tracking result:', result);

  // Check if within window
  const withinWindow = await conversationTracker.isWithinWindow(testPhone);
  console.log('Is within 24h window:', withinWindow);

  // Get full conversation info
  const info = await conversationTracker.getConversationInfo(testPhone);
  console.log('Conversation info:', JSON.stringify(info, null, 2));
}

// =============================================================================
// EXAMPLE 6: Check messaging window status (async)
// =============================================================================
async function example6_checkWindowStatus() {
  console.log('\n=== EXAMPLE 6: Check Window Status ===\n');

  const testPhone = '5215512345678';

  // First, simulate tracking an incoming message from 3 hours ago
  const threeHoursAgo = new Date(Date.now() - (3 * 60 * 60 * 1000));
  await conversationTracker.trackIncomingMessage(testPhone, 'msg-123', threeHoursAgo);

  // Now check the window status
  const status = await whatsappService.checkMessagingWindow(testPhone);

  console.log('Window Status for', testPhone);
  console.log('  Can send freeform:', status.canSendFreeform);
  console.log('  Requires template:', status.requiresTemplate);
  console.log('  Last incoming message:', status.lastIncomingMessage);
  console.log('  Window status:', status.windowStatus);
  console.log('  Time remaining:', status.timeRemaining);
  console.log('  Expires at:', status.expiresAt);
}

// =============================================================================
// EXAMPLE 7: Simulate sending messages with validation (async)
// =============================================================================
async function example7_sendWithValidation() {
  console.log('\n=== EXAMPLE 7: Send Messages with Validation ===\n');

  const testPhone = '+52 55 1234 5678';

  // Scenario A: User messaged recently (2 hours ago) - should work
  console.log('Scenario A: Recent message (2 hours ago)');
  const twoHoursAgo = new Date(Date.now() - (2 * 60 * 60 * 1000));
  await conversationTracker.trackIncomingMessage(testPhone, 'msg-a', twoHoursAgo);

  // Check before sending
  const statusA = await whatsappService.checkMessagingWindow(testPhone);
  console.log('  Can send:', statusA.canSendFreeform);
  console.log('  Status:', statusA.windowStatus);

  // Uncomment to actually send (requires valid WhatsApp config)
  /*
  const resultA = await whatsappService.sendDocumentNotification({
    toWhatsApp: testPhone,
    companyName: 'Test Company',
    fromName: 'John Doe',
    documentCount: 5
  });
  console.log('  Send result:', resultA);
  */

  // Scenario B: User messaged 25 hours ago - should fail
  console.log('\nScenario B: Old message (25 hours ago)');
  const testPhone2 = '+52 55 9876 5432';
  const twentyFiveHoursAgo = new Date(Date.now() - (25 * 60 * 60 * 1000));
  await conversationTracker.trackIncomingMessage(testPhone2, 'msg-b', twentyFiveHoursAgo);

  const statusB = await whatsappService.checkMessagingWindow(testPhone2);
  console.log('  Can send:', statusB.canSendFreeform);
  console.log('  Status:', statusB.windowStatus);

  // Uncomment to test (will fail with validation error)
  /*
  const resultB = await whatsappService.sendDocumentNotification({
    toWhatsApp: testPhone2,
    companyName: 'Test Company',
    fromName: 'Jane Smith',
    documentCount: 3
  });
  console.log('  Send result:', resultB);
  */
}

// =============================================================================
// EXAMPLE 8: Get conversation statistics (async)
// =============================================================================
async function example8_getStatistics() {
  console.log('\n=== EXAMPLE 8: Get Conversation Statistics ===\n');

  // Track some test conversations
  await conversationTracker.trackIncomingMessage('5215511111111', 'msg1', new Date());
  await conversationTracker.trackIncomingMessage('5215522222222', 'msg2', new Date(Date.now() - (3 * 60 * 60 * 1000)));
  await conversationTracker.trackIncomingMessage('5215533333333', 'msg3', new Date(Date.now() - (25 * 60 * 60 * 1000)));

  const stats = await conversationTracker.getStats();

  console.log('Conversation Statistics:');
  console.log('  Total conversations:', stats.totalConversations);
  console.log('  Active windows (within 24h):', stats.activeWindows);
  console.log('  Expired windows (past 24h):', stats.expiredWindows);
  console.log('  Tracking mode:', stats.trackingMode);
}

// =============================================================================
// EXAMPLE 9: Switch between memory and database mode (async)
// =============================================================================
async function example9_switchTrackingMode() {
  console.log('\n=== EXAMPLE 9: Switch Tracking Mode ===\n');

  // Get current stats
  const stats1 = await conversationTracker.getStats();
  console.log('Current mode:', stats1.trackingMode);

  // Switch to memory mode
  console.log('\nSwitching to memory mode...');
  conversationTracker.setTrackingMode('memory');

  // Track in memory
  await conversationTracker.trackIncomingMessage('5215599999999', 'mem-msg', new Date());

  const stats2 = await conversationTracker.getStats();
  console.log('New mode:', stats2.trackingMode);
  console.log('Total conversations (memory):', stats2.totalConversations);

  // Switch back to database mode
  console.log('\nSwitching back to database mode...');
  conversationTracker.setTrackingMode('database');

  const stats3 = await conversationTracker.getStats();
  console.log('Mode restored:', stats3.trackingMode);
}

// =============================================================================
// RUN ALL EXAMPLES
// =============================================================================
async function runAllExamples() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   WhatsApp 24-Hour Window - Complete Examples         ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  try {
    // Synchronous examples
    example1_checkTimestamp();
    example2_getRemainingTime();
    example3_validateMessageSending();
    example4_cleanPhoneNumbers();

    // Asynchronous examples
    await example5_trackIncomingMessages();
    await example6_checkWindowStatus();
    await example7_sendWithValidation();
    await example8_getStatistics();
    await example9_switchTrackingMode();

    console.log('\n✅ All examples completed successfully!\n');
  } catch (error) {
    console.error('\n❌ Error running examples:', error);
  }
}

// Run if executed directly
if (require.main === module) {
  runAllExamples().then(() => {
    console.log('Examples finished. You can now use these patterns in your code.');
    process.exit(0);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for use in other files
module.exports = {
  example1_checkTimestamp,
  example2_getRemainingTime,
  example3_validateMessageSending,
  example4_cleanPhoneNumbers,
  example5_trackIncomingMessages,
  example6_checkWindowStatus,
  example7_sendWithValidation,
  example8_getStatistics,
  example9_switchTrackingMode,
  runAllExamples
};
