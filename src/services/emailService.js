const { Resend } = require('resend');
const storageService = require('./storageService');

class EmailService {
  constructor() {
    // Initialize Resend client
    this.resend = null;
    this.fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    this.initializeResend();
  }

  initializeResend() {
    const apiKey = process.env.RESEND_API_KEY;

    // Only create client if API key is configured
    if (apiKey) {
      this.resend = new Resend(apiKey);
      console.log('✅ Resend email service initialized');
    } else {
      console.warn('⚠️ Resend email service not configured. Set RESEND_API_KEY in .env');
    }
  }

  /**
   * Send documents to company email
   * @param {Object} params - Email parameters
   * @param {string} params.toEmail - Company email address
   * @param {string} params.toName - Company name
   * @param {string} params.fromName - Client name or email
   * @param {Array} params.documents - Array of document objects with filePathFinalPdf
   * @param {number} params.documentCount - Number of documents
   * @returns {Promise<Object>} - Email send result
   */
  async sendDocumentsToCompany({ toEmail, toName, fromName, documents, documentCount }) {
    if (!this.resend) {
      console.warn('⚠️ Resend email service not configured. Email not sent.');
      return { success: false, message: 'Email service not configured' };
    }

    try {
      console.log(`[EmailService] 📧 Preparing to send ${documentCount} documents to ${toEmail}...`);

      // Download PDFs from storage as base64 attachments
      const attachments = [];
      for (const doc of documents) {
        try {
          const pdfBuffer = await storageService.getProcessedPdf(doc.filePathFinalPdf);
          const fileName = doc.filePathFinalPdf.split('/').pop();

          // Convert buffer to base64
          const base64Content = pdfBuffer.toString('base64');

          attachments.push({
            filename: fileName,
            content: base64Content
          });

          console.log(`[EmailService] ✅ Prepared attachment: ${fileName} (${Math.round(pdfBuffer.length / 1024)}KB)`);
        } catch (error) {
          console.error(`[EmailService] ⚠️ Failed to prepare attachment for ${doc.filePathFinalPdf}:`, error.message);
        }
      }

      if (attachments.length === 0) {
        throw new Error('No valid PDF attachments could be prepared');
      }

      // Compose email HTML
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: #eb3089; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">📄 Nuevos Documentos</h1>
          </div>

          <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
              Hola <strong>${toName}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
              Has recibido <strong>${documentCount}</strong> ${documentCount === 1 ? 'documento' : 'documentos'} de <strong>${fromName}</strong>.
            </p>

            <div style="background-color: #f0f8ff; border-left: 4px solid #64c7cd; padding: 15px; margin: 20px 0; border-radius: 5px;">
              <p style="margin: 0; color: #333; font-size: 14px;">
                <strong>📎 Archivos adjuntos:</strong> ${attachments.length} PDF${attachments.length > 1 ? 's' : ''}
              </p>
            </div>

            <p style="font-size: 14px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
              También puedes ver estos documentos en tu panel de empresa:<br>
              <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/company/dashboard"
                 style="color: #eb3089; text-decoration: none; font-weight: bold;">
                Ir al Panel →
              </a>
            </p>

            <p style="font-size: 12px; color: #999; margin-top: 20px;">
              Este es un correo automático, por favor no responder.
            </p>
          </div>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>PDF Portal © ${new Date().getFullYear()}</p>
          </div>
        </div>
      `;

      // Send email via Resend
      console.log(`[EmailService] 📤 Sending email via Resend to ${toEmail}...`);
      console.log(`[EmailService] From: ${this.fromEmail}`);
      console.log(`[EmailService] Attachments: ${attachments.length} files`);

      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: toEmail,
        subject: `Nuevos documentos de ${fromName}`,
        html: htmlContent,
        attachments: attachments
      });

      // Check for Resend API errors
      if (error) {
        console.error(`[EmailService] ❌ Resend API error:`, error);
        throw new Error(`Resend API error: ${error.message || JSON.stringify(error)}`);
      }

      // Check if we got a valid response
      if (!data || !data.id) {
        console.error(`[EmailService] ❌ Invalid Resend response:`, data);
        throw new Error('Invalid response from Resend API - no message ID returned');
      }

      console.log(`[EmailService] ✅ Email sent successfully via Resend! ID: ${data.id}`);

      return {
        success: true,
        messageId: data.id,
        attachmentCount: attachments.length
      };
    } catch (error) {
      console.error('[EmailService] ❌ Error sending email via Resend:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send OTP verification email
   * @param {Object} params - Email parameters
   * @param {string} params.toEmail - User email address
   * @param {string} params.otpCode - 6-digit OTP code
   * @param {string} params.userType - 'client' or 'company'
   * @returns {Promise<Object>} - Email send result
   */
  async sendOTPEmail({ toEmail, otpCode, userType = 'client' }) {
    if (!this.resend) {
      console.warn('⚠️ Resend email service not configured. OTP email not sent.');
      return { success: false, message: 'Email service not configured' };
    }

    try {
      console.log(`[EmailService] 📧 Sending OTP email to ${toEmail}...`);

      const userTypeText = userType === 'company' ? 'empresa' : (userType === 'admin' ? 'administrador' : 'cliente');
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: #eb3089; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">🔐 Verificación de Email</h1>
          </div>

          <div style="background-color: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
              Hola,
            </p>

            <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
              Gracias por registrarte como ${userTypeText} en PDF Portal.
            </p>

            <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
              Para completar tu registro, por favor verifica tu correo electrónico usando el siguiente código:
            </p>

            <div style="background: linear-gradient(135deg, #eb3089 0%, #a5cc55 100%); padding: 20px; text-align: center; border-radius: 10px; margin: 30px 0;">
              <div style="background-color: white; display: inline-block; padding: 15px 40px; border-radius: 8px;">
                <p style="margin: 0; font-size: 32px; font-weight: bold; color: #eb3089; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                  ${otpCode}
                </p>
              </div>
            </div>

            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 5px;">
              <p style="margin: 0; color: #856404; font-size: 14px;">
                <strong>⏱️ Importante:</strong> Este código expirará en <strong>15 minutos</strong>.
              </p>
            </div>

            <p style="font-size: 14px; color: #666; margin-top: 30px;">
              Si no solicitaste este código, puedes ignorar este correo de forma segura.
            </p>

            <p style="font-size: 12px; color: #999; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
              Este es un correo automático, por favor no responder.
            </p>
          </div>

          <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
            <p>PDF Portal © ${new Date().getFullYear()}</p>
          </div>
        </div>
      `;

      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: toEmail,
        subject: `Código de verificación: ${otpCode}`,
        html: htmlContent
      });

      if (error) {
        console.error(`[EmailService] ❌ Resend API error:`, error);
        throw new Error(`Resend API error: ${error.message || JSON.stringify(error)}`);
      }

      if (!data || !data.id) {
        console.error(`[EmailService] ❌ Invalid Resend response:`, data);
        throw new Error('Invalid response from Resend API - no message ID returned');
      }

      console.log(`[EmailService] ✅ OTP email sent successfully via Resend! ID: ${data.id}`);

      return {
        success: true,
        messageId: data.id
      };
    } catch (error) {
      console.error('[EmailService] ❌ Error sending OTP email:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Test Resend configuration
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    if (!this.resend) {
      console.error('❌ Resend not configured');
      return false;
    }

    try {
      // Resend doesn't have a verify method, so we just check if client exists
      console.log('✅ Resend client initialized');
      return true;
    } catch (error) {
      console.error('❌ Resend configuration error:', error.message);
      return false;
    }
  }
}

module.exports = new EmailService();
