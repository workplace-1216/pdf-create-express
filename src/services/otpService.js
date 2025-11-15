const crypto = require('crypto');

class OtpService {
  /**
   * Generate a 6-digit OTP code
   * @returns {string} 6-digit OTP code
   */
  generateOTP() {
    // Generate a random 6-digit number
    const otp = crypto.randomInt(100000, 999999).toString();
    return otp;
  }

  /**
   * Get OTP expiry time (15 minutes from now)
   * @returns {Date} Expiry date
   */
  getOTPExpiry() {
    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + 300); // OTP valid for 15 minutes
    return expiry;
  }

  /**
   * Check if OTP is expired
   * @param {Date} expiryDate - OTP expiry date
   * @returns {boolean} True if expired
   */
  isOTPExpired(expiryDate) {
    if (!expiryDate) return true;
    return new Date() > new Date(expiryDate);
  }

  /**
   * Verify OTP code
   * @param {string} inputOTP - User input OTP
   * @param {string} storedOTP - Stored OTP in database
   * @param {Date} expiryDate - OTP expiry date
   * @returns {Object} {valid: boolean, reason: string}
   */
  verifyOTP(inputOTP, storedOTP, expiryDate) {
    // Check if OTP exists
    if (!storedOTP) {
      return { valid: false, reason: 'No OTP found. Please request a new one.' };
    }

    // Check if OTP is expired
    if (this.isOTPExpired(expiryDate)) {
      return { valid: false, reason: 'OTP has expired. Please request a new one.' };
    }

    // Check if OTP matches
    if (inputOTP !== storedOTP) {
      return { valid: false, reason: 'Invalid OTP code. Please try again.' };
    }

    return { valid: true, reason: 'OTP verified successfully' };
  }

  /**
   * Check if user should be locked out due to too many failed attempts
   * @param {number} attempts - Number of failed attempts
   * @returns {boolean} True if locked out
   */
  isLockedOut(attempts) {
    const MAX_ATTEMPTS = 5;
    return attempts >= MAX_ATTEMPTS;
  }

  /**
   * Generate a secure random token for password reset or email verification
   * @param {number} length - Length of token (default 32)
   * @returns {string} Random token
   */
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }
}

module.exports = new OtpService();
