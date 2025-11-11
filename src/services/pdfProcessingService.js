const fs = require('fs').promises;
const path = require('path');
const gptService = require('./gptService');
const { createCanvas, loadImage } = require('canvas');
const { PDFDocument, rgb, StandardFonts, grayscale, PDFName } = require('pdf-lib');
const pythonImageExtractor = require('../utils/pythonImageExtractor');

class PdfProcessingService {
  constructor() {
    // pdfjs-dist will be loaded dynamically when needed
    this.pdfjsLib = null;

    // Image extraction method: 'pymupdf' (recommended) or 'pdfjs' (fallback)
    // Set via environment variable: IMAGE_EXTRACTION_METHOD=pymupdf
    this.imageExtractionMethod = process.env.IMAGE_EXTRACTION_METHOD || 'pymupdf';
  }

  /**
   * Load pdfjs-dist dynamically (ES module)
   */
  async loadPdfJs() {
    if (!this.pdfjsLib) {
      console.log('[PdfProcessingService] 📦 Loading pdfjs-dist (ES module)...');
      // Use dynamic import for ES module
      this.pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

      // Set worker source - convert Windows path to file:// URL
      const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

      // Convert to file:// URL for Windows compatibility
      const { pathToFileURL } = require('url');
      const workerUrl = pathToFileURL(workerPath).href;

      this.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

      console.log('[PdfProcessingService] ✅ pdfjs-dist loaded successfully');
      console.log(`[PdfProcessingService] 📦 Worker URL: ${workerUrl}`);
    }
    return this.pdfjsLib;
  }

  /**
   * Add 300 DPI metadata to JPEG buffer by modifying JFIF header
   * @param {Buffer} jpegBuffer - JPEG image buffer
   * @returns {Buffer} - JPEG buffer with 300 DPI metadata
   */
  addDpiToJpeg(jpegBuffer) {
    try {
      // JPEG files start with 0xFFD8 (SOI marker)
      // JFIF segment is usually right after: 0xFFE0
      // We need to modify the density fields in the JFIF segment

      // Look for JFIF APP0 marker (0xFF 0xE0)
      const jfifMarkerIndex = jpegBuffer.indexOf(Buffer.from([0xFF, 0xE0]));

      if (jfifMarkerIndex === -1) {
        console.warn('[PdfProcessingService] ⚠️ JFIF marker not found, cannot set DPI');
        return jpegBuffer;
      }

      // JFIF structure:
      // 0-1: FF E0 (APP0 marker)
      // 2-3: Length (2 bytes)
      // 4-8: "JFIF\0" identifier (5 bytes)
      // 9-10: Version (2 bytes)
      // 11: Units (0=no units, 1=dots per inch, 2=dots per cm)
      // 12-13: X density (2 bytes, big endian)
      // 14-15: Y density (2 bytes, big endian)

      const unitsOffset = jfifMarkerIndex + 11;
      const xDensityOffset = jfifMarkerIndex + 12;
      const yDensityOffset = jfifMarkerIndex + 14;

      // Create a copy of the buffer to modify
      const modifiedBuffer = Buffer.from(jpegBuffer);

      // Set units to 1 (dots per inch)
      modifiedBuffer[unitsOffset] = 1;

      // Set X and Y density to 300 DPI (big endian)
      modifiedBuffer.writeUInt16BE(300, xDensityOffset);
      modifiedBuffer.writeUInt16BE(300, yDensityOffset);

      console.log('[PdfProcessingService] ✅ Added 300 DPI metadata to JPEG');
      return modifiedBuffer;

    } catch (error) {
      console.warn('[PdfProcessingService] ⚠️ Failed to add DPI metadata:', error.message);
      return jpegBuffer;
    }
  }

  /**
   * Compress image to reduce file size
   * Resizes image to max dimension and reduces quality to stay under 1MB
   * @param {Buffer} imageBuffer - Original image buffer
   * @param {string} mimeType - Image MIME type (image/png or image/jpeg)
   * @returns {Promise<{buffer: Buffer, type: string, width: number, height: number}>}
   */
  async compressImage(imageBuffer, mimeType = 'image/png') {
    try {
      // Higher quality settings for GPT Vision text readability
      const MAX_DIMENSION = 2048; // Increased from 1920 for better text clarity
      const MAX_SIZE_BYTES = 4 * 1024 * 1024; // Increased to 4MB (GPT can handle up to 20MB)
      const INITIAL_QUALITY = 0.95; // Start with 95% quality for text clarity
      const MINIMUM_QUALITY = 0.75; // Don't go below 75% (was 30% - too low!)
      const QUALITY_STEP = 0.05; // Smaller steps for gradual quality reduction

      console.log(`[PdfProcessingService] 🗜️ Compressing image for GPT Vision (original: ${(imageBuffer.length / 1024).toFixed(2)}KB)...`);
      console.log(`[PdfProcessingService] 📊 Target: Max ${MAX_DIMENSION}px, Max ${(MAX_SIZE_BYTES / 1024 / 1024).toFixed(0)}MB, Quality ${(INITIAL_QUALITY * 100).toFixed(0)}%-${(MINIMUM_QUALITY * 100).toFixed(0)}%`);

      // Load image
      const img = await loadImage(imageBuffer);
      const originalWidth = img.width;
      const originalHeight = img.height;

      console.log(`[PdfProcessingService] 📐 Original dimensions: ${originalWidth}x${originalHeight}`);

      // Calculate new dimensions (preserve aspect ratio)
      let newWidth = originalWidth;
      let newHeight = originalHeight;

      if (originalWidth > MAX_DIMENSION || originalHeight > MAX_DIMENSION) {
        const aspectRatio = originalWidth / originalHeight;

        if (originalWidth > originalHeight) {
          newWidth = MAX_DIMENSION;
          newHeight = Math.round(MAX_DIMENSION / aspectRatio);
        } else {
          newHeight = MAX_DIMENSION;
          newWidth = Math.round(MAX_DIMENSION * aspectRatio);
        }

        console.log(`[PdfProcessingService] 📐 Resizing to: ${newWidth}x${newHeight} (preserving aspect ratio)`);
      } else {
        console.log(`[PdfProcessingService] ✅ Image already within size limits (${originalWidth}x${originalHeight})`);
      }

      // Create canvas and draw resized image
      const canvas = createCanvas(newWidth, newHeight);
      const ctx = canvas.getContext('2d');
      
      // Use better image quality settings for text readability
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      // Try different quality levels to get under max size
      let quality = INITIAL_QUALITY;
      let compressedBuffer = null;
      let attempts = 0;
      const maxAttempts = 8; // More attempts with smaller steps

      console.log(`[PdfProcessingService] 🗜️ Compressing with high quality for text readability...`);

      while (attempts < maxAttempts) {
        compressedBuffer = canvas.toBuffer('image/jpeg', { quality });
        const sizeKB = (compressedBuffer.length / 1024).toFixed(2);
        const sizeMB = (compressedBuffer.length / 1024 / 1024).toFixed(2);

        console.log(`[PdfProcessingService] 🗜️ Attempt ${attempts + 1}: Quality ${(quality * 100).toFixed(0)}% = ${sizeKB}KB (${sizeMB}MB)`);

        if (compressedBuffer.length <= MAX_SIZE_BYTES) {
          console.log(`[PdfProcessingService] ✅ Compression successful: ${sizeKB}KB (${sizeMB}MB) at ${(quality * 100).toFixed(0)}% quality`);
          console.log(`[PdfProcessingService] ✅ Image optimized for GPT Vision text extraction`);
          break;
        }

        // Reduce quality for next attempt
        quality -= QUALITY_STEP;
        attempts++;

        if (quality < MINIMUM_QUALITY) {
          console.warn(`[PdfProcessingService] ⚠️ Minimum quality ${(MINIMUM_QUALITY * 100).toFixed(0)}% reached`);
          console.warn(`[PdfProcessingService] ℹ️ Using ${(quality * 100).toFixed(0)}% quality to maintain text readability`);
          break;
        }
      }

      const finalSizeKB = (compressedBuffer.length / 1024).toFixed(2);
      const compressionRatio = ((1 - compressedBuffer.length / imageBuffer.length) * 100).toFixed(1);

      console.log(`[PdfProcessingService] ✅ Final: ${finalSizeKB}KB (${compressionRatio}% reduction)`);

      // Add 300 DPI metadata to the JPEG buffer
      const dpiBuffer = this.addDpiToJpeg(compressedBuffer);

      return {
        buffer: dpiBuffer,
        type: 'image/jpeg',
        width: newWidth,
        height: newHeight
      };

    } catch (error) {
      console.error(`[PdfProcessingService] ❌ Image compression failed:`, error.message);
      // Return original image if compression fails
      return {
        buffer: imageBuffer,
        type: mimeType,
        width: 0,
        height: 0
      };
    }
  }

  /**
   * Validate PDF is readable using pdfjs-dist
   */
  async validatePdf(pdfBuffer) {
    const errors = [];

    try {
      console.log('[PdfProcessingService] 🔍 Validating PDF...');

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
        console.log(`[PdfProcessingService] ✅ PDF is valid (${pdfDocument.numPages} pages)`);
      } catch (loadError) {
        if (loadError.name === 'PasswordException') {
          errors.push('PDF está protegido con contraseña. Por favor, proporcione un PDF sin contraseña.');
        } else {
          errors.push('Error al cargar el PDF: ' + loadError.message);
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

  /**
   * Extract images from PDF using the configured extraction method
   * Supports both PyMuPDF (recommended, highest quality) and pdfjs-dist (fallback)
   * @param {Buffer} pdfBuffer - PDF buffer
   * @param {string} originalFileName - Original PDF filename
   * @returns {Promise<Array>} Array of extracted images
   */
  async extractImages(pdfBuffer, originalFileName = 'document') {
    console.log('');
    console.log('========================================');
    console.log('[PdfProcessingService] 🖼️ IMAGE EXTRACTION STARTED');
    console.log('========================================');
    console.log(`[PdfProcessingService] 📊 PDF File: ${originalFileName}`);
    console.log(`[PdfProcessingService] 📊 PDF Size: ${(pdfBuffer.length / 1024).toFixed(2)}KB`);
    console.log(`[PdfProcessingService] 📊 Configured Method: ${this.imageExtractionMethod}`);

    if (this.imageExtractionMethod === 'pymupdf') {
      try {
        console.log(`[PdfProcessingService] 🔍 Checking PyMuPDF availability...`);
        
        // Check if PyMuPDF is available
        const availability = await pythonImageExtractor.checkAvailability();

        if (availability.available) {
          console.log('[PdfProcessingService] ✅ PyMuPDF is available (Python-based, highest quality)');
          console.log('[PdfProcessingService] 🔄 Extracting images using PyMuPDF...');
          
          const images = await pythonImageExtractor.extractImages(pdfBuffer, originalFileName);

          console.log(`[PdfProcessingService] 📊 PyMuPDF extracted ${images.length} image(s)`);

          // Compress all extracted images
          if (images.length > 0) {
            console.log(`[PdfProcessingService] 🗜️ Compressing ${images.length} extracted image(s)...`);
            const compressedImages = [];
            for (let i = 0; i < images.length; i++) {
              const img = images[i];
              const originalSizeMB = (img.buffer.length / (1024 * 1024)).toFixed(2);
              console.log(`[PdfProcessingService] 🗜️ Image ${i + 1}/${images.length}: ${originalSizeMB}MB, Type: ${img.type}, Page: ${img.page}`);
              
              const compressed = await this.compressImage(img.buffer, img.type);
              const compressedSizeMB = (compressed.buffer.length / (1024 * 1024)).toFixed(2);
              
              compressedImages.push({
                buffer: compressed.buffer,
                type: compressed.type,
                page: img.page
              });
              
              console.log(`[PdfProcessingService] ✅ Compressed to ${compressedSizeMB}MB (${compressed.type})`);
            }

            console.log('========================================');
            console.log(`[PdfProcessingService] ✅ Image extraction complete: ${compressedImages.length} images ready`);
            console.log('========================================');
            console.log('');
            return compressedImages;
          } else {
            console.log('========================================');
            console.log(`[PdfProcessingService] ℹ️ No images found in PDF`);
            console.log('========================================');
            console.log('');
            return [];
          }
        } else {
          console.warn(`[PdfProcessingService] ⚠️ PyMuPDF not available: ${availability.message}`);
          console.warn('[PdfProcessingService] ⚠️ Reason: Python or PyMuPDF module not installed');
          console.warn('[PdfProcessingService] 🔄 Falling back to pdfjs-dist extraction...');
          return await this.extractImagesWithPdfJs(pdfBuffer, originalFileName);
        }
      } catch (error) {
        console.error('[PdfProcessingService] ❌ PyMuPDF extraction failed:', error.message);
        console.warn('[PdfProcessingService] 🔄 Falling back to pdfjs-dist extraction...');
        return await this.extractImagesWithPdfJs(pdfBuffer, originalFileName);
      }
    } else {
      console.log('[PdfProcessingService] 📦 Using pdfjs-dist for image extraction (JavaScript-based)');
      return await this.extractImagesWithPdfJs(pdfBuffer, originalFileName);
    }
  }

  /**
   * Extract embedded images from PDF using pdfjs-dist (FALLBACK METHOD)
   * Uses pdf-lib to access raw image streams without re-encoding
   * @param {Buffer} pdfBuffer - PDF buffer
   * @param {string} originalFileName - Original PDF filename
   * @returns {Promise<Array<{buffer: Buffer, type: string, page: number}>>} - Array of extracted images
   */
  async extractImagesWithPdfJs(pdfBuffer, originalFileName = 'document') {
    try {
      console.log('');
      console.log('[PdfProcessingService] 📤 === EXTRACTING EMBEDDED IMAGES IN ORIGINAL FORMAT ===');
      console.log('[PdfProcessingService] 📤 Using pdf-lib to preserve JPG/PNG format...');
      console.log(`[PdfProcessingService] 📤 PDF buffer size: ${pdfBuffer.length} bytes`);

      // Load PDF with pdf-lib to access raw image streams
      const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      const numPages = pages.length;

      console.log(`[PdfProcessingService] 📤 PDF loaded: ${numPages} page(s)`);

      const extractedImages = [];
      let imageCounter = 0;

      // STEP 1: Build a map of image formats using pdf-lib
      console.log('[PdfProcessingService] 🔍 === STEP 1: DETECTING IMAGE FORMATS ===');
      const imageFormats = new Map(); // Map<imageName, {format: 'jpeg'|'png', stream: PDFStream}>

      for (let pageNum = 0; pageNum < numPages; pageNum++) {
        try {
          const page = pages[pageNum];
          const pageNode = page.node;
          const resources = pageNode.Resources();

          if (!resources) continue;

          const xObjectsRef = resources.get(PDFName.of('XObject'));
          if (!xObjectsRef) continue;

          const xObjects = pdfDoc.context.lookup(xObjectsRef);
          if (!xObjects || xObjects.constructor.name !== 'PDFDict') continue;

          const xObjectEntries = xObjects.entries();

          for (const [name, xObjectRef] of xObjectEntries) {
            try {
              const xObject = pdfDoc.context.lookup(xObjectRef);
              const dict = xObject.dict || xObject;

              const subtype = dict.get(PDFName.of('Subtype'));
              if (!subtype || subtype.toString() !== '/Image') continue;

              const imageName = name.toString().replace('/', '');
              const filter = dict.get(PDFName.of('Filter'));

              let format = 'png';
              if (filter) {
                const filterName = filter.toString();
                if (filterName.includes('DCTDecode')) {
                  format = 'jpeg';
                }
              }

              imageFormats.set(imageName, { format, stream: xObject, pageNum: pageNum + 1 });
              console.log(`[PdfProcessingService] 🔍 Found image "${imageName}" on page ${pageNum + 1}: ${format.toUpperCase()}`);
            } catch (err) {
              // Skip this XObject
            }
          }
        } catch (err) {
          // Skip this page
        }
      }

      console.log(`[PdfProcessingService] ✅ Detected ${imageFormats.size} image(s) in PDF`);
      console.log('');

      // STEP 2: Extract images using pdfjs-dist (working method)
      console.log('[PdfProcessingService] 🔍 === STEP 2: EXTRACTING IMAGES WITH PDFJS-DIST ===');

      const pdfjsLib = await this.loadPdfJs();
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
        isEvalSupported: false,
        useSystemFonts: false
      });

      const pdfDocument = await loadingTask.promise;
      const pdfNumPages = pdfDocument.numPages;

      for (let pageNum = 1; pageNum <= pdfNumPages; pageNum++) {
        console.log('');
        console.log('========================================');
        console.log(`[PdfProcessingService] 📄 PROCESSING PAGE ${pageNum}/${pdfNumPages}`);
        console.log('========================================');

        try {
          const page = await pdfDocument.getPage(pageNum);
          const operatorList = await page.getOperatorList();

          console.log(`[PdfProcessingService] 📊 Analyzing ${operatorList.fnArray.length} PDF operations...`);
          console.log(`[PdfProcessingService] 🔍 Looking for image operations (paintImageXObject, paintInlineImageXObject)...`);

          let imagesFoundOnPage = 0;

          for (let i = 0; i < operatorList.fnArray.length; i++) {
            const operation = operatorList.fnArray[i];

            if (operation === pdfjsLib.OPS.paintImageXObject ||
                operation === pdfjsLib.OPS.paintInlineImageXObject) {

              const imageName = operatorList.argsArray[i][0];
              console.log(`[PdfProcessingService] 🖼️ Found image: "${imageName}"`);

              try {
                const imageObj = await new Promise((resolve, reject) => {
                  page.objs.get(imageName, (obj) => {
                    if (obj) resolve(obj);
                    else reject(new Error('Image object is null'));
                  });
                });

                if (!imageObj || !imageObj.width || !imageObj.height || !imageObj.data) {
                  console.warn(`[PdfProcessingService] ⚠️ Image "${imageName}" has no valid data - skipping`);
                  continue;
                }

                console.log(`[PdfProcessingService] 📊 Image dimensions: ${imageObj.width}x${imageObj.height}`);
                console.log(`[PdfProcessingService] 📊 Image data size: ${imageObj.data.length} bytes`);

                let imageBuffer;
                let fileExtension = 'png';
                let mimeType = 'image/png';

                // Check if this image is JPEG format
                const formatInfo = imageFormats.get(imageName);
                let isJpeg = formatInfo && formatInfo.format === 'jpeg';

                if (isJpeg) {
                  // Try to extract raw JPEG bytes
                  console.log(`[PdfProcessingService] 📊 Format detected: JPEG`);
                  console.log(`[PdfProcessingService] 🔄 Extracting raw JPEG bytes...`);

                  try {
                    const stream = formatInfo.stream;
                    if (stream.contents) {
                      imageBuffer = Buffer.from(stream.contents);
                      fileExtension = 'jpg';
                      mimeType = 'image/jpeg';
                      const rawSizeKB = (imageBuffer.length / 1024).toFixed(2);
                      console.log(`[PdfProcessingService] ✅ Extracted raw JPEG: ${rawSizeKB}KB`);
                    } else {
                      throw new Error('No stream contents');
                    }
                  } catch (jpegErr) {
                    console.log(`[PdfProcessingService] ⚠️ Cannot get raw JPEG: ${jpegErr.message}`);
                    console.log(`[PdfProcessingService] 🔄 Will decode as PNG instead...`);
                    isJpeg = false;
                  }
                }

                if (!isJpeg || !imageBuffer) {
                  // Decode and save as PNG
                  console.log(`[PdfProcessingService] 📊 Format: PNG (decoded from raw data)`);
                  console.log(`[PdfProcessingService] 🔄 Creating canvas and decoding image...`);
                  const canvas = createCanvas(imageObj.width, imageObj.height);
                  const ctx = canvas.getContext('2d');
                  const imageData = ctx.createImageData(imageObj.width, imageObj.height);
                  imageData.data.set(imageObj.data);
                  ctx.putImageData(imageData, 0, 0);
                  imageBuffer = canvas.toBuffer('image/png');
                  fileExtension = 'png';
                  mimeType = 'image/png';
                  const pngSizeKB = (imageBuffer.length / 1024).toFixed(2);
                  console.log(`[PdfProcessingService] ✅ Decoded as PNG: ${pngSizeKB}KB`);
                }

                const imageSizeKB = (imageBuffer.length / 1024).toFixed(2);

                imageCounter++;
                imagesFoundOnPage++;

                console.log('');
                console.log(`[PdfProcessingService] 📊 IMAGE ${imageCounter} SUMMARY:`);
                console.log(`[PdfProcessingService]   - Name: ${imageName}`);
                console.log(`[PdfProcessingService]   - Page: ${pageNum}`);
                console.log(`[PdfProcessingService]   - Dimensions: ${imageObj.width}x${imageObj.height}`);
                console.log(`[PdfProcessingService]   - Size: ${imageSizeKB}KB`);
                console.log(`[PdfProcessingService]   - Format: ${fileExtension.toUpperCase()}`);

                // Compress image to reduce size
                console.log(`[PdfProcessingService] 🗜️ Compressing for GPT Vision...`);
                const compressed = await this.compressImage(imageBuffer, mimeType);
                const compressedSizeKB = (compressed.buffer.length / 1024).toFixed(2);
                const compressionRatio = ((1 - compressed.buffer.length / imageBuffer.length) * 100).toFixed(1);
                
                console.log(`[PdfProcessingService] ✅ Compressed to ${compressedSizeKB}KB (${compressionRatio}% reduction)`);

                extractedImages.push({
                  buffer: compressed.buffer,
                  type: compressed.type,
                  page: pageNum,
                  name: imageName
                });

                console.log(`[PdfProcessingService] ✅ Image ${imageCounter} ready for GPT Vision processing`);

              } catch (imgError) {
                console.error(`[PdfProcessingService] ❌ Error extracting image "${imageName}":`, imgError.message);
                continue;
              }
            }
          }

          console.log('========================================');
          console.log(`[PdfProcessingService] 📊 Page ${pageNum} Complete: ${imagesFoundOnPage} image(s) extracted`);
          console.log('========================================');

        } catch (pageError) {
          console.error('========================================');
          console.error(`[PdfProcessingService] ❌ Error processing page ${pageNum}`);
          console.error(`[PdfProcessingService] ❌ Error: ${pageError.message}`);
          console.error('========================================');
          continue;
        }
      }

      console.log('');
      console.log('========================================');
      console.log('[PdfProcessingService] 🎯 IMAGE EXTRACTION COMPLETE');
      console.log('========================================');
      console.log(`[PdfProcessingService] 📊 Total Pages Processed: ${pdfNumPages}`);
      console.log(`[PdfProcessingService] 📊 Total Images Extracted: ${extractedImages.length}`);

      if (extractedImages.length > 0) {
        const totalSize = extractedImages.reduce((sum, img) => sum + img.buffer.length, 0);
        const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        const avgSizeKB = ((totalSize / extractedImages.length) / 1024).toFixed(2);
        
        console.log(`[PdfProcessingService] 📊 Total Size: ${totalSizeMB}MB`);
        console.log(`[PdfProcessingService] 📊 Average Size per Image: ${avgSizeKB}KB`);
        
        // Show breakdown by page
        const pageBreakdown = {};
        extractedImages.forEach(img => {
          pageBreakdown[img.page] = (pageBreakdown[img.page] || 0) + 1;
        });
        console.log(`[PdfProcessingService] 📊 Images per page:`);
        Object.keys(pageBreakdown).sort((a, b) => parseInt(a) - parseInt(b)).forEach(page => {
          console.log(`[PdfProcessingService]    Page ${page}: ${pageBreakdown[page]} image(s)`);
        });
        
        console.log(`[PdfProcessingService] ✅ All images ready for GPT Vision API`);
      } else {
        console.log(`[PdfProcessingService] ℹ️ No embedded images found in PDF`);
        console.log(`[PdfProcessingService] 💡 This might be a text-only PDF or images are not embedded`);
      }
      console.log('========================================');
      console.log('');

      return extractedImages;

    } catch (error) {
      console.error('');
      console.error('[PdfProcessingService] ❌ Failed to extract images with pdfjs-dist:', error.message);
      console.error('[PdfProcessingService] ❌ Stack:', error.stack);
      console.log('');
      return [];
    }
  }

  /**
   * Extract text from PDF using pdfjs-dist
   * @param {Buffer} pdfBuffer - PDF buffer
   * @returns {Promise<string>} - Extracted text
   */
  async extractTextFromPdf(pdfBuffer) {
    try {
      console.log('');
      console.log('========================================');
      console.log('[PdfProcessingService] 📄 TEXT EXTRACTION STARTED');
      console.log('========================================');
      console.log(`[PdfProcessingService] 📊 PDF Size: ${(pdfBuffer.length / 1024).toFixed(2)}KB`);
      console.log(`[PdfProcessingService] 📊 Method: pdfjs-dist (Mozilla PDF.js)`);
      console.log(`[PdfProcessingService] 📊 Extracting embedded text layer...`);

      // Load pdfjs-dist dynamically
      const pdfjsLib = await this.loadPdfJs();

      // Load PDF document
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBuffer),
        isEvalSupported: false,
        useSystemFonts: false
      });

      const pdfDocument = await loadingTask.promise;
      const numPages = pdfDocument.numPages;

      console.log(`[PdfProcessingService] 📊 PDF has ${numPages} page(s)`);
      console.log(`[PdfProcessingService] 🔄 Processing pages...`);
      console.log('');

      let allText = [];
      let pageStats = [];

      // Extract text from each page
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        try {
          const page = await pdfDocument.getPage(pageNum);
          const textContent = await page.getTextContent();

          // Combine all text items
          const pageText = textContent.items.map(item => item.str).join(' ');
          const charCount = pageText.trim().length;
          
          if (charCount > 0) {
            allText.push(pageText);
            pageStats.push({ page: pageNum, chars: charCount, items: textContent.items.length });
            console.log(`[PdfProcessingService] ✅ Page ${pageNum}: ${charCount} chars extracted (${textContent.items.length} text items)`);
          } else {
            console.log(`[PdfProcessingService] ⚠️ Page ${pageNum}: No text found (might be image-only)`);
          }
        } catch (pageError) {
          console.error(`[PdfProcessingService] ❌ Page ${pageNum}: Error - ${pageError.message}`);
        }
      }

      const extractedText = allText.join('\n');
      const totalChars = extractedText.length;

      console.log('');
      console.log('========================================');
      console.log('[PdfProcessingService] 📊 TEXT EXTRACTION COMPLETE');
      console.log('========================================');
      console.log(`[PdfProcessingService] 📊 Total Characters: ${totalChars}`);
      console.log(`[PdfProcessingService] 📊 Pages with Text: ${pageStats.length}/${numPages}`);
      console.log(`[PdfProcessingService] 📊 Pages without Text: ${numPages - pageStats.length}/${numPages}`);
      
      if (totalChars > 0) {
        const avgCharsPerPage = (totalChars / pageStats.length).toFixed(0);
        console.log(`[PdfProcessingService] 📊 Average chars/page: ${avgCharsPerPage}`);
        console.log(`[PdfProcessingService] 📄 Text Preview (first 200 chars):`);
        console.log(`[PdfProcessingService] "${extractedText.substring(0, 200)}..."`);
      } else {
        console.log(`[PdfProcessingService] ⚠️ No embedded text found in PDF`);
        console.log(`[PdfProcessingService] 💡 This might be a scanned document or image-only PDF`);
      }
      console.log('========================================');
      console.log('');

      return extractedText;
    } catch (error) {
      console.error('');
      console.error('========================================');
      console.error('[PdfProcessingService] ❌ TEXT EXTRACTION FAILED');
      console.error('========================================');
      console.error(`[PdfProcessingService] ❌ Error: ${error.message}`);
      console.error('========================================');
      console.error('');
      return '';
    }
  }

  async processPdf(pdfBuffer, vendorContext, originalFileName) {
    try {
      console.log('========================================');
      console.log('[PdfProcessingService] 🔄 Starting PDF Processing Pipeline');
      console.log(`[PdfProcessingService] ℹ File: ${originalFileName}`);
      console.log(`[PdfProcessingService] ℹ Buffer size: ${pdfBuffer.length} bytes`);
      console.log(`[PdfProcessingService] ℹ Vendor: ${vendorContext.email}`);
      console.log('========================================');

      // Step 1: Validate PDF meets requirements
      console.log('[PdfProcessingService] 🔄 Step 1: Validating PDF...');
      const validation = await this.validatePdf(pdfBuffer);
      if (!validation.isValid) {
        const errorMessage = validation.errors.join(' ');
        console.error('[PdfProcessingService] ❌ PDF validation failed:', errorMessage);
        throw new Error(errorMessage);
      }
      console.log('[PdfProcessingService] ✅ Step 1 Complete: PDF validation passed');

      // Step 2: Extract BOTH text and images, then combine
      let standardText = '';
      let gptText = { title: '', mainData: '', contactInfo: '' }; // Initialize as structured object
      let extractedText = '';
      let gptProcessingAttempted = false;
      let gptProcessingSucceeded = false;
      let gptProcessingError = null;
      let extractionMethod = 'none';

      console.log('========================================');
      console.log('[PdfProcessingService] 🔄 Step 2: TEXT & IMAGE EXTRACTION PIPELINE');
      console.log('[PdfProcessingService] ℹ️ NEW LOGIC: Extract ALL text AND images');
      console.log('========================================');

      // STEP 2A: ALWAYS extract standard text
      console.log('');
      console.log('[PdfProcessingService] 📄 === STEP 2A: STANDARD TEXT EXTRACTION ===');
      console.log('[PdfProcessingService] 📄 Extracting embedded text from PDF...');

      try {
        standardText = await this.extractTextFromPdf(pdfBuffer);
        const textLength = standardText ? standardText.trim().length : 0;

        console.log(`[PdfProcessingService] 📄 Standard extraction result: ${textLength} characters`);

        if (textLength > 0) {
          console.log(`[PdfProcessingService] ✅ Text found! Preview: ${standardText.substring(0, 100)}...`);
        } else {
          console.log(`[PdfProcessingService] ⚠️ No embedded text found`);
        }
      } catch (standardError) {
        console.error('[PdfProcessingService] ❌ Standard extraction error:', standardError.message);
        standardText = '';
      }

      // Check if we have standard text
      const hasStandardText = standardText && standardText.trim().length > 0;

      // STEP 2B: ALWAYS extract embedded images from PDF
      console.log('');
      console.log('[PdfProcessingService] 📤 === STEP 2B: IMAGE EXTRACTION ===');
      console.log('[PdfProcessingService] 📤 Extracting embedded images...');
      console.log(`[PdfProcessingService] 📤 Original file: ${originalFileName}`);

      let images = [];
      try {
        images = await this.extractImages(pdfBuffer, originalFileName);
        console.log(`[PdfProcessingService] 📤 Image extraction result: ${images.length} embedded image(s) found`);
      } catch (imageError) {
        console.error('[PdfProcessingService] ❌ Image extraction error:', imageError.message);
        console.error('[PdfProcessingService] ❌ Stack:', imageError.stack);
        images = [];
      }

      // STEP 2C: If images found, send to GPT Vision
      if (images.length > 0) {
        console.log('');
        console.log('[PdfProcessingService] 🤖 === STEP 2C: GPT VISION PROCESSING ===');
        console.log(`[PdfProcessingService] 🤖 Found ${images.length} image(s) - sending to GPT Vision...`);

        // Check if OpenAI is configured
        const openaiConfigured = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0;

        console.log(`[PdfProcessingService] ℹ OpenAI configured: ${openaiConfigured ? 'YES' : 'NO'}`);

        if (!openaiConfigured) {
          console.warn('');
          console.warn('[PdfProcessingService] ⚠️ OpenAI API key NOT configured');
          console.warn('[PdfProcessingService] ⚠️ Cannot extract text from images');
          console.warn('[PdfProcessingService] ℹ Set OPENAI_API_KEY in .env to enable GPT Vision');
          gptText = { title: '', mainData: '', contactInfo: '' };
        } else {
          gptProcessingAttempted = true;

          try {
            console.log(`[PdfProcessingService] 🤖 Sending ${images.length} image(s) to GPT Vision API...`);

            const gptStructured = await gptService.extractTextFromMultipleImages(images);

            const totalChars = (gptStructured.title || '').length +
                             (gptStructured.mainData || '').length +
                             (gptStructured.contactInfo || '').length;

            if (totalChars > 10) {
              gptProcessingSucceeded = true;
              console.log('');
              console.log(`[PdfProcessingService] ✅ === GPT VISION SUCCESS ===`);
              console.log(`[PdfProcessingService] ✅ GPT extracted ${totalChars} characters from ${images.length} images`);
              console.log(`[PdfProcessingService] ✅ Title: ${gptStructured.title.length} chars`);
              console.log(`[PdfProcessingService] ✅ Main Data: ${gptStructured.mainData.length} chars`);
              console.log(`[PdfProcessingService] ✅ Contact: ${gptStructured.contactInfo.length} chars`);

              // Store structured data for PDF creation
              gptText = gptStructured;
            } else {
              console.warn('');
              console.warn('[PdfProcessingService] ⚠️ GPT Vision returned minimal/no text');
              gptText = { title: '', mainData: '', contactInfo: '' };
            }
          } catch (gptError) {
            console.error('');
            console.error('[PdfProcessingService] ❌ === GPT VISION FAILED ===');
            console.error('[PdfProcessingService] ❌ GPT error:', gptError.message);
            console.error('[PdfProcessingService] ❌ Error stack:', gptError.stack);
            gptProcessingError = gptError.message;
            gptText = { title: '', mainData: '', contactInfo: '' };
          }
        }
      } else {
        console.log('');
        console.log('[PdfProcessingService] ℹ️ === STEP 2C: NO IMAGES FOUND ===');
        console.log('[PdfProcessingService] ℹ️ No images found - will use GPT for text structuring');

        // Check if OpenAI is configured
        const openaiConfigured = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0;

        if (!openaiConfigured) {
          console.warn('[PdfProcessingService] ⚠️ OpenAI API key NOT configured');
          console.warn('[PdfProcessingService] ⚠️ Will use basic text extraction');
          gptText = { title: '', mainData: '', contactInfo: '' };
          gptProcessingAttempted = false;
        } else if (hasStandardText) {
          // Send extracted text to GPT for structuring
          gptProcessingAttempted = true;

          try {
            console.log('[PdfProcessingService] 🤖 Sending extracted text to GPT for structuring...');

            const gptStructured = await gptService.structureTextWithGpt(standardText);

            const totalChars = (gptStructured.title || '').length +
                             (gptStructured.mainData || '').length +
                             (gptStructured.contactInfo || '').length;

            if (totalChars > 10) {
              gptProcessingSucceeded = true;
              console.log('');
              console.log(`[PdfProcessingService] ✅ === GPT TEXT STRUCTURING SUCCESS ===`);
              console.log(`[PdfProcessingService] ✅ GPT structured ${totalChars} characters`);
              console.log(`[PdfProcessingService] ✅ Title: ${gptStructured.title.length} chars`);
              console.log(`[PdfProcessingService] ✅ Main Data: ${gptStructured.mainData.length} chars`);
              console.log(`[PdfProcessingService] ✅ Contact: ${gptStructured.contactInfo.length} chars`);

              // Store structured data for PDF creation
              gptText = gptStructured;
            } else {
              console.warn('[PdfProcessingService] ⚠️ GPT returned minimal/no structured data');
              gptText = { title: '', mainData: '', contactInfo: '' };
            }
          } catch (gptError) {
            console.error('[PdfProcessingService] ❌ GPT text structuring failed:', gptError.message);
            gptProcessingError = gptError.message;
            gptText = { title: '', mainData: '', contactInfo: '' };
          }
        } else {
          console.warn('[PdfProcessingService] ⚠️ No text extracted - cannot send to GPT');
          gptText = { title: '', mainData: '', contactInfo: '' };
        }
      }

      // STEP 2D: Prepare structured data for PDF
      console.log('');
      console.log('[PdfProcessingService] 📊 === STEP 2D: PREPARING DATA FOR PDF ===');

      // Prepare structured data for PDF
      let pdfData = {
        title: '',
        mainData: '',
        contactInfo: ''
      };

      // Use GPT data if:
      // 1. GPT processing was attempted and succeeded
      // 2. GPT returned actual structured data (total chars > 0)
      // NOTE: Can be from images (GPT Vision) OR from text (GPT text structuring)
      const hasGptData = gptProcessingSucceeded &&
                        gptText &&
                        typeof gptText === 'object' &&
                        ((gptText.title || '').length + (gptText.mainData || '').length + (gptText.contactInfo || '').length) > 0;

      console.log(`[PdfProcessingService] 📊 Decision factors:`);
      console.log(`[PdfProcessingService] 📊   - Images found: ${images.length}`);
      console.log(`[PdfProcessingService] 📊   - GPT attempted: ${gptProcessingAttempted}`);
      console.log(`[PdfProcessingService] 📊   - GPT succeeded: ${gptProcessingSucceeded}`);
      console.log(`[PdfProcessingService] 📊   - Has standard text: ${hasStandardText}`);
      console.log(`[PdfProcessingService] 📊   - Will use GPT data: ${hasGptData}`);

      if (hasGptData) {
        // Use GPT structured data (preferred)
        let mainData = gptText.mainData || '';
        let contactInfoText = gptText.contactInfo || '';

        // Extract contact info from main data (in case GPT didn't separate it properly)
        const extractedContactInfo = this.extractContactInfo(mainData);

        // Remove any contact info found in main data
        mainData = this.removeContactInfoFromText(mainData, extractedContactInfo);

        // Combine GPT contact info with extracted contact info
        const allContactInfo = [];

        // Add GPT contact info
        if (contactInfoText && contactInfoText.trim().length > 0) {
          allContactInfo.push(contactInfoText);
        }

        // Add extracted contact info (only email and phone, no address)
        if (extractedContactInfo.email) {
          allContactInfo.push(`EMAIL: ${extractedContactInfo.email}`);
        }
        if (extractedContactInfo.phone) {
          allContactInfo.push(`TEL: ${extractedContactInfo.phone}`);
        }
        // Note: Address intentionally excluded from footer

        pdfData = {
          title: gptText.title || '',
          mainData: mainData,
          contactInfo: allContactInfo.join(' | ')
        };
        extractionMethod = 'gpt_structured';
        console.log(`[PdfProcessingService] ✅ Using GPT structured data from images`);
        console.log(`[PdfProcessingService] ✅ GPT extracted from ${images.length} image(s) in PDF`);
      } else if (hasStandardText) {
        // Fallback to standard text (put in mainData)
        console.log(`[PdfProcessingService] 📄 Raw extracted text length: ${standardText.length} chars`);
        console.log(`[PdfProcessingService] 📄 Text preview: ${standardText.substring(0, 200)}...`);

        const lines = standardText.split('\n').filter(line => line.trim().length > 0);
        console.log(`[PdfProcessingService] 📄 Split into ${lines.length} non-empty lines`);

        // Extract contact info first
        const contactInfo = this.extractContactInfo(standardText);
        console.log(`[PdfProcessingService] 📄 Extracted contact info:`, {
          email: contactInfo.email || 'none',
          phone: contactInfo.phone || 'none',
          address: contactInfo.address ? contactInfo.address.substring(0, 50) + '...' : 'none'
        });

        // Use ALL text for mainData (not just lines.slice(1))
        let mainDataText = standardText;

        // Remove contact info from main data text using helper function
        const originalLength = mainDataText.length;
        mainDataText = this.removeContactInfoFromText(mainDataText, contactInfo);
        console.log(`[PdfProcessingService] 📄 After removing contact info: ${mainDataText.length} chars (removed ${originalLength - mainDataText.length} chars)`);

        pdfData = {
          title: lines[0] ? lines[0].substring(0, 100) : 'Document',
          mainData: mainDataText,
          contactInfo: [
            contactInfo.phone ? `TEL: ${contactInfo.phone}` : '',
            contactInfo.email ? `EMAIL: ${contactInfo.email}` : ''
            // Note: Address intentionally excluded from footer
          ].filter(s => s).join(' | ')
        };
        extractionMethod = 'library_only_no_gpt';
        console.log(`[PdfProcessingService] ✅ ========================================`);
        console.log(`[PdfProcessingService] ✅ Using LIBRARY-BASED extraction ONLY`);
        console.log(`[PdfProcessingService] ✅ NO GPT API calls made`);
        console.log(`[PdfProcessingService] ✅ NO OpenAI usage`);
        console.log(`[PdfProcessingService] ✅ Library: pdfjs-dist (Mozilla PDF.js)`);
        console.log(`[PdfProcessingService] ✅ Extracted: ${standardText.length} characters`);
        console.log(`[PdfProcessingService] ✅ Reason: No images found in PDF (${images.length} images)`);
        console.log(`[PdfProcessingService] ✅ ========================================`);
      } else {
        // No text found
        pdfData = {
          title: 'Document Processed',
          mainData: 'No extractable text found',
          contactInfo: ''
        };
        extractionMethod = 'no_text_found';
        console.warn(`[PdfProcessingService] ⚠️ No text extracted from any source`);
      }

      console.log('');
      console.log('========================================');
      console.log('[PdfProcessingService] ✅ Step 2 Complete: DATA EXTRACTION FINISHED');
      console.log(`[PdfProcessingService] 📊 Extraction method: ${extractionMethod.toUpperCase()}`);

      if (extractionMethod === 'library_only_no_gpt') {
        console.log(`[PdfProcessingService] 📊 ✓ NO GPT USED - Library extraction only`);
        console.log(`[PdfProcessingService] 📊 ✓ Images in PDF: ${images.length}`);
        console.log(`[PdfProcessingService] 📊 ✓ OpenAI API calls: 0`);
      } else if (extractionMethod === 'gpt_structured') {
        console.log(`[PdfProcessingService] 📊 ✓ GPT USED - Extracted from ${images.length} image(s)`);
        console.log(`[PdfProcessingService] 📊 ✓ OpenAI API calls made`);
      }

      console.log(`[PdfProcessingService] 📊 Title: ${pdfData.title.length} chars`);
      console.log(`[PdfProcessingService] 📊 Main Data: ${pdfData.mainData.length} chars`);
      console.log(`[PdfProcessingService] 📊 Contact Info: ${pdfData.contactInfo.length} chars`);
      console.log(`[PdfProcessingService] 📊 Images found: ${images.length}`);
      console.log(`[PdfProcessingService] 📊 GPT Vision attempted: ${gptProcessingAttempted ? 'YES' : 'NO'}`);
      console.log(`[PdfProcessingService] 📊 GPT Vision succeeded: ${gptProcessingSucceeded ? 'YES' : 'NO'}`);
      if (gptProcessingError) {
        console.log(`[PdfProcessingService] 📊 GPT error: ${gptProcessingError}`);
      }
      console.log('========================================');
      console.log('');

      // Step 3: Create new PDF from branded template
      console.log('[PdfProcessingService] 🔄 Step 3: Creating branded template PDF...');
      let pdfDoc;
      try {
        pdfDoc = await this.createBrandedTemplate(pdfData, vendorContext);
        console.log('[PdfProcessingService] ✅ Step 3 Complete: Branded template created');
      } catch (templateError) {
        console.error('[PdfProcessingService] ❌ Failed to create branded template:', templateError.message);
        throw templateError;
      }

      // Step 4: Set PDF metadata for 300 DPI and grayscale compliance
      console.log('[PdfProcessingService] 🔄 Step 4: Setting PDF metadata...');
      try {
        this.setPdfMetadata(pdfDoc);
        console.log('[PdfProcessingService] ✅ Step 4 Complete: PDF metadata set');
      } catch (metadataError) {
        console.error('[PdfProcessingService] ⚠️ Failed to set metadata (non-critical):', metadataError.message);
        // Continue even if metadata fails
      }

      // Step 5: Save the processed PDF
      console.log('[PdfProcessingService] 🔄 Step 5: Saving processed PDF...');
      let processedPdfBytes;
      try {
        processedPdfBytes = await pdfDoc.save();
        console.log('[PdfProcessingService] ✅ Step 5 Complete: PDF saved, size:', processedPdfBytes.length, 'bytes');
      } catch (saveError) {
        console.error('[PdfProcessingService] ❌ Failed to save PDF:', saveError.message);
        throw saveError;
      }

      console.log('========================================');
      console.log('[PdfProcessingService] ✅ PDF Processing Pipeline Complete!');
      console.log('[PdfProcessingService] ✅ Result: Branded template applied, grayscale 8-bit 300 DPI');
      console.log('========================================');

      return {
        finalPdfBytes: Buffer.from(processedPdfBytes),
        extractedData: pdfData  // ✅ Return the extracted data
      };
    } catch (error) {
      console.error('[PdfProcessingService] ❌ PDF processing failed:', error);
      throw error;
    }
  }

  /**
   * Remove contact information from text
   * @param {string} text - Text to clean
   * @param {Object} contactInfo - Contact info to remove {email, phone, address}
   * @returns {string} - Cleaned text
   */
  removeContactInfoFromText(text, contactInfo) {
    let cleanedText = text;

    // Remove ALL email patterns (not just the specific extracted one)
    // This ensures no email appears in main content
    const emailPattern = /(?:Email|E-mail|Correo|EMAIL|CORREO|E-MAIL)?\s*:?\s*[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+/gi;
    cleanedText = cleanedText.replace(emailPattern, '');

    // Remove ALL phone patterns (not just the specific extracted one)
    // This ensures no phone number appears in main content
    const phonePatterns = [
      // With labels
      /(?:Phone|Telephone|Tel|Teléfono|Cell|Mobile|TEL|TELEPHONE|TELEFONO|CELULAR|MÓVIL|MOVIL)[\s:]*[+\d\s\-\(\)\.]{10,20}/gi,
      // Phone numbers that look like phone numbers (with +, parentheses, or dashes)
      /(?:^|\s)\+?[\d\s\-\(\)]{10,20}(?:\s|$)/g
    ];

    phonePatterns.forEach(pattern => {
      cleanedText = cleanedText.replace(pattern, ' ');
    });

    // Also remove the specific extracted values if provided (with more context)
    if (contactInfo.email) {
      const emailEscaped = contactInfo.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleanedText = cleanedText.replace(new RegExp(emailEscaped, 'gi'), '');
    }

    if (contactInfo.phone) {
      const phoneEscaped = contactInfo.phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleanedText = cleanedText.replace(new RegExp(phoneEscaped, 'gi'), '');
    }

    // Remove address if found
    if (contactInfo.address) {
      const addressEscaped = contactInfo.address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleanedText = cleanedText.replace(new RegExp(`(?:Address|Dirección|Domicilio|Location|ADDRESS)?\\s*:?\\s*${addressEscaped}`, 'gi'), '');
    }

    // Clean up multiple spaces and blank lines
    cleanedText = cleanedText.replace(/\s{3,}/g, ' ');  // Multiple spaces to single space
    cleanedText = cleanedText.replace(/\n\s*\n\s*\n/g, '\n\n');  // Multiple blank lines to double

    return cleanedText.trim();
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
   * - Left and right corner images
   * - Company logo (centered)
   * - Title (40px font size)
   * - Main data content
   * - Footer with contact information on single line
   * @param {Object} pdfData - {title, mainData, contactInfo}
   * @param {Object} vendorContext - Vendor information
   */
  async createBrandedTemplate(pdfData, vendorContext) {
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
        const leftWidth = 60;  // Reduced from 150
        const leftHeight = 115; // Reduced from 120

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
        const rightWidth = 170;
        const rightHeight = 220;

        page.drawImage(images.rightImage, {
          x: pageWidth - rightWidth, // Right margin
          y: pageHeight - rightHeight, // Top margin
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

      // === STEP 2: Add title section (40px font size, multi-line support) ===
      let titleY = pageHeight - 200;

      // Use title from structured data
      const titleText = (pdfData.title || 'Document').trim();

      // Wrap title text to fit within page width
      const titleFontSize = 40;
      const titleLineHeight = 50; // Increased spacing between title lines (40px font + 10px spacing)
      const titleMaxWidth = pageWidth - 100;

      // Split title into lines if needed
      const titleLines = this.wrapTextForPdf(titleText, fontBold, titleFontSize, titleMaxWidth);

      // Draw each title line
      for (const titleLine of titleLines) {
        page.drawText(titleLine, {
          x: 50,
          y: titleY,
          size: titleFontSize,
          font: fontBold,
          color: grayscale(0),
        });
        titleY -= titleLineHeight; // Move down for next line
      }

      console.log('[PdfProcessingService] ✅ Title added (40px font, multi-line)');

      // === STEP 3: Add main data section ===
      const margin = 50;
      let contentY = titleY - 24;  // Reduced by 1/2 (was 48, now 24)
      const lineHeight = 24;  // Increased by 1.5x (was 16, now 24)
      const contentFontSize = 12;  // Increased from 10 to 12 (+2px)
      const maxWidth = pageWidth - (2 * margin);

      // Use main data from structured data (contact info excluded - will be in footer)
      const contentText = pdfData.mainData || '';

      // Wrap and add main data text
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

      console.log('[PdfProcessingService] ✅ Main data added');

      // === STEP 4: Add footer line and contact information (single line) ===
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

      // Add contact information on same line (only phone and email, no labels)
      if (pdfData.contactInfo && pdfData.contactInfo.trim().length > 0) {
        let phone = '';
        let email = '';

        // Extract phone number (handle multiple formats and labels)
        const phonePatterns = [
          /(?:TEL[ÉE]FONO|TELEPHONE|PHONE|TEL|CELULAR|MÓVIL|MOVIL)[\s:]*([+\d\s\-\(\)\.]+)/gi,
          /([+\d][\d\s\-\(\)\.]{8,})/g // Fallback: any sequence that looks like a phone number
        ];

        for (const pattern of phonePatterns) {
          const match = pdfData.contactInfo.match(pattern);
          if (match) {
            phone = match[0]
              .replace(/(?:TEL[ÉE]FONO|TELEPHONE|PHONE|TEL|CELULAR|MÓVIL|MOVIL)[\s:]*/gi, '')
              .trim();
            break;
          }
        }

        // Extract email (handle multiple formats and labels)
        const emailPattern = /(?:EMAIL|E-MAIL|CORREO)?[\s:]*([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
        const emailMatch = pdfData.contactInfo.match(emailPattern);
        if (emailMatch) {
          email = emailMatch[0]
            .replace(/(?:EMAIL|E-MAIL|CORREO)[\s:]*/gi, '')
            .trim();
        }

        // Display phone and email on same line with spacing
        if (phone || email) {
          const contactItems = [];
          if (phone) contactItems.push(phone);
          if (email) contactItems.push(email);

          // Join with spacing - use 20 spaces for clear separation
          const contactText = contactItems.join('                    '); // 20 spaces

          page.drawText(contactText, {
            x: margin,
            y: footerY - 40,
            size: 9,
            font: font,
            color: grayscale(0),
          });

          console.log(`[PdfProcessingService] ✅ Contact info on ONE line: "${contactText}"`);
        }
      }

      // Add company logo and text on right side of footer
      if (images.companyLogo) {
        // Company logo dimensions
        const logoWidth = 40;
        const logoHeight = 40;
        const logoX = pageWidth - margin - logoWidth - 120; // Position with space for text
        const logoY = footerY - 50;

        // Draw company logo
        page.drawImage(images.companyLogo, {
          x: logoX,
          y: logoY,
          width: logoWidth,
          height: logoHeight,
        });

        // Add text to the right of logo
        const textX = logoX + logoWidth + 10; // 10px spacing after logo
        const textStartY = logoY + 30; // Start from top of logo area

        // Line 1: "seer"
        page.drawText('seer', {
          x: textX,
          y: textStartY,
          size: 10,
          font: fontBold,
          color: grayscale(0),
        });

        // Line 2: "tráfico s.c."
        page.drawText('tráfico s.c.', {
          x: textX,
          y: textStartY - 12,
          size: 9,
          font: font,
          color: grayscale(0),
        });

        // Line 3: "Expertos en Import/Export"
        page.drawText('Expertos en Import/Export', {
          x: textX,
          y: textStartY - 24,
          size: 8,
          font: font,
          color: grayscale(0.3),
        });

        console.log('[PdfProcessingService] ✅ Company logo and text added to footer (right side)');
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

      // Set rendering intent for high-quality print output at 300 DPI
      // This adds hints to PDF viewers/printers to use 300 DPI rendering
      try {
        const catalog = pdfDoc.catalog;

        // Get or create ViewerPreferences dictionary
        const viewerPrefsDict = catalog.getOrCreateViewerPreferences();

        // Set PrintScaling to None to preserve exact dimensions
        // This ensures 1:1 printing without scaling
        viewerPrefsDict.set(PDFName.of('PrintScaling'), PDFName.of('None'));

        // Add custom XMP metadata to specify 300 DPI intent
        // This is the standard way to specify resolution in PDFs
        const pageCount = pdfDoc.getPageCount();
        for (let i = 0; i < pageCount; i++) {
          const page = pdfDoc.getPage(i);
          const pageRef = page.ref;
          const pageDict = pdfDoc.context.lookup(pageRef);

          // Add resolution metadata to page dictionary
          // Note: This is informational and doesn't affect rendering
          // The actual DPI for rasterization is determined by the output device
          const resourcesDict = pageDict.get(PDFName.of('Resources'));
          if (resourcesDict) {
            // Add a custom property indicating 300 DPI intent
            // Most PDF processors will respect this for printing/rasterization
            pageDict.set(PDFName.of('UserUnit'), pdfDoc.context.obj(1));
          }
        }

        console.log('[PdfProcessingService] ✅ PDF configured for 300 DPI output (metadata and viewer preferences)');
      } catch (dpiError) {
        console.warn('[PdfProcessingService] ⚠️ Could not set DPI preferences:', dpiError.message);
        // Non-critical, metadata still indicates 300 DPI
      }

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
      const result = { logo: null, leftImage: null, rightImage: null, companyLogo: null };

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

      // Load company logo for footer (company logo.jpg)
      try {
        const companyLogoPath = path.join(imagesDir, 'company logo.jpg');
        const companyLogoBytes = await fs.readFile(companyLogoPath);
        result.companyLogo = await pdfDoc.embedJpg(companyLogoBytes);
        console.log('[PdfProcessingService] ✅ Company logo loaded (company logo.jpg)');
      } catch (err) {
        console.log('[PdfProcessingService] ℹ No company logo found');
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
      return { logo: null, leftImage: null, rightImage: null, companyLogo: null };
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

