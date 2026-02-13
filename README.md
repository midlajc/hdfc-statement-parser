# HDFC Credit Card Statement Parser (Web)

A client-only web app to parse HDFC credit card statement PDFs into CSV. Everything runs in your browser.

## Run

Use any static file server:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Install As PWA

- Open the app in a Chromium browser.
- Use the browser install prompt (`Install app`) to add it to your phone or desktop.
- Keep the app installed if you want to use PDF forwarding from the share sheet.

## How It Works

- Drop one or more PDF statements into the uploader.
- Each file is parsed automatically:
  - The app tries the **old** format first.
  - If no rows are detected, it retries with the **new** format.
- If a PDF is encrypted, you will be prompted for a password.
- Download the CSV from each file tile.

## Forward PDF To App

- From a supported mobile browser/share sheet, share a PDF to `HDFC Parser`.
- The PWA receives the file via Web Share Target and opens it automatically.
- The shared PDF is consumed once imported, so refreshes do not duplicate it.

## Preview

- **Preview PDF**: Opens the PDF in an embedded frame (may not work for encrypted PDFs).
- **Preview CSV**: Shows a paginated table of parsed rows.

## Files

- `index.html`
- `styles.css`
- `app.js`
- `manifest.webmanifest`
- `service-worker.js`
- `icons/`

## Notes

- Parsing is heuristic and may vary by statement layout.
- CSV previews are paginated for performance (20 rows per page by default).
- Web Share Target requires an installed PWA and secure context (`https://` or localhost).
