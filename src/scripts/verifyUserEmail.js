require('dotenv').config();
const { User } = require('../models');

/**
 * Quick script to manually verify a user's email
 * Usage: node src/scripts/verifyUserEmail.js <email>
 */

async function verifyUserEmail() {
  const email = process.argv[2];

  if (!email) {
    console.error('❌ Please provide an email address');
    console.log('Usage: node src/scripts/verifyUserEmail.js <email>');
    process.exit(1);
  }

  try {
    console.log(`\n🔍 Looking for user: ${email}...`);

    const user = await User.findOne({ where: { email } });

    if (!user) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    console.log(`✅ User found (ID: ${user.id})`);
    console.log(`   Current status: isEmailVerified = ${user.isEmailVerified}`);

    if (user.isEmailVerified) {
      console.log('✅ Email is already verified!');
      process.exit(0);
    }

    // Verify the email
    await user.update({
      isEmailVerified: true,
      isActive: true,
      otpCode: null,
      otpExpiry: null,
      otpAttempts: 0
    });

    console.log('✅ Email verified successfully!');
    console.log('   User can now log in without OTP verification');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

verifyUserEmail();
