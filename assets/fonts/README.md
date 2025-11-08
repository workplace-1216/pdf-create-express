# Custom Fonts

Place your custom TTF font files here to use them in the PDF template.

## Required Files:

1. **Regular.ttf** - Used for body text (size: 10pt)
2. **Bold.ttf** - Used for titles and headers (size: 24pt)

## How to Add Fonts:

1. Obtain your custom TTF font files (e.g., from Google Fonts, Adobe Fonts, etc.)
2. Rename them to `Regular.ttf` and `Bold.ttf`
3. Place them in this directory: `backend-express/assets/fonts/`

## Example Fonts:

You can download free fonts from:
- **Google Fonts**: https://fonts.google.com/
  - Popular options: Roboto, Open Sans, Lato, Montserrat
- **Font Squirrel**: https://www.fontsquirrel.com/

## Fallback Behavior:

If custom fonts are not found, the system will automatically use:
- **Helvetica** (for Regular.ttf)
- **Helvetica-Bold** (for Bold.ttf)

## Supported Format:

- ✅ **TTF (TrueType Font)** - Fully supported
- ❌ OTF (OpenType Font) - Not supported by pdf-lib
- ❌ WOFF/WOFF2 - Not supported

## Testing:

After adding fonts, restart the server and upload a PDF. Check the console logs:
- ✅ `Custom regular font loaded` - Success
- ℹ `Using standard Helvetica font` - Fallback (font not found)
