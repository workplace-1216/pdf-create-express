const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

class PdfProcessingService {
  constructor() {
    // pdfjs-dist will be loaded dynamically when needed for validation
    this.pdfjsLib = null;
  }

  /**
   * Load pdfjs-dist dynamically (ES module)
   * Used only for PDF validation
   */
  async loadPdfJs() {
    if (!this.pdfjsLib) {
      console.log('[PdfProcessingService] Loading pdfjs-dist for validation...');
      // Use dynamic import for ES module
      this.pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

      // Set worker source - convert Windows path to file:// URL
      const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

      // Convert to file:// URL for Windows compatibility
      const { pathToFileURL } = require('url');
      const workerUrl = pathToFileURL(workerPath).href;

      this.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

      console.log('[PdfProcessingService] pdfjs-dist loaded successfully');
    }
    return this.pdfjsLib;
  }

  /**
   * Validate PDF is readable using pdfjs-dist
   * @param {Buffer} pdfBuffer - PDF buffer to validate
   * @returns {Promise<{isValid: boolean, errors: Array<string>}>}
   */
  async validatePdf(pdfBuffer) {
    const errors = [];

    try {
      console.log('[PdfProcessingService] Validating PDF structure...');

      // Load pdfjs-dist dynamically
      const pdfjsLib = await this.loadPdfJs();

      // Try to load the PDF
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
        password: '', // Empty password for checking encryption
        isEvalSupported: false,
        useSystemFonts: false
      });

      try {
        const pdfDocument = await loadingTask.promise;
        console.log(`[PdfProcessingService] PDF is valid (${pdfDocument.numPages} pages)`);
      } catch (loadError) {
        if (loadError.name === 'PasswordException') {
          errors.push('PDF está protegido con contraseña. Por favor, proporcione un PDF sin contraseña.');
        } else {
          errors.push('Error al cargar el PDF: ' + loadError.message);
        }
      }

      console.log(`[PdfProcessingService] PDF validation completed. Errors: ${errors.length}`);

      return {
        isValid: errors.length === 0,
        errors: errors
      };
    } catch (error) {
      console.error('[PdfProcessingService] PDF validation failed:', error.message);
      return {
        isValid: false,
        errors: ['Error al validar el PDF: ' + error.message]
      };
    }
  }

  /**
   * Process PDF - Convert to 8-bit grayscale at 300 DPI
   * @param {Buffer} pdfBuffer - Original PDF buffer
   * @param {Object} vendorContext - Vendor information (not used in conversion)
   * @param {string} originalFileName - Original filename
   * @returns {Promise<{finalPdfBytes: Buffer, extractedData: Object}>}
   */
  async processPdf(pdfBuffer, vendorContext, originalFileName) {
    const startTime = Date.now();

    try {
      console.log('');
      console.log('========================================');
      console.log('[PdfProcessingService] Starting PDF to 8-bit Grayscale 300 DPI Conversion');
      console.log('========================================');
      console.log(`[PdfProcessingService] File: ${originalFileName}`);
      console.log(`[PdfProcessingService] Input size: ${(pdfBuffer.length / 1024).toFixed(2)} KB (${(pdfBuffer.length / (1024 * 1024)).toFixed(2)} MB)`);
      console.log('========================================');
      console.log('');

      // Step 1: Validate input buffer
      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error('Invalid PDF buffer: buffer is empty or null');
      }

      if (pdfBuffer.length < 100) {
        throw new Error('Invalid PDF buffer: file is too small to be a valid PDF');
      }

      // Check PDF signature (should start with %PDF)
      const pdfSignature = pdfBuffer.toString('utf-8', 0, 4);
      if (pdfSignature !== '%PDF') {
        throw new Error(`Invalid PDF format: file does not start with PDF signature (found: ${pdfSignature})`);
      }

      console.log('[PdfProcessingService] Input validation passed');
      console.log('');

      // Step 2: Validate PDF with pdfjs-dist
      console.log('[PdfProcessingService] Step 1/2: Validating PDF structure...');
      const validation = await this.validatePdf(pdfBuffer);
      if (!validation.isValid) {
        const errorMessage = validation.errors.join('; ');
        console.error('[PdfProcessingService] PDF validation failed:', errorMessage);
        throw new Error(`PDF validation failed: ${errorMessage}`);
      }
      console.log('[PdfProcessingService] Step 1/2 Complete: PDF structure is valid');
      console.log('');

      // Step 3: Convert to 8-bit grayscale at 300 DPI
      console.log('[PdfProcessingService] Step 2/2: Converting to 8-bit grayscale at 300 DPI...');
      console.log('[PdfProcessingService] Using direct Ghostscript conversion for best quality');
      console.log('');

      const convertedPdfBytes = await this.convertToGrayscale300DPI(pdfBuffer, originalFileName);

      // Validate output
      if (!convertedPdfBytes || convertedPdfBytes.length === 0) {
        throw new Error('Conversion failed: output buffer is empty');
      }

      const outputSizeKB = (convertedPdfBytes.length / 1024).toFixed(2);
      const outputSizeMB = (convertedPdfBytes.length / (1024 * 1024)).toFixed(2);
      const processingTimeSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log('');
      console.log('[PdfProcessingService] Step 2/2 Complete: Conversion successful');
      console.log('');
      console.log('========================================');
      console.log('[PdfProcessingService] PDF CONVERSION COMPLETE!');
      console.log('========================================');
      console.log(`[PdfProcessingService] Output size: ${outputSizeKB} KB (${outputSizeMB} MB)`);
      console.log(`[PdfProcessingService] Format: 8-bit Grayscale PDF`);
      console.log(`[PdfProcessingService] Resolution: 300 DPI (for rasterized content)`);
      console.log(`[PdfProcessingService] Vector graphics: Preserved`);
      console.log(`[PdfProcessingService] Text: Searchable and selectable`);
      console.log(`[PdfProcessingService] Processing time: ${processingTimeSeconds}s`);
      console.log('========================================');
      console.log('');

      return {
        finalPdfBytes: convertedPdfBytes,
        extractedData: {
          message: 'PDF converted to 8-bit grayscale at 300 DPI',
          inputSize: pdfBuffer.length,
          outputSize: convertedPdfBytes.length,
          processingTime: processingTimeSeconds,
          format: '8-bit Grayscale PDF',
          resolution: '300 DPI',
          vectorsPreserved: true,
          textSearchable: true
        }
      };
    } catch (error) {
      const processingTimeSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

      console.error('');
      console.error('========================================');
      console.error('[PdfProcessingService] PDF CONVERSION FAILED');
      console.error('========================================');
      console.error(`[PdfProcessingService] File: ${originalFileName}`);
      console.error(`[PdfProcessingService] Error: ${error.message}`);
      console.error(`[PdfProcessingService] Processing time: ${processingTimeSeconds}s`);
      console.error('========================================');
      console.error('');

      // Re-throw with more context
      throw new Error(`PDF conversion failed for ${originalFileName}: ${error.message}`);
    }
  }

  /**
   * Convert PDF to 8-bit grayscale at 300 DPI using direct Ghostscript conversion
   * This method uses Ghostscript's pdfwrite device for high-quality direct conversion
   * that preserves vector graphics and text while converting to grayscale.
   *
   * @param {Buffer} pdfBuffer - Original PDF buffer
   * @param {string} originalFileName - Original filename
   * @returns {Promise<Buffer>} - Converted PDF buffer
   */
  async convertToGrayscale300DPI(pdfBuffer, originalFileName) {
    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, '../../temp');
    try {
      await fs.mkdir(tempDir, { recursive: true });
    } catch (err) {
      // Directory already exists
    }

    // Generate unique temp filenames
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(7);
    const inputPath = path.join(tempDir, `input_${timestamp}_${randomStr}.pdf`);
    const outputPath = path.join(tempDir, `output_${timestamp}_${randomStr}.pdf`);

    // Use Ghostscript conversion script
    const scriptPath = path.join(__dirname, '../../scripts/convert_with_ghostscript.py');

    try {
      // Write input PDF to temp file
      await fs.writeFile(inputPath, pdfBuffer);
      const inputSizeMB = (pdfBuffer.length / (1024 * 1024)).toFixed(2);
      console.log(`[PdfProcessingService] Temp input: ${inputPath} (${inputSizeMB} MB)`);

      // Run Ghostscript-based Python conversion script
      console.log('[PdfProcessingService] Running direct Ghostscript PDF-to-grayscale conversion...');
      console.log('[PdfProcessingService] Using pdfwrite device (preserves vectors and text)');

      await new Promise((resolve, reject) => {
        // Arguments: input.pdf output.pdf --dpi 300
        const python = spawn('python', [
          scriptPath,
          inputPath,
          outputPath,
          '--dpi', '300'
        ], {
          // Set timeout for spawn
          timeout: 300000 // 5 minutes
        });

        let stdout = '';
        let stderr = '';

        python.stdout.on('data', (data) => {
          const output = data.toString();
          stdout += output;
          // Log each line separately for better readability
          output.trim().split('\n').forEach(line => {
            if (line.trim()) {
              console.log(`[Python] ${line.trim()}`);
            }
          });
        });

        python.stderr.on('data', (data) => {
          const output = data.toString();
          stderr += output;
          // Only log actual errors, not warnings
          output.trim().split('\n').forEach(line => {
            if (line.trim()) {
              console.error(`[Python Error] ${line.trim()}`);
            }
          });
        });

        python.on('close', (code) => {
          if (code === 0) {
            console.log('[PdfProcessingService] Python script completed successfully');
            resolve();
          } else {
            const errorMsg = `Ghostscript conversion failed with exit code ${code}`;
            console.error(`[PdfProcessingService] ${errorMsg}`);
            if (stderr) {
              console.error(`[PdfProcessingService] Error output: ${stderr}`);
            }
            reject(new Error(`${errorMsg}${stderr ? ': ' + stderr : ''}`));
          }
        });

        python.on('error', (err) => {
          const errorMsg = `Failed to start Python process: ${err.message}`;
          console.error(`[PdfProcessingService] ${errorMsg}`);
          reject(new Error(errorMsg));
        });
      });

      // Verify output file exists
      try {
        await fs.access(outputPath);
      } catch (err) {
        throw new Error(`Output file not created: ${outputPath}`);
      }

      // Read converted PDF
      const convertedBuffer = await fs.readFile(outputPath);
      const outputSizeMB = (convertedBuffer.length / (1024 * 1024)).toFixed(2);
      const sizeChange = ((convertedBuffer.length - pdfBuffer.length) / pdfBuffer.length * 100).toFixed(1);

      console.log(`[PdfProcessingService] Converted PDF size: ${outputSizeMB} MB (${sizeChange > 0 ? '+' : ''}${sizeChange}%)`);
      console.log(`[PdfProcessingService] Format: 8-bit Grayscale PDF with vector graphics preserved`);

      // Cleanup temp files
      try {
        await fs.unlink(inputPath);
        await fs.unlink(outputPath);
        console.log('[PdfProcessingService] Temp files cleaned up successfully');
      } catch (cleanupError) {
        console.warn('[PdfProcessingService] Failed to cleanup temp files:', cleanupError.message);
      }

      return convertedBuffer;
    } catch (error) {
      console.error('[PdfProcessingService] Conversion error:', error.message);

      // Cleanup on error
      try {
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
        console.log('[PdfProcessingService] Error cleanup completed');
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      throw error;
    }
  }
}

module.exports = new PdfProcessingService();
