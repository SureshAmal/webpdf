# webpdf — FlipHTML5 → PDF

A tiny, dependency-free static web app: paste a FlipHTML5 book link and it
downloads every page image and builds a PDF in your browser.

## Use

Open the GitHub Pages URL and paste a link like
`https://online.fliphtml5.com/<user>/<book>/`, then press Enter.
When the pages are ready two buttons appear at the top right:

- **Download optimized PDF** — smaller file (pages downscaled to 1200px, JPEG q72, ~15 MB for 109 pages)
- **Download large PDF** — best quality (full 1700px, JPEG q92, ~39 MB for 109 pages)

You can also share a link that auto-starts, e.g.
`https://<user>.github.io/webpdf/?url=https://online.fliphtml5.com/<user>/<book>/`

## How it works

1. Validates the link.
2. Fetches `javascript/config.js` from the book and reads the encoded
   `fliphtml5_pages` string.
3. Decodes it with FlipHTML5's own WebAssembly decoder (`deString.js`) to get
   every page image's real filename.
4. Loads the images **10 at a time** (with retry/backoff on 429/503), shows a
   preview, converts them to JPEG with `<canvas>` at two qualities, and
   assembles both PDFs with the bundled `pdf.js`.

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
