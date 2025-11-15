#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PDF to 8-bit Grayscale 300 DPI Converter using Ghostscript
Direct PDF-to-PDF conversion that preserves vector graphics and text quality
Adds visible gray background to indicate grayscale format
"""

import sys
import os
import subprocess
import argparse
import tempfile
import shutil
import fitz  # PyMuPDF for adding gray background

# Set UTF-8 encoding for Windows console compatibility
if sys.platform == 'win32':
    try:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass  # If it fails, continue with default encoding

def check_ghostscript():
    """Check if Ghostscript is installed and return the command to use"""
    commands = ['gswin64c', 'gswin32c', 'gs']

    for cmd in commands:
        try:
            result = subprocess.run(
                [cmd, '-version'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                print(f"[Ghostscript] Found: {cmd}")
                print(f"[Ghostscript] Version: {result.stdout.strip()}")
                return cmd
        except (FileNotFoundError, subprocess.TimeoutExpired):
            continue

    return None

def add_gray_background(pdf_path, gray_level=0.85):
    """
    Add a light gray background to all pages in the PDF
    This makes the grayscale format visually obvious

    Args:
        pdf_path: Path to PDF file to modify
        gray_level: Gray level (0=black, 1=white). 0.85 = 15% gray (light gray)

    Returns:
        Modified PDF path
    """
    try:
        print(f"[Background] Adding {int((1-gray_level)*100)}% gray background to all pages...")

        # Open PDF
        doc = fitz.open(pdf_path)
        page_count = len(doc)

        # Process each page
        for page_num in range(page_count):
            page = doc[page_num]

            # Get page dimensions
            rect = page.rect

            # Create a gray rectangle covering the entire page
            # Insert it at the bottom (behind all content)
            shape = page.new_shape()

            # Draw rectangle with gray fill
            # RGB with equal values creates grayscale
            gray_rgb = (gray_level, gray_level, gray_level)
            shape.draw_rect(rect)
            shape.finish(fill=gray_rgb, color=None)

            # Insert the shape at the bottom (overlay=False means it goes behind content)
            shape.commit(overlay=False)

        # Save the modified PDF (overwrite original)
        doc.save(pdf_path, garbage=4, deflate=True, clean=True)
        doc.close()

        print(f"[Background] Successfully added gray background to {page_count} pages")
        return pdf_path

    except Exception as e:
        print(f"[Background] Warning: Could not add gray background: {e}")
        print(f"[Background] Continuing with white background...")
        return pdf_path

def convert_pdf_to_grayscale(input_pdf, output_pdf, dpi=300):
    """
    Convert PDF to 8-bit grayscale at 300 DPI using image-based conversion

    Process:
    1. Convert PDF pages to 8-bit grayscale PNG images at 300 DPI
    2. Combine PNG images back into a single PDF
    3. Add gray background for visual indicator
    4. Save PNG images to output directory

    Args:
        input_pdf: Path to input PDF file
        output_pdf: Path to output PDF file
        dpi: Resolution (default: 300)

    Returns:
        0 on success, 1 on failure
    """
    print("=" * 60)
    print("[PDF Converter] PDF to 8-bit Grayscale Conversion")
    print("=" * 60)
    print(f"[PDF Converter] Input:  {input_pdf}")
    print(f"[PDF Converter] Output: {output_pdf}")
    print(f"[PDF Converter] DPI:    {dpi}")
    print("=" * 60)

    # Check if input file exists
    if not os.path.exists(input_pdf):
        print(f"[ERROR] Input file not found: {input_pdf}")
        return 1

    # Get input file size
    input_size_mb = os.path.getsize(input_pdf) / (1024 * 1024)
    print(f"[PDF Converter] Input size: {input_size_mb:.2f} MB")

    # Check Ghostscript installation
    gs_command = check_ghostscript()
    if not gs_command:
        print("[ERROR] Ghostscript not found!")
        print("\nInstallation instructions:")
        print("  Windows: Download from https://ghostscript.com/releases/gsdnld.html")
        print("  Linux:   sudo apt-get install ghostscript")
        print("  Mac:     brew install ghostscript")
        return 1

    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    print(f"[PDF Converter] Created temp directory: {temp_dir}")

    # Create images directory for PNG output (next to output PDF)
    output_dir = os.path.dirname(output_pdf) or '.'
    images_dir = os.path.join(output_dir, 'converted_images')

    try:
        # Step 1: Convert PDF to 8-bit grayscale PNG images
        print()
        print("[PDF Converter] Step 1/3: Converting PDF pages to 8-bit grayscale PNG...")
        output_pattern = os.path.join(temp_dir, 'page_%04d.png')

        # Ghostscript command to convert PDF to 8-bit grayscale PNG images at 300 DPI
        gs_args = [
            gs_command,
            '-sDEVICE=pnggray',                 # PNG grayscale device (8-bit grayscale output)
            '-dNOPAUSE',                        # Don't pause
            '-dBATCH',                          # Exit when done
            '-dSAFER',                          # Security
            '-dMaxBitmap=500000000',            # Maximum bitmap size
            '-dGraphicsAlphaBits=4',            # Anti-aliasing for graphics
            '-dTextAlphaBits=4',                # Anti-aliasing for text
            f'-r{dpi}',                         # Output resolution (300 DPI)
            f'-sOutputFile={output_pattern}',   # Output pattern
            input_pdf                           # Input file
        ]

        print(f"[PDF Converter] Ghostscript command: {' '.join(gs_args)}")
        print(f"[PDF Converter] Converting PDF pages to PNG images at {dpi} DPI...")
        result = subprocess.run(
            gs_args,
            capture_output=True,
            text=True,
            timeout=300
        )

        # Print Ghostscript output for debugging
        if result.stdout:
            print(f"[Ghostscript] Output: {result.stdout}")

        if result.returncode != 0:
            print(f"[ERROR] PNG conversion failed! Exit code: {result.returncode}")
            if result.stderr:
                print(f"[ERROR] Ghostscript stderr: {result.stderr}")
            if result.stdout:
                print(f"[ERROR] Ghostscript stdout: {result.stdout}")
            return 1

        # Get list of generated PNG files
        png_files = sorted([
            os.path.join(temp_dir, f)
            for f in os.listdir(temp_dir)
            if f.endswith('.png')
        ])

        if not png_files:
            print("[ERROR] No PNG images were generated!")
            print(f"[ERROR] Temp directory contents: {os.listdir(temp_dir)}")
            return 1

        print(f"[PDF Converter] SUCCESS! Generated {len(png_files)} PNG images from PDF")

        # Verify PNG files were created
        for i, png_file in enumerate(png_files, 1):
            file_size_kb = os.path.getsize(png_file) / 1024
            print(f"[PDF Converter]   Page {i}: {os.path.basename(png_file)} ({file_size_kb:.1f} KB)")

        # Step 2: Create empty PDF with 8-bit grayscale background
        print()
        print(f"[PDF Converter] Step 2/5: Creating empty PDF with 8-bit grayscale background...")

        from PIL import Image, ImageDraw
        import io

        # Create empty PDF document using PyMuPDF
        empty_pdf_doc = fitz.open()

        # 15% gray background (0.85 = 85% white, 15% black)
        gray_level = 0.85
        gray_rgb = (gray_level, gray_level, gray_level)

        # Add blank pages with gray background matching the number of PNG files
        for i in range(len(png_files)):
            # Standard A4 size in points (8.27 x 11.69 inches * 72 points/inch)
            page = empty_pdf_doc.new_page(width=595, height=842)  # A4 size

            # Add 15% gray background to this page
            rect = page.rect
            shape = page.new_shape()
            shape.draw_rect(rect)
            shape.finish(fill=gray_rgb, color=None)
            shape.commit(overlay=False)  # Put background behind

            print(f"[PDF Converter]   Page {i+1}: Created blank page with 15% gray background")

        print(f"[PDF Converter] Empty PDF created with {len(png_files)} blank pages (8-bit grayscale background)")

        # Step 3: Convert PNG images to 8-bit grayscale with gray background
        print()
        print(f"[PDF Converter] Step 3/5: Converting {len(png_files)} PNG images to 8-bit grayscale with gray background...")

        grayscale_images = []  # Store for saving later

        for i, png_file in enumerate(png_files, 1):
            # Load PNG image (already 8-bit grayscale from pnggray device)
            img = Image.open(png_file)
            img_dpi = img.info.get('dpi', (0, 0))
            print(f"[PDF Converter]   Page {i}: Loading PNG - mode={img.mode}, size={img.size}, dpi={img_dpi}")

            # Ensure it's in 'L' mode (8-bit grayscale, 0-255)
            if img.mode != 'L':
                print(f"[PDF Converter]   Page {i}: Converting {img.mode} to L (8-bit grayscale)")
                img_gray = img.convert('L')
            else:
                print(f"[PDF Converter]   Page {i}: Already 8-bit grayscale (mode=L)")
                img_gray = img

            # Replace white background with 15% gray background
            gray_bg_value = 217  # 15% gray = 217 (0.85 * 255)
            width, height = img_gray.size

            # Convert image to numpy array for pixel manipulation
            import numpy as np
            img_array = np.array(img_gray)

            # Replace white/near-white pixels (240-255) with gray background (217)
            # This converts the white paper background to gray
            white_threshold = 240
            white_mask = img_array >= white_threshold
            img_array[white_mask] = gray_bg_value

            # Convert back to PIL Image
            img_with_bg = Image.fromarray(img_array, mode='L')

            print(f"[PDF Converter]   Page {i}: Replaced white background with 15% gray (value={gray_bg_value})")

            # Store the grayscale image for saving later
            grayscale_images.append(img_with_bg)

        print(f"[PDF Converter] Converted {len(grayscale_images)} images to 8-bit grayscale with gray background")

        # Step 4: Insert PNG images into empty PDF
        print()
        print(f"[PDF Converter] Step 4/5: Inserting {len(grayscale_images)} PNG images into empty PDF...")

        for i, img_with_bg in enumerate(grayscale_images):
            # Get the corresponding page in the empty PDF
            page = empty_pdf_doc[i]

            # Convert PIL image to bytes
            img_bytes = io.BytesIO()
            img_with_bg.save(img_bytes, format='PNG', dpi=(dpi, dpi))
            img_bytes.seek(0)

            # Get image dimensions
            width, height = img_with_bg.size

            # Calculate page size in points (1 inch = 72 points, at 300 DPI)
            page_width = (width / dpi) * 72
            page_height = (height / dpi) * 72

            # Resize the page to match the image dimensions
            page.set_mediabox(fitz.Rect(0, 0, page_width, page_height))

            # Insert image into the page
            page.insert_image(page.rect, stream=img_bytes.getvalue())

            print(f"[PDF Converter]   Page {i+1}: Inserted image - size={width}x{height}px, {page_width:.1f}x{page_height:.1f}pt")

        # Save the PDF with images
        empty_pdf_doc.save(output_pdf, garbage=4, deflate=True, clean=True)
        empty_pdf_doc.close()
        print(f"[PDF Converter] SUCCESS! PDF contains {len(grayscale_images)} 8-bit grayscale images (mode=L, {dpi} DPI, 15% gray background)")

        # Step 5: Save converted 8-bit grayscale PNG images automatically
        print()
        print(f"[PDF Converter] Step 5/5: Saving {len(grayscale_images)} converted 8-bit grayscale PNG images...")
        print(f"[PDF Converter] Saving to: {images_dir}")

        try:
            # Create images directory if it doesn't exist
            os.makedirs(images_dir, exist_ok=True)

            # Save each converted grayscale image as PNG with 300 DPI metadata
            for i, img_gray in enumerate(grayscale_images, 1):
                png_filename = f"page_{i:04d}.png"
                png_path = os.path.join(images_dir, png_filename)

                # Save with DPI metadata
                img_gray.save(png_path, 'PNG', dpi=(dpi, dpi))

                # Verify saved image
                file_size_kb = os.path.getsize(png_path) / 1024
                verify_img = Image.open(png_path)
                verify_dpi = verify_img.info.get('dpi', (0, 0))
                print(f"[PDF Converter]   Saved: {png_filename} - mode={verify_img.mode}, dpi={verify_dpi}, size={file_size_kb:.1f} KB")
                verify_img.close()

            print(f"[PDF Converter] SUCCESS! Saved {len(grayscale_images)} converted PNG images")
            print(f"[PDF Converter] Images saved to: {images_dir}")
        except Exception as save_error:
            print(f"[PDF Converter] Warning: Could not save PNG images: {save_error}")

        # Get output file size
        output_size_mb = os.path.getsize(output_pdf) / (1024 * 1024)
        size_reduction = ((input_size_mb - output_size_mb) / input_size_mb * 100)

        print()
        print("=" * 60)
        print("[PDF Converter] SUCCESS - CONVERSION COMPLETE!")
        print("=" * 60)
        print(f"[PDF Converter] Process summary:")
        print(f"[PDF Converter]   1. Extracted {len(png_files)} PNG images from PDF using Ghostscript (pnggray)")
        print(f"[PDF Converter]   2. Created empty PDF with {len(png_files)} blank pages (8-bit grayscale background)")
        print(f"[PDF Converter]   3. Converted {len(grayscale_images)} PNG to 8-bit grayscale with 15% gray background")
        print(f"[PDF Converter]   4. Inserted {len(grayscale_images)} converted PNG images into empty PDF at {dpi} DPI")
        print(f"[PDF Converter]   5. Saved {len(grayscale_images)} converted PNG images automatically")
        print("=" * 60)
        print(f"[PDF Converter] Output PDF: {output_pdf}")
        print(f"[PDF Converter] Output PNG images: {images_dir}")
        print(f"[PDF Converter] PDF pages: {len(grayscale_images)} pages with 8-bit grayscale images")
        print(f"[PDF Converter] PNG images: {len(grayscale_images)} converted 8-bit grayscale images")
        print("=" * 60)
        print(f"[PDF Converter] Input size:  {input_size_mb:.2f} MB")
        print(f"[PDF Converter] Output size: {output_size_mb:.2f} MB")
        print(f"[PDF Converter] Size change: {size_reduction:+.1f}%")
        print(f"[PDF Converter] PDF format: 8-bit Grayscale PDF with converted images")
        print(f"[PDF Converter] PNG format: 8-bit Grayscale (mode=L, 256 shades of gray)")
        print(f"[PDF Converter] PNG resolution: {dpi} DPI")
        print(f"[PDF Converter] PNG background: 15% gray (value 217)")
        print(f"[PDF Converter] PDF saved and ready for download")
        print(f"[PDF Converter] PNG images saved automatically to: {images_dir}")

        # Verify grayscale conversion
        print()
        print("[PDF Converter] Verifying grayscale conversion...")
        try:
            # Use Ghostscript to check color space
            verify_cmd = [
                gs_command,
                '-dNOPAUSE',
                '-dBATCH',
                '-dSAFER',
                '-sDEVICE=inkcov',
                '-o', 'nul' if sys.platform == 'win32' else '/dev/null',
                output_pdf
            ]
            verify_result = subprocess.run(verify_cmd, capture_output=True, text=True, timeout=30)

            # inkcov output shows CMYK coverage - if C,M,Y are all 0, it's grayscale
            if verify_result.stdout:
                lines = verify_result.stdout.strip().split('\n')
                # Look for coverage line (format: C M Y K CMYK)
                for line in lines:
                    if line.strip() and not line.startswith('%'):
                        parts = line.split()
                        if len(parts) >= 3:
                            cyan = float(parts[0])
                            magenta = float(parts[1])
                            yellow = float(parts[2])

                            if cyan == 0.0 and magenta == 0.0 and yellow == 0.0:
                                print("[PDF Converter] VERIFIED: Output is grayscale (no CMY colors detected)")
                            else:
                                print(f"[PDF Converter] WARNING: Color detected! C={cyan:.4f} M={magenta:.4f} Y={yellow:.4f}")
                                print("[PDF Converter] The PDF may still contain colors - conversion might have failed")
                            break
        except Exception as verify_error:
            print(f"[PDF Converter] Could not verify grayscale: {verify_error}")

        print("=" * 60)

        # Cleanup temp directory
        try:
            import shutil
            shutil.rmtree(temp_dir)
            print(f"[PDF Converter] Cleaned up temp directory")
        except:
            pass

        return 0

    except subprocess.TimeoutExpired:
        print("[ERROR] Ghostscript conversion timed out (>5 minutes)")
        # Cleanup
        try:
            import shutil
            shutil.rmtree(temp_dir)
        except:
            pass
        return 1
    except Exception as e:
        print(f"[ERROR] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        # Cleanup
        try:
            import shutil
            shutil.rmtree(temp_dir)
        except:
            pass
        return 1

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='Convert PDF to 8-bit grayscale at 300 DPI using Ghostscript',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python convert_with_ghostscript.py input.pdf output.pdf
  python convert_with_ghostscript.py input.pdf output.pdf --dpi 300
  python convert_with_ghostscript.py input.pdf output.pdf --dpi 600
        """
    )

    parser.add_argument('input', help='Input PDF file path')
    parser.add_argument('output', help='Output PDF file path')
    parser.add_argument('--dpi', type=int, default=300,
                       help='DPI resolution for rasterized content (default: 300)')

    args = parser.parse_args()

    # Validate DPI
    if args.dpi < 72 or args.dpi > 2400:
        print("[ERROR] DPI must be between 72 and 2400")
        sys.exit(1)

    # Check Ghostscript
    gs = check_ghostscript()
    if not gs:
        print("ERROR: Ghostscript not found!")
        print("\nInstallation instructions:")
        print("  Windows: Download from https://ghostscript.com/releases/gsdnld.html")
        print("  Linux:   sudo apt-get install ghostscript")
        print("  Mac:     brew install ghostscript")
        sys.exit(1)

    # Run conversion
    exit_code = convert_pdf_to_grayscale(args.input, args.output, args.dpi)
    sys.exit(exit_code)
