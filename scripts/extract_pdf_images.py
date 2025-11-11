#!/usr/bin/env python3
"""
PDF Image Extraction using PyMuPDF (fitz)
This script extracts images from PDFs and returns them as base64 data (no disk save).
"""

import sys
import json
import os
import base64
from pathlib import Path
import fitz  # PyMuPDF
from PIL import Image
import io

def extract_images_from_pdf(pdf_path, output_dir):
    """
    Extract all images from a PDF file using PyMuPDF.
    Returns images as base64 data without saving to disk.

    Args:
        pdf_path (str): Path to the PDF file
        output_dir (str): Not used anymore (kept for compatibility)

    Returns:
        list: List of dictionaries containing image metadata and base64 data
    """
    try:
        # Open the PDF
        pdf_document = fitz.open(pdf_path)

        extracted_images = []
        image_counter = 0

        # Iterate through each page
        for page_num in range(len(pdf_document)):
            page = pdf_document[page_num]

            # Get list of images on the page
            image_list = page.get_images(full=True)

            # Extract each image
            for img_index, img in enumerate(image_list):
                try:
                    xref = img[0]  # Image reference number

                    # Get the image bytes and metadata
                    base_image = pdf_document.extract_image(xref)

                    if base_image is None:
                        continue

                    image_bytes = base_image["image"]
                    image_ext = base_image["ext"]  # Original format (png, jpg, etc.)

                    # Get image dimensions
                    width = base_image.get("width", 0)
                    height = base_image.get("height", 0)
                    colorspace = base_image.get("colorspace", "unknown")

                    # Skip very small images (likely icons or artifacts)
                    if width < 50 or height < 50:
                        continue

                    # Generate unique filename (always use .jpg extension)
                    image_counter += 1
                    image_filename = f"image_p{page_num + 1}_{image_counter}.jpg"

                    # Convert image to JPG format to reduce file size (in memory, no disk save)
                    try:
                        # Load image using PIL
                        image = Image.open(io.BytesIO(image_bytes))

                        # Convert RGBA or other modes to RGB (JPG doesn't support transparency)
                        if image.mode in ('RGBA', 'LA', 'P'):
                            # Create white background
                            background = Image.new('RGB', image.size, (255, 255, 255))
                            if image.mode == 'P':
                                image = image.convert('RGBA')
                            background.paste(image, mask=image.split()[-1] if image.mode in ('RGBA', 'LA') else None)
                            image = background
                        elif image.mode != 'RGB':
                            image = image.convert('RGB')

                        # Save to bytes buffer (in memory) instead of disk
                        # Set DPI to 300 for high-quality output
                        img_buffer = io.BytesIO()
                        image.save(img_buffer, 'JPEG', quality=85, optimize=True, dpi=(300, 300))
                        img_bytes = img_buffer.getvalue()
                        file_size = len(img_bytes)

                        # Convert to base64 for transfer
                        base64_data = base64.b64encode(img_bytes).decode('utf-8')

                    except Exception as conv_error:
                        # If conversion fails, use original bytes
                        print(f"Warning: Failed to convert image to JPG, using original format: {str(conv_error)}", file=sys.stderr)
                        img_bytes = image_bytes
                        file_size = len(img_bytes)
                        base64_data = base64.b64encode(img_bytes).decode('utf-8')

                    # Set MIME type to JPEG
                    mime_type = "image/jpeg"

                    # Add to extracted images list (no path, using base64 data instead)
                    extracted_images.append({
                        "filename": image_filename,
                        "base64": base64_data,
                        "page": page_num + 1,
                        "width": width,
                        "height": height,
                        "format": "jpg",
                        "mimeType": mime_type,
                        "colorspace": str(colorspace),
                        "size": file_size
                    })

                except Exception as img_error:
                    # Continue with next image if one fails
                    print(f"Warning: Failed to extract image {img_index} on page {page_num + 1}: {str(img_error)}", file=sys.stderr)
                    continue

        pdf_document.close()

        return extracted_images

    except Exception as e:
        raise Exception(f"Failed to extract images from PDF: {str(e)}")

def main():
    """Main function to handle command-line execution"""
    if len(sys.argv) < 3:
        print(json.dumps({
            "success": False,
            "error": "Usage: python extract_pdf_images.py <pdf_path> <output_dir>"
        }))
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]

    # Validate inputs
    if not os.path.exists(pdf_path):
        print(json.dumps({
            "success": False,
            "error": f"PDF file not found: {pdf_path}"
        }))
        sys.exit(1)

    try:
        # Extract images
        images = extract_images_from_pdf(pdf_path, output_dir)

        # Return results as JSON
        result = {
            "success": True,
            "images": images,
            "count": len(images)
        }

        print(json.dumps(result, indent=2))
        sys.exit(0)

    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
