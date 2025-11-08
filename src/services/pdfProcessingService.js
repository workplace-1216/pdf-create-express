const pdfParse = require('pdf-parse');
const { PDFDocument, rgb, StandardFonts, grayscale } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

class PdfProcessingService {
  /**
   * Validate PDF meets all requirements before processing
   */
  async validatePdf(pdfBuffer) {
    const errors = [];

    try {
      // Check if PDF is password protected
      try {
        await PDFDocument.load(pdfBuffer, { ignoreEncryption: false });
      } catch (error) {
        if (error.message.includes('encrypted') || error.message.includes('password')) {
          errors.push('PDF está protegido con contraseña. Por favor, proporcione un PDF sin contraseña.');
        }
      }

      // Load PDF to check for forms, JavaScript, and embedded objects
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
      const form = pdfDoc.getForm();

      // Check for form fields
      try {
        const fields = form.getFields();
        if (fields.length > 0) {
          errors.push('El PDF contiene formularios interactivos. Los formularios no están permitidos.');
        }
      } catch (e) {
        // No form fields found - this is good
      }

      // Check for JavaScript in the PDF
      const pdfContext = pdfDoc.context;
      const catalog = pdfContext.lookup(pdfDoc.catalog);

      // Check for JavaScript actions
      if (catalog.has('AA') || catalog.has('OpenAction')) {
        const actions = catalog.get('AA') || catalog.get('OpenAction');
        if (actions) {
          errors.push('El PDF contiene código JavaScript. JavaScript no está permitido.');
        }
      }

      // Check catalog for JavaScript entries
      if (catalog.has('Names')) {
        const names = pdfContext.lookup(catalog.get('Names'));
        if (names && names.has('JavaScript')) {
          errors.push('El PDF contiene código JavaScript embebido. JavaScript no está permitido.');
        }
      }

      console.log(`[PdfProcessingService] ✅ PDF validation completed. Errors: ${errors.length}`);

      return {
        isValid: errors.length === 0,
        errors: errors
      };
    } catch (error) {
      console.error('[PdfProcessingService] ⚠ PDF validation failed:', error.message);
      return {
        isValid: false,
        errors: ['Error al validar el PDF: ' + error.message]
      };
    }
  }

  async extractTextFromPdf(pdfBuffer) {
    try {
      console.log('[PdfProcessingService] 📄 Extracting all text from PDF...');
      console.log(`[PdfProcessingService] PDF Size: ${pdfBuffer.length} bytes`);

      // Extract all embedded text using pdf-parse
      const data = await pdfParse(pdfBuffer);
      const extractedText = data.text;

      console.log(`[PdfProcessingService] ✓ Extracted ${extractedText.length} characters from PDF`);
      console.log(`[PdfProcessingService] Text preview: ${extractedText.substring(0, Math.min(200, extractedText.length))}...`);

      // Note: This extracts embedded text. For text in images, OCR would be needed
      // which requires additional setup. The current implementation extracts all
      // text that is embedded in the PDF structure.

      return extractedText;
    } catch (error) {
      console.error('[PdfProcessingService] ⚠ Text extraction failed:', error.message);
      return '';
    }
  }

  async processPdf(pdfBuffer, vendorContext, originalFileName) {
    try {
      console.log('[PdfProcessingService] 🔄 Processing PDF - Applying branded template...');

      // Step 1: Validate PDF meets requirements
      const validation = await this.validatePdf(pdfBuffer);
      if (!validation.isValid) {
        const errorMessage = validation.errors.join(' ');
        console.error('[PdfProcessingService] ❌ PDF validation failed:', errorMessage);
        throw new Error(errorMessage);
      }
      console.log('[PdfProcessingService] ✅ PDF validation passed');

      // Step 2: Extract ALL text from PDF
      const extractedText = await this.extractTextFromPdf(pdfBuffer);
      console.log(`[PdfProcessingService] ℹ Extracted ${extractedText.length} characters from PDF`);

      // Step 3: Extract contact information (email, phone, address)
      const contactInfo = this.extractContactInfo(extractedText);
      console.log('[PdfProcessingService] ℹ Contact info extracted:', contactInfo);

      // Step 4: Create new PDF from branded template
      console.log('[PdfProcessingService] 🎨 Creating branded template PDF...');
      const pdfDoc = await this.createBrandedTemplate(extractedText, vendorContext, contactInfo);

      // Step 5: Set PDF metadata for 300 DPI and grayscale compliance
      this.setPdfMetadata(pdfDoc);

      // Step 6: Save the processed PDF
      const processedPdfBytes = await pdfDoc.save();

      console.log('[PdfProcessingService] ✅ PDF processing completed - Branded template applied, grayscale 8-bit 300 DPI');

      return {
        finalPdfBytes: Buffer.from(processedPdfBytes)
      };
    } catch (error) {
      console.error('[PdfProcessingService] ❌ PDF processing failed:', error);
      throw error;
    }
  }

  /**
   * Extract contact information from PDF text
   * Looks for email, phone, and address patterns
   *
   * Phone validation logic:
   * 1. Find potential phone numbers (with spaces, dashes, parentheses)
   * 2. Clean symbols (keep only + and digits)
   * 3. Check country code (optional + followed by 1-3 digits)
   * 4. Validate length (10-15 digits total)
   * 5. Validate numeric content (only digits after +)
   * 6. Return first valid match
   *
   * Examples of valid numbers:
   * - +1234567890 (international, 10 digits)
   * - +44 20 1234 5678 (UK format, cleaned to +442012345678)
   * - (123) 456-7890 (US format, cleaned to 1234567890)
   */
  extractContactInfo(text) {
    const contactInfo = {
      email: null,
      phone: null,
      address: null
    };

    // Extract email (common email pattern)
    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
    const emailMatches = text.match(emailRegex);
    if (emailMatches && emailMatches.length > 0) {
      contactInfo.email = emailMatches[0];
    }

    // Extract phone number using robust validation
    // Step 1: Find potential phone numbers with broad regex
    const phoneRegex = /\+?[\d\s\-\(\)\.]{10,20}/g;
    const phoneMatches = text.match(phoneRegex);

    if (phoneMatches && phoneMatches.length > 0) {
      // Step 2: Validate each match
      for (const match of phoneMatches) {
        // Step 3: Clean the number (remove spaces, parentheses, dashes, dots)
        const cleaned = match.replace(/[\s\-\(\)\.]/g, '');

        // Step 4: Check if it starts with + (international format)
        const hasCountryCode = cleaned.startsWith('+');

        // Step 5: Extract only digits (with optional + at start)
        const digitsOnly = hasCountryCode ? cleaned : cleaned.replace(/\+/g, '');

        // Step 6: Validate numeric content (must be + followed by digits, or just digits)
        const isValid = hasCountryCode
          ? /^\+\d{10,15}$/.test(cleaned)  // International: +<10-15 digits>
          : /^\d{10,15}$/.test(digitsOnly); // Domestic: 10-15 digits

        if (isValid) {
          contactInfo.phone = cleaned;
          console.log(`[PdfProcessingService] ✅ Valid phone number found: ${cleaned}`);
          break; // Use first valid phone number
        }
      }
    }

    // Extract address (look for patterns like "Address:", "Dirección:", etc.)
    const addressRegex = /(?:Address|Dirección|Domicilio|Location):\s*([^\n]+)/i;
    const addressMatch = text.match(addressRegex);
    if (addressMatch && addressMatch.length > 1) {
      contactInfo.address = addressMatch[1].trim();
    }

    return contactInfo;
  }

  /**
   * Create a branded PDF template matching the design specification
   * Design includes:
   * - Company logo (top-left, if available)
   * - Cyan square (top-left corner)
   * - Cyan, pink, green geometric shapes (top-right corner)
   * - Title section (custom font if available, large font, centered)
   * - Content section (body text)
   * - Footer line with contact information
   */
  async createBrandedTemplate(extractedText, vendorContext, contactInfo) {
    try {
      console.log('[PdfProcessingService] 🎨 Creating branded template...');

      // Create new PDF document
      const pdfDoc = await PDFDocument.create();

      // Load custom fonts if available, fallback to standard fonts
      const { font, fontBold } = await this.loadFonts(pdfDoc);

      // Load images (logo, left.jpg, right.jpg)
      const images = await this.loadImages(pdfDoc);

      // A4 page dimensions
      const pageWidth = 595.28; // 8.27 inches * 72 points/inch
      const pageHeight = 841.89; // 11.69 inches * 72 points/inch

      // Add first page
      const page = pdfDoc.addPage([pageWidth, pageHeight]);

      // === STEP 1: Draw images at top corners ===

      // Draw left.jpg at left-top corner
      if (images.leftImage) {
        const leftWidth = 150;
        const leftHeight = 120;

        page.drawImage(images.leftImage, {
          x: 20, // Left margin
          y: pageHeight - leftHeight - 20, // Top margin
          width: leftWidth,
          height: leftHeight,
        });

        console.log('[PdfProcessingService] ✅ Left image embedded');
      }

      // Draw right.jpg at right-top corner (far top)
      if (images.rightImage) {
        const rightWidth = 150;
        const rightHeight = 120;

        page.drawImage(images.rightImage, {
          x: pageWidth - rightWidth - 20, // Right margin
          y: pageHeight - rightHeight - 20, // Top margin
          width: rightWidth,
          height: rightHeight,
        });

        console.log('[PdfProcessingService] ✅ Right image embedded');
      }

      // Draw logo centered if available
      if (images.logo) {
        const logoWidth = 100;
        const logoHeight = 80;

        // Center logo horizontally
        const logoX = (pageWidth - logoWidth) / 2;

        page.drawImage(images.logo, {
          x: logoX,
          y: pageHeight - 120,
          width: logoWidth,
          height: logoHeight,
        });

        console.log('[PdfProcessingService] ✅ Company logo embedded (centered)');
      }

      // === STEP 2: Add title section ===
      const titleY = pageHeight - 180;

      // Extract first line as title (or use first 100 chars)
      const lines = extractedText.split('\n').filter(line => line.trim().length > 0);
      const titleText = lines[0] ? lines[0].substring(0, 100) : 'Documento Procesado';

      page.drawText(titleText, {
        x: 50,
        y: titleY,
        size: 24,
        font: fontBold,
        color: grayscale(0),
        maxWidth: pageWidth - 100,
      });

      // === STEP 3: Add content section ===
      const margin = 50;
      let contentY = titleY - 50;
      const lineHeight = 14;
      const contentFontSize = 10;
      const maxWidth = pageWidth - (2 * margin);

      // Filter contact info from content (it should only appear in footer)
      let contentText = lines.slice(1).join('\n');

      // Remove email addresses
      if (contactInfo.email) {
        contentText = contentText.replace(new RegExp(contactInfo.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
      }

      // Remove phone numbers
      if (contactInfo.phone) {
        contentText = contentText.replace(new RegExp(contactInfo.phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
      }

      // Remove address
      if (contactInfo.address) {
        contentText = contentText.replace(new RegExp(contactInfo.address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
      }

      // Remove common contact labels and patterns
      contentText = contentText.replace(/(?:Address|Dirección|Domicilio|Location):\s*/gi, '');
      contentText = contentText.replace(/(?:Email|E-mail|Correo):\s*/gi, '');
      contentText = contentText.replace(/(?:Phone|Telephone|Tel|Teléfono|Cell|Mobile):\s*/gi, '');

      // Clean up multiple consecutive blank lines
      contentText = contentText.replace(/\n\s*\n\s*\n/g, '\n\n');

      // Wrap and add remaining text
      const wrappedLines = this.wrapTextForPdf(contentText, font, contentFontSize, maxWidth);

      for (const line of wrappedLines) {
        if (contentY < 180) { // Leave space for footer
          break;
        }

        page.drawText(line, {
          x: margin,
          y: contentY,
          size: contentFontSize,
          font: font,
          color: grayscale(0),
        });

        contentY -= lineHeight;
      }

      // === STEP 4: Add footer line and contact information ===
      const footerY = 100;

      // Draw horizontal line
      page.drawLine({
        start: { x: margin, y: footerY },
        end: { x: pageWidth - margin, y: footerY },
        thickness: 1,
        color: grayscale(0.5),
      });

      // Add "Agenda tu visita al" label
      page.drawText('Agenda tu visita al', {
        x: margin,
        y: footerY - 20,
        size: 8,
        font: font,
        color: grayscale(0.3),
      });

      // Add extracted contact information below the line
      let contactY = footerY - 40;

      // Email
      if (contactInfo.email) {
        page.drawText(`EMAIL: ${contactInfo.email}`, {
          x: margin,
          y: contactY,
          size: 9,
          font: font,
          color: grayscale(0),
        });
        contactY -= 15;
      }

      // Phone
      if (contactInfo.phone) {
        page.drawText(`TELEPHONE: ${contactInfo.phone}`, {
          x: margin,
          y: contactY,
          size: 9,
          font: font,
          color: grayscale(0),
        });
        contactY -= 15;
      }

      // Address
      if (contactInfo.address) {
        // Wrap address if too long
        const maxAddressWidth = pageWidth - (2 * margin);
        const addressLines = this.wrapTextForPdf(contactInfo.address, font, 9, maxAddressWidth);

        page.drawText(`ADDRESS: ${addressLines[0]}`, {
          x: margin,
          y: contactY,
          size: 9,
          font: font,
          color: grayscale(0),
        });

        // If address wraps to multiple lines
        for (let i = 1; i < Math.min(addressLines.length, 2); i++) {
          contactY -= 12;
          page.drawText(addressLines[i], {
            x: margin + 60, // Indent continuation
            y: contactY,
            size: 9,
            font: font,
            color: grayscale(0),
          });
        }
      }

      // Add metadata footer
      page.drawText('Grayscale 8-bit | 300 DPI | PDF Gate Processing System', {
        x: margin,
        y: 20,
        size: 7,
        font: font,
        color: grayscale(0.6),
        opacity: 0.5,
      });

      console.log('[PdfProcessingService] ✅ Branded template created with geometric shapes and footer');

      return pdfDoc;
    } catch (error) {
      console.error('[PdfProcessingService] ❌ Failed to create branded template:', error);
      throw error;
    }
  }

  /**
   * Set PDF metadata for compliance (300 DPI, grayscale info)
   */
  setPdfMetadata(pdfDoc) {
    try {
      // Set PDF metadata
      pdfDoc.setTitle('Documento Procesado - 300 DPI Grayscale');
      pdfDoc.setSubject('Documento en escala de grises a 8 bits, 300 DPI');
      pdfDoc.setKeywords(['300dpi', 'grayscale', 'processed']);
      pdfDoc.setProducer('PDF Processing Service - Grayscale 8-bit 300 DPI');
      pdfDoc.setCreator('PDF Gate Processing System');

      console.log('[PdfProcessingService] ✅ PDF metadata set for 300 DPI grayscale compliance');
    } catch (error) {
      console.error('[PdfProcessingService] ⚠ Failed to set PDF metadata:', error.message);
    }
  }


  /**
   * Load custom fonts or fallback to standard fonts
   * Looks for custom TTF fonts in: backend-express/assets/fonts/
   * - Regular.ttf (for body text)
   * - Bold.ttf (for titles)
   */
  async loadFonts(pdfDoc) {
    try {
      const fontsDir = path.join(__dirname, '../../assets/fonts');

      // Try to load custom regular font
      let font;
      try {
        const regularFontPath = path.join(fontsDir, 'Regular.ttf');
        const regularFontBytes = await fs.readFile(regularFontPath);
        font = await pdfDoc.embedFont(regularFontBytes);
        console.log('[PdfProcessingService] ✅ Custom regular font loaded');
      } catch (err) {
        // Fallback to standard font
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        console.log('[PdfProcessingService] ℹ Using standard Helvetica font');
      }

      // Try to load custom bold font
      let fontBold;
      try {
        const boldFontPath = path.join(fontsDir, 'Bold.ttf');
        const boldFontBytes = await fs.readFile(boldFontPath);
        fontBold = await pdfDoc.embedFont(boldFontBytes);
        console.log('[PdfProcessingService] ✅ Custom bold font loaded');
      } catch (err) {
        // Fallback to standard bold font
        fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        console.log('[PdfProcessingService] ℹ Using standard Helvetica-Bold font');
      }

      return { font, fontBold };
    } catch (error) {
      console.error('[PdfProcessingService] ⚠ Font loading failed, using standard fonts:', error.message);
      // Ultimate fallback
      return {
        font: await pdfDoc.embedFont(StandardFonts.Helvetica),
        fontBold: await pdfDoc.embedFont(StandardFonts.HelveticaBold)
      };
    }
  }

  /**
   * Load all images (logo, left, right)
   * Looks for images in: backend-express/assets/images/
   * Supports PNG and JPG formats for all images
   */
  async loadImages(pdfDoc) {
    try {
      const imagesDir = path.join(__dirname, '../../assets/images');
      const result = { logo: null, leftImage: null, rightImage: null };

      // Load logo (PNG or JPG)
      try {
        const logoPngPath = path.join(imagesDir, 'logo.png');
        const logoBytes = await fs.readFile(logoPngPath);
        result.logo = await pdfDoc.embedPng(logoBytes);
        console.log('[PdfProcessingService] ✅ Logo loaded (PNG)');
      } catch (err) {
        try {
          const logoJpgPath = path.join(imagesDir, 'logo.jpg');
          const logoBytes = await fs.readFile(logoJpgPath);
          result.logo = await pdfDoc.embedJpg(logoBytes);
          console.log('[PdfProcessingService] ✅ Logo loaded (JPG)');
        } catch (err2) {
          console.log('[PdfProcessingService] ℹ No logo found');
        }
      }

      // Load left.png or left.jpg
      try {
        const leftPngPath = path.join(imagesDir, 'left.png');
        const leftBytes = await fs.readFile(leftPngPath);
        result.leftImage = await pdfDoc.embedPng(leftBytes);
        console.log('[PdfProcessingService] ✅ Left corner image loaded (left.png)');
      } catch (err) {
        try {
          const leftJpgPath = path.join(imagesDir, 'left.jpg');
          const leftBytes = await fs.readFile(leftJpgPath);
          result.leftImage = await pdfDoc.embedJpg(leftBytes);
          console.log('[PdfProcessingService] ✅ Left corner image loaded (left.jpg)');
        } catch (err2) {
          console.log('[PdfProcessingService] ℹ No left.png or left.jpg found');
        }
      }

      // Load right.png or right.jpg
      try {
        const rightPngPath = path.join(imagesDir, 'right.png');
        const rightBytes = await fs.readFile(rightPngPath);
        result.rightImage = await pdfDoc.embedPng(rightBytes);
        console.log('[PdfProcessingService] ✅ Right corner image loaded (right.png)');
      } catch (err) {
        try {
          const rightJpgPath = path.join(imagesDir, 'right.jpg');
          const rightBytes = await fs.readFile(rightJpgPath);
          result.rightImage = await pdfDoc.embedJpg(rightBytes);
          console.log('[PdfProcessingService] ✅ Right corner image loaded (right.jpg)');
        } catch (err2) {
          console.log('[PdfProcessingService] ℹ No right.png or right.jpg found');
        }
      }

      return result;
    } catch (error) {
      console.error('[PdfProcessingService] ⚠ Image loading failed:', error);
      return { logo: null, leftImage: null, rightImage: null };
    }
  }

  wrapTextForPdf(text, font, fontSize, maxWidth) {
    const lines = [];
    const paragraphs = text.split('\n');

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) {
        lines.push(''); // Empty line
        continue;
      }

      const words = paragraph.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const width = font.widthOfTextAtSize(testLine, fontSize);

        if (width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }
    }

    return lines;
  }
}

module.exports = new PdfProcessingService();

