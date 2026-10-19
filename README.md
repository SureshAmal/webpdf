# webpdf — FlipHTML5 → PDF

A tiny, dependency-free static web app: paste a FlipHTML5 book link and it
downloads every page image and builds a PDF in your browser.

## Use

Open the GitHub Pages URL and paste a link like
`https://online.fliphtml5.com/<user>/<book>/`, then press Enter.
A **Download PDF** button appears at the top right when the pages are ready.

## How it works

1. Validates the link.
2. Fetches `javascript/config.js` from the book and reads the encoded
   `fliphtml5_pages` string.
3. Decodes it with FlipHTML5's own WebAssembly decoder (`deString.js`) to get
   every page image's real filename.
4. Loads the images one by one, shows a preview, converts them to JPEG with
   `<canvas>`, and assembles a PDF with the bundled `pdf.js`.

Everything runs client-side — no server. It relies on FlipHTML5 serving
`Access-Control-Allow-Origin: *` for the config, images and decoder.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Files

- `index.html` — UI
- `app.js` — link validation, fetch/decode, image loading, orchestration
- `pdf.js` — minimal PDF writer

For personal use. Respect the content's copyright.
