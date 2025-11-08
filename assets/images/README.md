# Company Logo

Place your company logo here to embed it in the PDF template.

## Required File:

**logo.png** OR **logo.jpg** - Company logo image

## How to Add Logo:

1. Prepare your logo image:
   - **Recommended size**: 400x320 pixels (will be scaled to 100x80 points in PDF)
   - **Aspect ratio**: 5:4 (similar to square)
   - **Format**: PNG (transparent background) or JPG
   - **Resolution**: At least 300 DPI for best quality

2. Save the file as:
   - `logo.png` (recommended - supports transparency)
   - OR `logo.jpg` (if transparency not needed)

3. Place in this directory: `backend-express/assets/images/`

## Logo Position:

The logo will appear in the **top-left corner** of the PDF:
- Position: 50 points from left, 100 points from top
- Size: 100 x 80 points
- Replaces the cyan square if logo is provided

## Fallback Behavior:

If no logo is found, the template will display:
- **Cyan gray square** (80x120 points) in the top-left corner

## Supported Formats:

- ✅ **PNG** - Recommended (supports transparency)
- ✅ **JPG/JPEG** - Supported (no transparency)
- ❌ SVG - Not supported
- ❌ GIF - Not supported

## Image Optimization:

For best results:
1. Use **PNG** with transparent background
2. Optimize file size (keep under 500KB)
3. Use high resolution (300 DPI minimum)
4. Test on both white and gray backgrounds

## Testing:

After adding logo, restart the server and upload a PDF. Check the console logs:
- ✅ `Logo loaded (PNG)` or `Logo loaded (JPG)` - Success
- ℹ `No logo found, using fallback design` - Logo not found

## Example Logo Preparation:

```bash
# Using ImageMagick to resize and optimize logo
convert logo-original.png -resize 400x320 -quality 95 logo.png

# Convert to grayscale (recommended for grayscale PDF)
convert logo.png -colorspace Gray logo.png
```
