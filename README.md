# Convert to PDF (Unlimited) — n8n custom node

This n8n node converts any kind of input (HTML, text, tables, JSON, lists, binary, etc.) into a PDF. Free and unlimited - no API key required!

## Features
- Accepts HTML, text, JSON objects, arrays and tables and converts them to a printable PDF.
- Renders HTML with Puppeteer when available for full HTML/CSS support.
- Has a fallback PDF generation (pdf-lib) if Puppeteer cannot run in the environment.
- **Output options**: Binary file, temporary URL (via file.io), or both.

## Installation

```bash
npm install @zurdai/n8n-nodes-unlimitedpdf
```

## Usage
1. Install the node package in your n8n custom nodes directory.
2. Drop the node into your workflow and feed it items.
3. The node will look for fields like `html`, `text`, arrays, or JSON to convert.
4. Choose your output type: Binary (file), URL (temporary link), or Both.

## Output
- **Binary mode**: Produces a binary property named `pdf` on each outgoing item with MIME type `application/pdf`.
- **URL mode**: Adds `pdfUrl` and `pdfFileName` to the JSON output with a temporary download link (auto-expires).
- **Both mode**: Combines both outputs.

## Notes
- Puppeteer requires a headless Chromium binary. If your environment can't launch Chromium, this node will still create a basic text-only PDF using `pdf-lib`.

## Development / Tests

Install dev deps:

```bash
npm install
```

Build and run tests:

```bash
npm run build
npm test
```
