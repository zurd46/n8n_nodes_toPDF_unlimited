"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConvertToPdf = void 0;
const n8n_workflow_1 = require("n8n-workflow");
// Important: heavy libraries are loaded dynamically inside functions so tests can run in
// environments without those deps installed. This allows using puppeteer/pdf-lib in
// production but keeps tests lightweight.
class ConvertToPdf {
    constructor() {
        this.description = {
            displayName: 'Convert to PDF (Unlimited)',
            name: 'convertToPdfUnlimited',
            icon: 'file:pdf.svg',
            group: ['transform'],
            version: 1,
            description: 'Take diverse input (HTML, text, tables, JSON, lists) and produce a PDF. Free and unlimited!',
            defaults: {
                name: 'ConvertToPdf',
                color: '#D32F2F',
            },
            inputs: ['main'],
            outputs: ['main'],
            properties: [
                {
                    displayName: 'Input Source',
                    name: 'inputSource',
                    type: 'options',
                    options: [
                        { name: 'From Previous Node', value: 'previousNode' },
                        { name: 'Manual Input', value: 'manual' },
                    ],
                    default: 'previousNode',
                    description: 'Choose where to get the content from',
                },
                {
                    displayName: 'HTML Content',
                    name: 'htmlContent',
                    type: 'string',
                    typeOptions: {
                        rows: 10,
                    },
                    default: '',
                    description: 'HTML content to convert to PDF. Supports expressions like {{ $json.output }}',
                    displayOptions: {
                        show: {
                            inputSource: ['manual'],
                        },
                    },
                },
                {
                    displayName: 'Input Field',
                    name: 'inputField',
                    type: 'string',
                    default: 'output',
                    description: 'Field name from input data to use as HTML content (e.g., "output", "html", "text")',
                    displayOptions: {
                        show: {
                            inputSource: ['previousNode'],
                        },
                    },
                },
                {
                    displayName: 'File name',
                    name: 'fileName',
                    type: 'string',
                    default: 'output.pdf',
                    description: 'Default file name used for the created PDF',
                },
                {
                    displayName: 'Page format',
                    name: 'pageFormat',
                    type: 'options',
                    options: [
                        { name: 'A4', value: 'A4' },
                        { name: 'Letter', value: 'Letter' },
                    ],
                    default: 'A4',
                    description: 'Page format used for generated PDF (when using the HTML renderer)',
                },
                {
                    displayName: 'Output Type',
                    name: 'outputType',
                    type: 'options',
                    options: [
                        { name: 'Binary (File)', value: 'binary' },
                        { name: 'URL (Temporary Link)', value: 'url' },
                        { name: 'Both', value: 'both' },
                    ],
                    default: 'binary',
                    description: 'Choose how to output the PDF: as binary file, temporary URL, or both',
                },
            ],
        };
        this.methods = {};
    }
    async execute() {
        const items = this.getInputData();
        const fileNameParam = this.getNodeParameter('fileName', 0);
        const pageFormat = this.getNodeParameter('pageFormat', 0) || 'A4';
        const outputType = this.getNodeParameter('outputType', 0) || 'binary';
        const inputSource = this.getNodeParameter('inputSource', 0) || 'previousNode';
        const returnItems = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            let contentForPdf = '';
            let isJsonData = false;
            if (inputSource === 'manual') {
                // Get content from manual input field (supports expressions)
                contentForPdf = this.getNodeParameter('htmlContent', i) || '';
                if (!contentForPdf) {
                    contentForPdf = '<div></div>';
                }
                // Check if manual input is JSON
                const trimmed = contentForPdf.trim();
                isJsonData = trimmed.startsWith('{') || trimmed.startsWith('[');
            }
            else {
                // Get content from previous node data
                const inputField = this.getNodeParameter('inputField', i) || 'output';
                const fieldValue = item.json[inputField];
                if (fieldValue && typeof fieldValue === 'string') {
                    contentForPdf = fieldValue;
                    // Check if string is JSON
                    const trimmed = fieldValue.trim();
                    isJsonData = trimmed.startsWith('{') || trimmed.startsWith('[');
                }
                else if (fieldValue && typeof fieldValue === 'object') {
                    // Object/Array - render directly as JSON for pdf-lib
                    contentForPdf = JSON.stringify(fieldValue);
                    isJsonData = true;
                }
                else {
                    // Fallback: try common fields
                    const commonFields = ['output', 'html', 'text', 'content', 'body'];
                    let found = false;
                    for (const field of commonFields) {
                        const val = item.json[field];
                        if (val) {
                            if (typeof val === 'string') {
                                contentForPdf = val;
                                const trimmed = val.trim();
                                isJsonData = trimmed.startsWith('{') || trimmed.startsWith('[');
                            }
                            else if (typeof val === 'object') {
                                contentForPdf = JSON.stringify(val);
                                isJsonData = true;
                            }
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        // Last resort: use entire item.json
                        contentForPdf = JSON.stringify(item.json);
                        isJsonData = true;
                    }
                }
            }
            let pdfBuffer;
            // For JSON data, use pdf-lib directly (renders tables properly)
            // For HTML, try external APIs first, then fallback to pdf-lib
            if (isJsonData) {
                // Direct PDF generation with pdf-lib for structured data
                pdfBuffer = await renderTextPdfFallback(contentForPdf);
            }
            else {
                // Check if it looks like HTML
                const trimmed = contentForPdf.trim().toLowerCase();
                const isHtml = trimmed.startsWith('<') || trimmed.includes('<html') || trimmed.includes('<body') || trimmed.includes('<div') || trimmed.includes('<table');
                if (isHtml) {
                    // Try external HTML-to-PDF APIs
                    try {
                        pdfBuffer = await renderHtmlToPdfUsingPuppeteer(contentForPdf, pageFormat);
                    }
                    catch (err) {
                        // Fallback to pdf-lib
                        pdfBuffer = await renderTextPdfFallback(contentForPdf);
                    }
                }
                else {
                    // Plain text - use pdf-lib
                    pdfBuffer = await renderTextPdfFallback(contentForPdf);
                }
            }
            if (!pdfBuffer) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Failed to create PDF for item ' + i);
            }
            const outFileName = fileNameParam || `output-${i + 1}.pdf`;
            // create new item with json data
            const newItem = {
                json: { ...item.json },
                binary: {},
            };
            // Handle output based on outputType
            if (outputType === 'binary' || outputType === 'both') {
                // Use helper to prepare binary data
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                newItem.binary = {
                    pdf: await this.helpers.prepareBinaryData(pdfBuffer, outFileName, 'application/pdf'),
                };
            }
            if (outputType === 'url' || outputType === 'both') {
                // Upload to free temporary file hosting service
                try {
                    const pdfUrl = await uploadToTempFileService(pdfBuffer, outFileName);
                    newItem.json.pdfUrl = pdfUrl;
                    newItem.json.pdfFileName = outFileName;
                }
                catch (uploadErr) {
                    // If upload fails, add error info but don't fail the whole operation
                    newItem.json.pdfUrlError = `Failed to upload PDF: ${uploadErr.message}`;
                }
            }
            returnItems.push(newItem);
        }
        return this.prepareOutputData(returnItems);
    }
}
exports.ConvertToPdf = ConvertToPdf;
// Helper functions moved outside the class to avoid 'this' context issues
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function stripHtmlTags(v) {
    if (!v)
        return '';
    return String(v).replace(/<[^>]*>/g, ' ');
}
function toHtml(obj) {
    // If obj already contains html property and it looks like HTML, return it
    if (!obj)
        return '<div></div>';
    // If string, try to parse as JSON first
    if (typeof obj === 'string') {
        const s = obj.trim();
        // If it looks like HTML, return as-is
        if (s.startsWith('<') && s.endsWith('>'))
            return s;
        // Try to parse as JSON
        if (s.startsWith('{') || s.startsWith('[')) {
            try {
                const parsed = JSON.parse(s);
                return toHtml(parsed); // Recursively convert parsed JSON
            }
            catch {
                // Not valid JSON, continue with string handling
            }
        }
        // Plain text - wrap in pre tag
        return `<div><pre>${escapeHtml(s)}</pre></div>`;
    }
    // if object has a field 'html'
    if (obj.html && typeof obj.html === 'string')
        return obj.html;
    // if text
    if (obj.text && typeof obj.text === 'string')
        return `<div><pre>${escapeHtml(obj.text)}</pre></div>`;
    // if array -> render table for arrays of objects
    if (Array.isArray(obj)) {
        return renderArrayAsHtml(obj);
    }
    // if plain object -> render as formatted report
    if (typeof obj === 'object') {
        return renderObjectAsHtml(obj);
    }
    // fallback to string conversion
    return `<div><pre>${escapeHtml(String(obj))}</pre></div>`;
}
// Render an array as HTML table
function renderArrayAsHtml(arr) {
    if (!arr.length)
        return '<p>Keine Daten</p>';
    // detect if array of objects
    if (typeof arr[0] === 'object' && arr[0] !== null) {
        const keys = Array.from(arr.reduce((acc, cur) => {
            if (cur && typeof cur === 'object') {
                Object.keys(cur).forEach(k => acc.add(k));
            }
            return acc;
        }, new Set()));
        const header = keys.map(k => `<th>${escapeHtml(formatLabel(String(k)))}</th>`).join('');
        const rows = arr.map((row) => {
            const cells = keys.map(k => {
                const val = row?.[k];
                return `<td>${formatValue(val)}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
        return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    // Simple array - render as list
    const listItems = arr.map((x) => `<li>${formatValue(x)}</li>`).join('');
    return `<ul>${listItems}</ul>`;
}
// Render an object as HTML - with special handling for common patterns
function renderObjectAsHtml(obj) {
    const parts = [];
    // Check for arrays in the object (like "perioden") - render them as tables
    const arrayKeys = [];
    const scalarKeys = [];
    for (const key of Object.keys(obj)) {
        if (Array.isArray(obj[key])) {
            arrayKeys.push(key);
        }
        else {
            scalarKeys.push(key);
        }
    }
    // First render scalar values as a summary section
    if (scalarKeys.length > 0) {
        parts.push('<div class="summary">');
        parts.push('<h2>Zusammenfassung</h2>');
        parts.push('<table class="summary-table">');
        for (const key of scalarKeys) {
            const val = obj[key];
            parts.push(`<tr><th>${escapeHtml(formatLabel(key))}</th><td>${formatValue(val)}</td></tr>`);
        }
        parts.push('</table>');
        parts.push('</div>');
    }
    // Then render arrays as separate tables
    for (const key of arrayKeys) {
        const arr = obj[key];
        parts.push(`<div class="data-section">`);
        parts.push(`<h2>${escapeHtml(formatLabel(key))}</h2>`);
        parts.push(renderArrayAsHtml(arr));
        parts.push('</div>');
    }
    // If no arrays found, just render as key-value table
    if (arrayKeys.length === 0 && scalarKeys.length === 0) {
        parts.push('<table>');
        for (const key of Object.keys(obj)) {
            parts.push(`<tr><th>${escapeHtml(formatLabel(key))}</th><td>${formatValue(obj[key])}</td></tr>`);
        }
        parts.push('</table>');
    }
    return parts.join('\n');
}
// Format a camelCase or snake_case label to readable text
function formatLabel(key) {
    return key
        // Insert space before uppercase letters (camelCase)
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        // Replace underscores with spaces
        .replace(/_/g, ' ')
        // Capitalize first letter
        .replace(/^./, str => str.toUpperCase());
}
// Format a value for display
function formatValue(val) {
    if (val === null || val === undefined) {
        return '<span class="null">-</span>';
    }
    if (typeof val === 'boolean') {
        return val ? '<span class="bool-true">Ja</span>' : '<span class="bool-false">Nein</span>';
    }
    if (typeof val === 'number') {
        return `<span class="number">${val}</span>`;
    }
    if (typeof val === 'string') {
        return escapeHtml(val);
    }
    if (Array.isArray(val)) {
        if (val.length === 0)
            return '<span class="null">-</span>';
        // For nested arrays, render inline or as sub-table
        if (typeof val[0] === 'object') {
            return renderArrayAsHtml(val);
        }
        return escapeHtml(val.join(', '));
    }
    if (typeof val === 'object') {
        // Nested object - render as mini-table
        const rows = Object.keys(val).map(k => `<tr><th>${escapeHtml(formatLabel(k))}</th><td>${formatValue(val[k])}</td></tr>`).join('');
        return `<table class="nested">${rows}</table>`;
    }
    return escapeHtml(String(val));
}
async function renderHtmlToPdfUsingPuppeteer(html, pageFormat = 'A4') {
    const errors = [];
    // Wrap HTML in a complete document with proper styling if not already complete
    const wrappedHtml = wrapHtmlDocument(html, pageFormat);
    // Try weasyprint.org first - free, no API key required, no watermark
    try {
        return await renderWithWeasyprint(wrappedHtml, pageFormat);
    }
    catch (e) {
        errors.push(`Weasyprint: ${e.message}`);
    }
    // Try html2pdf.app - free tier available, no watermark
    try {
        return await renderWithHtml2PdfApp(wrappedHtml, pageFormat);
    }
    catch (e) {
        errors.push(`Html2Pdf: ${e.message}`);
    }
    throw new Error(`All PDF rendering methods failed: ${errors.join('; ')}`);
}
// Wrap HTML content in a complete document with proper styling
function wrapHtmlDocument(html, pageFormat) {
    // If HTML is already a complete document, return as-is
    const lowerHtml = html.toLowerCase().trim();
    if (lowerHtml.startsWith('<!doctype') || lowerHtml.startsWith('<html')) {
        return html;
    }
    // Page dimensions for proper sizing
    const pageWidth = pageFormat === 'Letter' ? '8.5in' : '210mm';
    const pageHeight = pageFormat === 'Letter' ? '11in' : '297mm';
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @page {
      size: ${pageWidth} ${pageHeight};
      margin: 20mm;
    }
    * {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #333;
    }
    body {
      padding: 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th {
      background-color: #f5f5f5;
      font-weight: bold;
    }
    tr:nth-child(even) {
      background-color: #fafafa;
    }
    pre {
      background-color: #f5f5f5;
      padding: 1em;
      overflow-x: auto;
      border-radius: 4px;
      font-family: 'Courier New', Courier, monospace;
      font-size: 10pt;
    }
    code {
      background-color: #f5f5f5;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: 'Courier New', Courier, monospace;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      line-height: 1.2;
    }
    h1 { font-size: 24pt; }
    h2 { font-size: 20pt; }
    h3 { font-size: 16pt; }
    p {
      margin: 0.5em 0;
    }
    ul, ol {
      padding-left: 2em;
    }
    a {
      color: #0066cc;
      text-decoration: none;
    }
    /* Summary and data sections */
    .summary {
      margin-bottom: 2em;
    }
    .summary-table {
      width: auto;
      min-width: 50%;
    }
    .summary-table th {
      width: 200px;
      background-color: #e8f4fc;
    }
    .data-section {
      margin-top: 2em;
      page-break-inside: avoid;
    }
    .data-section h2 {
      color: #2c5282;
      border-bottom: 2px solid #2c5282;
      padding-bottom: 0.3em;
      margin-top: 1em;
    }
    /* Value styling */
    .null {
      color: #999;
      font-style: italic;
    }
    .bool-true {
      color: #38a169;
      font-weight: bold;
    }
    .bool-false {
      color: #e53e3e;
    }
    .number {
      font-family: 'Courier New', monospace;
      color: #2b6cb0;
    }
    /* Nested tables */
    table.nested {
      margin: 0;
      font-size: 0.9em;
      border: none;
    }
    table.nested th, table.nested td {
      padding: 4px 8px;
      border: 1px solid #e2e8f0;
    }
    table.nested th {
      background-color: #f7fafc;
    }
  </style>
</head>
<body>
${html}
</body>
</html>`;
}
// Weasyprint.org - Free HTML to PDF API (no key needed)
async function renderWithWeasyprint(html, pageFormat) {
    const https = require('https');
    return new Promise((resolve, reject) => {
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        let body = '';
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="file"; filename="document.html"\r\n`;
        body += `Content-Type: text/html\r\n\r\n`;
        body += html + '\r\n';
        body += `--${boundary}--\r\n`;
        const options = {
            hostname: 'weasyprint.org',
            path: '/api/',
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(body),
            },
        };
        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const result = Buffer.concat(chunks);
                if (res.statusCode === 200 && result.length > 100 && result.slice(0, 4).toString() === '%PDF') {
                    resolve(result);
                }
                else {
                    reject(new Error(`Status ${res.statusCode}, Size: ${result.length}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(120000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        req.write(body);
        req.end();
    });
}
// html2pdf.app - Free HTML to PDF API (no watermark in free tier)
async function renderWithHtml2PdfApp(html, pageFormat) {
    const https = require('https');
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            html: html,
            format: pageFormat === 'Letter' ? 'Letter' : 'A4',
            landscape: false,
            margin: {
                top: '20mm',
                right: '20mm',
                bottom: '20mm',
                left: '20mm'
            }
        });
        const options = {
            hostname: 'api.html2pdf.app',
            path: '/v1/generate',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
        };
        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const result = Buffer.concat(chunks);
                if (res.statusCode === 200 && result.length > 100 && result.slice(0, 4).toString() === '%PDF') {
                    resolve(result);
                }
                else {
                    reject(new Error(`Status ${res.statusCode}, Size: ${result.length}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(60000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        req.write(postData);
        req.end();
    });
}
async function renderTextPdfFallback(htmlOrText) {
    // Create PDF using pdf-lib with proper table rendering
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    // Try to parse as JSON for structured rendering
    let data = null;
    const trimmed = htmlOrText.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            data = JSON.parse(trimmed);
        }
        catch {
            // Not valid JSON
        }
    }
    // If we have structured data, render it nicely
    if (data && typeof data === 'object') {
        return await renderStructuredPdf(pdfDoc, data, font, fontBold);
    }
    // Fallback: render as plain text
    const text = stripHtmlTags(htmlOrText);
    const page = pdfDoc.addPage();
    const fontSize = 11;
    const { width, height } = page.getSize();
    const margin = 50;
    const maxWidth = width - margin * 2;
    const lines = wrapText(String(text), fontSize, font, maxWidth);
    let y = height - margin;
    for (const line of lines) {
        if (y < margin + fontSize) {
            const p = pdfDoc.addPage();
            y = p.getSize().height - margin;
        }
        page.drawText(line, { x: margin, y: y - fontSize, size: fontSize, font, color: rgb(0, 0, 0) });
        y -= fontSize + 4;
    }
    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
}
// Render structured JSON data as a nicely formatted PDF
async function renderStructuredPdf(pdfDoc, data, font, fontBold) {
    const { rgb } = require('pdf-lib');
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const margin = 50;
    const contentWidth = width - margin * 2;
    let y = height - margin;
    const lineHeight = 16;
    const headerSize = 14;
    const textSize = 10;
    const cellPadding = 5;
    // Helper: Check if we need a new page
    const checkNewPage = (neededSpace) => {
        if (y - neededSpace < margin) {
            page = pdfDoc.addPage();
            y = height - margin;
        }
    };
    // Helper: Draw text
    const drawText = (text, x, yPos, size, bold = false) => {
        const f = bold ? fontBold : font;
        page.drawText(String(text || ''), { x, y: yPos, size, font: f, color: rgb(0, 0, 0) });
    };
    // Helper: Draw a line
    const drawLine = (x1, y1, x2, y2, thickness = 0.5) => {
        page.drawLine({
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
            thickness,
            color: rgb(0.7, 0.7, 0.7),
        });
    };
    // Helper: Draw rectangle
    const drawRect = (x, yPos, w, h, fillColor) => {
        page.drawRectangle({
            x,
            y: yPos,
            width: w,
            height: h,
            color: fillColor,
        });
    };
    // Separate scalar values and arrays
    const scalarKeys = [];
    const arrayKeys = [];
    if (Array.isArray(data)) {
        // If root is array, render it directly as table
        arrayKeys.push('_root');
    }
    else {
        for (const key of Object.keys(data)) {
            if (Array.isArray(data[key])) {
                arrayKeys.push(key);
            }
            else {
                scalarKeys.push(key);
            }
        }
    }
    // Render summary section (scalar values)
    if (scalarKeys.length > 0) {
        checkNewPage(headerSize + lineHeight * (scalarKeys.length + 2));
        // Header
        drawText('Zusammenfassung', margin, y, headerSize, true);
        y -= headerSize + 10;
        // Draw summary table
        const labelWidth = 180;
        const valueWidth = contentWidth - labelWidth;
        for (const key of scalarKeys) {
            checkNewPage(lineHeight + 5);
            const val = data[key];
            const label = formatLabelForPdf(key);
            const valueStr = formatValueForPdf(val);
            // Background for alternating rows
            if (scalarKeys.indexOf(key) % 2 === 0) {
                drawRect(margin, y - lineHeight + 3, contentWidth, lineHeight, rgb(0.96, 0.96, 0.96));
            }
            // Label (bold)
            drawText(label, margin + cellPadding, y - textSize, textSize, true);
            // Value
            drawText(valueStr, margin + labelWidth + cellPadding, y - textSize, textSize);
            // Border
            drawLine(margin, y - lineHeight + 3, margin + contentWidth, y - lineHeight + 3);
            y -= lineHeight;
        }
        y -= 20; // Space after summary
    }
    // Render arrays as tables
    for (const key of arrayKeys) {
        const arr = key === '_root' ? data : data[key];
        if (!Array.isArray(arr) || arr.length === 0)
            continue;
        // Get column keys from first object
        const colKeys = [];
        if (typeof arr[0] === 'object' && arr[0] !== null) {
            for (const item of arr) {
                for (const k of Object.keys(item)) {
                    if (!colKeys.includes(k))
                        colKeys.push(k);
                }
            }
        }
        if (colKeys.length === 0)
            continue;
        checkNewPage(headerSize + lineHeight * 3);
        // Section header
        if (key !== '_root') {
            drawText(formatLabelForPdf(key), margin, y, headerSize, true);
            y -= headerSize + 10;
        }
        // Calculate column widths
        const numCols = colKeys.length;
        const colWidth = contentWidth / numCols;
        // Draw table header
        drawRect(margin, y - lineHeight + 3, contentWidth, lineHeight, rgb(0.9, 0.93, 0.98));
        for (let i = 0; i < colKeys.length; i++) {
            const x = margin + i * colWidth;
            const label = formatLabelForPdf(colKeys[i]);
            // Truncate if too long
            const maxChars = Math.floor(colWidth / 6);
            const displayLabel = label.length > maxChars ? label.substring(0, maxChars - 2) + '..' : label;
            drawText(displayLabel, x + cellPadding, y - textSize, textSize, true);
            // Vertical line
            if (i > 0) {
                drawLine(x, y + 3, x, y - lineHeight + 3);
            }
        }
        // Header bottom border
        drawLine(margin, y - lineHeight + 3, margin + contentWidth, y - lineHeight + 3);
        y -= lineHeight;
        // Draw data rows
        for (let rowIdx = 0; rowIdx < arr.length; rowIdx++) {
            checkNewPage(lineHeight + 5);
            const row = arr[rowIdx];
            // Alternating row background
            if (rowIdx % 2 === 1) {
                drawRect(margin, y - lineHeight + 3, contentWidth, lineHeight, rgb(0.98, 0.98, 0.98));
            }
            for (let i = 0; i < colKeys.length; i++) {
                const x = margin + i * colWidth;
                const val = row[colKeys[i]];
                const valueStr = formatValueForPdf(val);
                // Truncate if too long
                const maxChars = Math.floor(colWidth / 5.5);
                const displayVal = valueStr.length > maxChars ? valueStr.substring(0, maxChars - 2) + '..' : valueStr;
                drawText(displayVal, x + cellPadding, y - textSize, textSize);
                // Vertical line
                if (i > 0) {
                    drawLine(x, y + 3, x, y - lineHeight + 3);
                }
            }
            // Row bottom border
            drawLine(margin, y - lineHeight + 3, margin + contentWidth, y - lineHeight + 3);
            y -= lineHeight;
        }
        // Table outer border
        const tableHeight = (arr.length + 1) * lineHeight;
        drawLine(margin, y + tableHeight + 3, margin, y + 3); // Left
        drawLine(margin + contentWidth, y + tableHeight + 3, margin + contentWidth, y + 3); // Right
        drawLine(margin, y + tableHeight + 3, margin + contentWidth, y + tableHeight + 3); // Top
        y -= 25; // Space after table
    }
    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
}
// Format label for PDF (camelCase to readable)
function formatLabelForPdf(key) {
    return key
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/^./, str => str.toUpperCase());
}
// Format value for PDF display
function formatValueForPdf(val) {
    if (val === null || val === undefined)
        return '-';
    if (typeof val === 'boolean')
        return val ? 'Ja' : 'Nein';
    if (typeof val === 'number')
        return String(val);
    if (typeof val === 'string')
        return val;
    if (Array.isArray(val))
        return val.map(v => formatValueForPdf(v)).join(', ');
    if (typeof val === 'object')
        return JSON.stringify(val);
    return String(val);
}
function wrapText(text, fontSize, font, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let current = '';
    for (const w of words) {
        const trial = current ? current + ' ' + w : w;
        const trialWidth = font.widthOfTextAtSize(trial, fontSize);
        if (trialWidth > maxWidth) {
            if (current)
                lines.push(current);
            current = w;
        }
        else {
            current = trial;
        }
    }
    if (current)
        lines.push(current);
    return lines;
}
async function uploadToTempFileService(buffer, fileName) {
    // Use file.io - free temporary file hosting (files auto-delete after first download or 14 days)
    const https = require('https');
    const FormData = require('form-data');
    return new Promise((resolve, reject) => {
        try {
            // Create form data with the file
            const form = new FormData();
            form.append('file', buffer, {
                filename: fileName,
                contentType: 'application/pdf',
            });
            const options = {
                hostname: 'file.io',
                path: '/',
                method: 'POST',
                headers: form.getHeaders(),
            };
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (response.success && response.link) {
                            resolve(response.link);
                        }
                        else {
                            reject(new Error(response.message || 'Upload failed'));
                        }
                    }
                    catch (e) {
                        reject(new Error('Failed to parse upload response'));
                    }
                });
            });
            req.on('error', (e) => {
                reject(e);
            });
            form.pipe(req);
        }
        catch (e) {
            reject(e);
        }
    });
}
