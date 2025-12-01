import {
  IExecuteFunctions,
} from 'n8n-core';

import {
  INodeType,
  INodeTypeDescription,
  INodeExecutionData,
  IDataObject,
  NodeOperationError,
} from 'n8n-workflow';

// Important: heavy libraries are loaded dynamically inside functions so tests can run in
// environments without those deps installed. This allows using puppeteer/pdf-lib in
// production but keeps tests lightweight.

export class ConvertToPdf implements INodeType {
  description: INodeTypeDescription = {
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
      {
        displayName: 'Exclude Fields',
        name: 'excludeFields',
        type: 'string',
        default: '',
        description: 'Comma-separated list of fields to exclude from PDF (e.g., "sha,shortSha,author,stats,files,parents,committer,manualWorkTime,url")',
      },
      {
        displayName: 'Include Only Fields',
        name: 'includeFields',
        type: 'string',
        default: '',
        description: 'Comma-separated list of fields to include in PDF. If set, only these fields will be shown (e.g., "message,date"). Leave empty to include all.',
      },
      {
        displayName: 'PDF Title',
        name: 'pdfTitle',
        type: 'string',
        default: '',
        description: 'Custom title for the PDF document. Leave empty for auto-generated title.',
      },
      {
        displayName: 'Use HTML Template',
        name: 'useTemplate',
        type: 'boolean',
        default: false,
        description: 'Enable to use a custom HTML template for PDF generation',
      },
      {
        displayName: 'HTML Template',
        name: 'htmlTemplate',
        type: 'string',
        typeOptions: {
          rows: 15,
        },
        default: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f5f5f5; }
  </style>
</head>
<body>
  <h1>{{title}}</h1>
  <p>Erstellt: {{date}}</p>
  {{content}}
</body>
</html>`,
        description: 'Custom HTML template. Use placeholders: {{title}}, {{date}}, {{content}}, {{json}}, {{data.fieldName}}',
        displayOptions: {
          show: {
            useTemplate: [true as unknown as string],
          },
        },
      },
    ],
  };

  methods = {};

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnItems: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Get parameters for each item (supports "Run Once for Each Item" mode)
      const fileNameParam = this.getNodeParameter('fileName', i) as string;
      const pageFormat = this.getNodeParameter('pageFormat', i) as string || 'A4';
      const outputType = this.getNodeParameter('outputType', i) as string || 'binary';
      const inputSource = this.getNodeParameter('inputSource', i) as string || 'previousNode';

      // Get field filter options
      const excludeFieldsRaw = this.getNodeParameter('excludeFields', i) as string || '';
      const includeFieldsRaw = this.getNodeParameter('includeFields', i) as string || '';
      const pdfTitle = this.getNodeParameter('pdfTitle', i) as string || '';

      // Get template options
      const useTemplate = this.getNodeParameter('useTemplate', i) as boolean || false;
      const htmlTemplate = useTemplate ? (this.getNodeParameter('htmlTemplate', i) as string || '') : '';

      // Parse field lists
      const excludeFields = excludeFieldsRaw.split(',').map(f => f.trim().toLowerCase()).filter(f => f);
      const includeFields = includeFieldsRaw.split(',').map(f => f.trim().toLowerCase()).filter(f => f);

      // Create options object for rendering
      const renderOptions = {
        excludeFields,
        includeFields,
        pdfTitle,
      };

      let contentForPdf: string = '';
      let isJsonData = false;
      let rawData: any = null; // Store raw data for template processing

      if (inputSource === 'manual') {
        // Get content from manual input field (supports expressions)
        contentForPdf = this.getNodeParameter('htmlContent', i) as string || '';
        if (!contentForPdf) {
          contentForPdf = '<div></div>';
        }
        // Check if manual input is JSON
        const trimmed = contentForPdf.trim();
        isJsonData = trimmed.startsWith('{') || trimmed.startsWith('[');
        if (isJsonData) {
          try { rawData = JSON.parse(trimmed); } catch { rawData = item.json; }
        } else {
          rawData = item.json;
        }
      } else {
        // Get content from previous node data
        const inputField = this.getNodeParameter('inputField', i) as string || 'output';
        const fieldValue = (item.json as any)[inputField];

        if (fieldValue && typeof fieldValue === 'string') {
          contentForPdf = fieldValue;
          // Check if string is JSON
          const trimmed = fieldValue.trim();
          isJsonData = trimmed.startsWith('{') || trimmed.startsWith('[');
          if (isJsonData) {
            try { rawData = JSON.parse(trimmed); } catch { rawData = item.json; }
          } else {
            rawData = item.json;
          }
        } else if (fieldValue && typeof fieldValue === 'object') {
          // Object/Array - render directly as JSON for pdf-lib
          contentForPdf = JSON.stringify(fieldValue);
          isJsonData = true;
          rawData = fieldValue;
        } else {
          // Fallback: try common fields
          const commonFields = ['output', 'html', 'text', 'content', 'body'];
          let found = false;
          for (const field of commonFields) {
            const val = (item.json as any)[field];
            if (val) {
              if (typeof val === 'string') {
                contentForPdf = val;
                const trimmed = val.trim();
                isJsonData = trimmed.startsWith('{') || trimmed.startsWith('[');
                if (isJsonData) {
                  try { rawData = JSON.parse(trimmed); } catch { rawData = item.json; }
                } else {
                  rawData = item.json;
                }
              } else if (typeof val === 'object') {
                contentForPdf = JSON.stringify(val);
                isJsonData = true;
                rawData = val;
              }
              found = true;
              break;
            }
          }
          if (!found) {
            // Last resort: use entire item.json
            contentForPdf = JSON.stringify(item.json);
            isJsonData = true;
            rawData = item.json;
          }
        }
      }

      let pdfBuffer: Buffer | undefined;

      // If template is enabled, process the template with data
      if (useTemplate && htmlTemplate) {
        const processedHtml = processTemplate(htmlTemplate, rawData, pdfTitle);
        // Use HTML rendering for template output
        try {
          pdfBuffer = await renderHtmlToPdfUsingPuppeteer(processedHtml, pageFormat);
        } catch (err) {
          // Fallback to pdf-lib
          pdfBuffer = await renderTextPdfFallback(processedHtml, renderOptions);
        }
      }
      // For JSON data, use pdf-lib directly (renders tables properly)
      // For HTML, try external APIs first, then fallback to pdf-lib
      else if (isJsonData) {
        // Direct PDF generation with pdf-lib for structured data
        pdfBuffer = await renderTextPdfFallback(contentForPdf, renderOptions);
      } else {
        // Check if it looks like HTML
        const trimmed = contentForPdf.trim().toLowerCase();
        const isHtml = trimmed.startsWith('<') || trimmed.includes('<html') || trimmed.includes('<body') || trimmed.includes('<div') || trimmed.includes('<table');

        if (isHtml) {
          // Try external HTML-to-PDF APIs
          let htmlError: Error | null = null;
          try {
            pdfBuffer = await renderHtmlToPdfUsingPuppeteer(contentForPdf, pageFormat);
          } catch (err) {
            htmlError = err as Error;
            // Don't fallback to text rendering for HTML - try to preserve formatting
            // Wrap in full HTML document and try again with simpler structure
            const simpleHtml = wrapHtmlDocument(contentForPdf, pageFormat);
            try {
              pdfBuffer = await renderHtmlToPdfUsingPuppeteer(simpleHtml, pageFormat);
            } catch (err2) {
              // Last resort: use pdf-lib but preserve HTML structure as much as possible
              console.error('HTML rendering failed:', htmlError?.message, (err2 as Error).message);
              pdfBuffer = await renderTextPdfFallback(contentForPdf, renderOptions);
            }
          }
        } else {
          // Plain text - use pdf-lib
          pdfBuffer = await renderTextPdfFallback(contentForPdf, renderOptions);
        }
      }

      if (!pdfBuffer) {
        throw new NodeOperationError(this.getNode(), 'Failed to create PDF for item ' + i);
      }

      const outFileName = fileNameParam || `output-${i + 1}.pdf`;

      // create new item with json data
      const newItem: INodeExecutionData = {
        json: { ...item.json } as IDataObject,
        binary: {},
      } as unknown as INodeExecutionData;

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
          (newItem.json as IDataObject).pdfUrl = pdfUrl;
          (newItem.json as IDataObject).pdfFileName = outFileName;
        } catch (uploadErr) {
          // If upload fails, add error info but don't fail the whole operation
          (newItem.json as IDataObject).pdfUrlError = `Failed to upload PDF: ${(uploadErr as Error).message}`;
        }
      }

      returnItems.push(newItem);
    }

    return this.prepareOutputData(returnItems);
  }
}

// Helper functions moved outside the class to avoid 'this' context issues

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripHtmlTags(v: string): string {
  if (!v) return '';
  return String(v).replace(/<[^>]*>/g, ' ');
}

function toHtml(obj: any): string {
  // If obj already contains html property and it looks like HTML, return it
  if (!obj) return '<div></div>';

  // If string, try to parse as JSON first
  if (typeof obj === 'string') {
    const s = obj.trim();

    // If it looks like HTML, return as-is
    if (s.startsWith('<') && s.endsWith('>')) return s;

    // Try to parse as JSON
    if (s.startsWith('{') || s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        return toHtml(parsed); // Recursively convert parsed JSON
      } catch {
        // Not valid JSON, continue with string handling
      }
    }

    // Plain text - wrap in pre tag
    return `<div><pre>${escapeHtml(s)}</pre></div>`;
  }

  // if object has a field 'html'
  if (obj.html && typeof obj.html === 'string') return obj.html;

  // if text
  if (obj.text && typeof obj.text === 'string') return `<div><pre>${escapeHtml(obj.text)}</pre></div>`;

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
function renderArrayAsHtml(arr: any[]): string {
  if (!arr.length) return '<p>Keine Daten</p>';

  // detect if array of objects
  if (typeof arr[0] === 'object' && arr[0] !== null) {
    const keys = Array.from(arr.reduce((acc: Set<string>, cur: any) => {
      if (cur && typeof cur === 'object') {
        Object.keys(cur).forEach(k => acc.add(k));
      }
      return acc;
    }, new Set<string>()));

    const header = keys.map(k => `<th>${escapeHtml(formatLabel(String(k)))}</th>`).join('');
    const rows = arr.map((row: any) => {
      const cells = keys.map(k => {
        const val = row?.[k];
        return `<td>${formatValue(val)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  // Simple array - render as list
  const listItems = arr.map((x: any) => `<li>${formatValue(x)}</li>`).join('');
  return `<ul>${listItems}</ul>`;
}

// Render an object as HTML - with special handling for common patterns
function renderObjectAsHtml(obj: any): string {
  const parts: string[] = [];

  // Check for arrays in the object (like "perioden") - render them as tables
  const arrayKeys: string[] = [];
  const scalarKeys: string[] = [];

  for (const key of Object.keys(obj)) {
    if (Array.isArray(obj[key])) {
      arrayKeys.push(key);
    } else {
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
function formatLabel(key: string): string {
  return key
    // Insert space before uppercase letters (camelCase)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Replace underscores with spaces
    .replace(/_/g, ' ')
    // Capitalize first letter
    .replace(/^./, str => str.toUpperCase());
}

// Format a value for display
function formatValue(val: any): string {
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
    if (val.length === 0) return '<span class="null">-</span>';
    // For nested arrays, render inline or as sub-table
    if (typeof val[0] === 'object') {
      return renderArrayAsHtml(val);
    }
    return escapeHtml(val.join(', '));
  }
  if (typeof val === 'object') {
    // Nested object - render as mini-table
    const rows = Object.keys(val).map(k =>
      `<tr><th>${escapeHtml(formatLabel(k))}</th><td>${formatValue(val[k])}</td></tr>`
    ).join('');
    return `<table class="nested">${rows}</table>`;
  }
  return escapeHtml(String(val));
}

async function renderHtmlToPdfUsingPuppeteer(html: string, pageFormat = 'A4'): Promise<Buffer> {
  const errors: string[] = [];

  // Normalize HTML string - handle escaped characters
  let normalizedHtml = html;
  // Replace literal \n with actual newlines if present
  if (html.includes('\\n')) {
    normalizedHtml = html.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
  }

  // Wrap HTML in a complete document with proper styling if not already complete
  const wrappedHtml = wrapHtmlDocument(normalizedHtml, pageFormat);

  // Try weasyprint.org first - free, no API key required, no watermark
  try {
    return await renderWithWeasyprint(wrappedHtml, pageFormat);
  } catch (e) {
    errors.push(`Weasyprint: ${(e as Error).message}`);
  }

  // Try html2pdf.app - free tier available, no watermark
  try {
    return await renderWithHtml2PdfApp(wrappedHtml, pageFormat);
  } catch (e) {
    errors.push(`Html2Pdf: ${(e as Error).message}`);
  }

  // Try PDFShift API (has watermark but works reliably)
  try {
    return await renderWithPdfShift(wrappedHtml, pageFormat);
  } catch (e) {
    errors.push(`PDFShift: ${(e as Error).message}`);
  }

  throw new Error(`All PDF rendering methods failed: ${errors.join('; ')}`);
}

// PDFShift API - reliable but has watermark on free tier
async function renderWithPdfShift(html: string, pageFormat: string): Promise<Buffer> {
  const https = require('https');

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      source: html,
      landscape: false,
      use_print: false,
    });

    const options = {
      hostname: 'api.pdfshift.io',
      path: '/v3/convert/pdf',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const result = Buffer.concat(chunks);
        if (res.statusCode === 200 && result.length > 100 && result.slice(0, 4).toString() === '%PDF') {
          resolve(result);
        } else {
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

// Wrap HTML content in a complete document with proper styling
function wrapHtmlDocument(html: string, pageFormat: string): string {
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
async function renderWithWeasyprint(html: string, pageFormat: string): Promise<Buffer> {
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

    const req = https.request(options, (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const result = Buffer.concat(chunks);
        if (res.statusCode === 200 && result.length > 100 && result.slice(0, 4).toString() === '%PDF') {
          resolve(result);
        } else {
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
async function renderWithHtml2PdfApp(html: string, pageFormat: string): Promise<Buffer> {
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

    const req = https.request(options, (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const result = Buffer.concat(chunks);
        if (res.statusCode === 200 && result.length > 100 && result.slice(0, 4).toString() === '%PDF') {
          resolve(result);
        } else {
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

// Options interface for PDF rendering
interface RenderOptions {
  excludeFields: string[];
  includeFields: string[];
  pdfTitle: string;
}

async function renderTextPdfFallback(htmlOrText: string, options: RenderOptions = { excludeFields: [], includeFields: [], pdfTitle: '' }): Promise<Buffer> {
  // Create PDF using pdf-lib with proper table rendering
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
  const pdfDoc = await PDFDocument.create();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Try to parse as JSON for structured rendering
  let data: any = null;
  const trimmed = htmlOrText.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      data = JSON.parse(trimmed);
    } catch {
      // Not valid JSON
    }
  }

  // If we have structured data, render it nicely
  if (data && typeof data === 'object') {
    // Filter data based on options
    data = filterDataFields(data, options);
    return await renderStructuredPdf(pdfDoc, data, font, fontBold, options);
  }

  // Fallback: render as plain text
  const text = sanitizeForPdf(stripHtmlTags(htmlOrText));
  const page = pdfDoc.addPage();
  const fontSize = 11;
  const { width, height } = page.getSize();
  const margin = 50;
  const maxWidth = width - margin * 2;

  const lines = wrapText(text, fontSize, font, maxWidth);

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

// Filter data fields based on include/exclude options
function filterDataFields(data: any, options: RenderOptions): any {
  const { excludeFields, includeFields } = options;

  // Helper to check if a field should be included
  const shouldIncludeField = (fieldName: string): boolean => {
    const lowerField = fieldName.toLowerCase();

    // If includeFields is set, only include those fields
    if (includeFields.length > 0) {
      return includeFields.includes(lowerField);
    }

    // Otherwise, exclude fields in excludeFields
    if (excludeFields.length > 0) {
      return !excludeFields.includes(lowerField);
    }

    return true;
  };

  // Recursively filter object
  const filterObject = (obj: any): any => {
    if (Array.isArray(obj)) {
      return obj.map(item => filterObject(item));
    }

    if (obj && typeof obj === 'object') {
      const filtered: any = {};
      for (const key of Object.keys(obj)) {
        if (shouldIncludeField(key)) {
          filtered[key] = filterObject(obj[key]);
        }
      }
      return filtered;
    }

    return obj;
  };

  return filterObject(data);
}

// Render structured JSON data as a nicely formatted PDF
async function renderStructuredPdf(pdfDoc: any, data: any, font: any, fontBold: any, options: RenderOptions = { excludeFields: [], includeFields: [], pdfTitle: '' }): Promise<Buffer> {
  const { rgb } = require('pdf-lib');

  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const margin = 50;
  const contentWidth = width - margin * 2;

  let y = height - margin;
  const lineHeight = 14;
  const titleSize = 18;
  const headerSize = 14;
  const subHeaderSize = 11;
  const textSize = 9;
  const smallSize = 8;
  const cellPadding = 4;

  // Helper: Check if we need a new page
  const checkNewPage = (neededSpace: number) => {
    if (y - neededSpace < margin) {
      page = pdfDoc.addPage();
      y = height - margin;
    }
  };

  // Helper: Draw text with color
  const drawText = (text: string, x: number, yPos: number, size: number, bold = false, color = rgb(0, 0, 0)) => {
    const f = bold ? fontBold : font;
    const safeText = sanitizeForPdf(String(text || ''));
    page.drawText(safeText, { x, y: yPos, size, font: f, color });
  };

  // Helper: Draw a line
  const drawLine = (x1: number, y1: number, x2: number, y2: number, thickness = 0.5, color = rgb(0.8, 0.8, 0.8)) => {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
  };

  // Helper: Draw rectangle
  const drawRect = (x: number, yPos: number, w: number, h: number, fillColor: any) => {
    page.drawRectangle({ x, y: yPos, width: w, height: h, color: fillColor });
  };

  // Format date/time for display
  const formatDateTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('de-CH', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return dateStr; }
  };

  // Current date/time header
  const now = new Date();
  const dateTimeStr = now.toLocaleString('de-CH', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  drawText(`Erstellt: ${dateTimeStr}`, margin, y, smallSize, false, rgb(0.5, 0.5, 0.5));
  y -= 25;

  // Check if this is a Git commits report (array with repository/commits structure)
  const isGitReport = Array.isArray(data) && data.length > 0 && data[0].repository && data[0].commits;

  if (isGitReport) {
    // Special rendering for Git commit reports
    const title = options.pdfTitle || 'Git Commit Report';
    drawText(title, margin, y, titleSize, true);
    y -= titleSize + 15;

    for (const repo of data) {
      checkNewPage(100);

      // Repository header
      drawRect(margin, y - lineHeight - 2, contentWidth, lineHeight + 6, rgb(0.2, 0.4, 0.6));
      drawText(sanitizeForPdf(repo.repository || 'Unknown Repository'), margin + cellPadding, y - textSize, subHeaderSize, true, rgb(1, 1, 1));
      y -= lineHeight + 10;

      // Commit count
      const commitCount = repo.count || (repo.commits ? repo.commits.length : 0);
      drawText(`Anzahl Commits: ${commitCount}`, margin, y - textSize, textSize, false, rgb(0.4, 0.4, 0.4));
      y -= lineHeight + 5;

      // Commits table header
      const cols = [
        { label: 'SHA', width: 60 },
        { label: 'Nachricht', width: 200 },
        { label: 'Autor', width: 100 },
        { label: 'Datum', width: contentWidth - 360 }
      ];

      checkNewPage(lineHeight * 2);
      drawRect(margin, y - lineHeight + 2, contentWidth, lineHeight, rgb(0.9, 0.93, 0.98));

      let colX = margin;
      for (const col of cols) {
        drawText(col.label, colX + cellPadding, y - textSize, textSize, true);
        colX += col.width;
      }
      drawLine(margin, y - lineHeight + 2, margin + contentWidth, y - lineHeight + 2);
      y -= lineHeight;

      // Commit rows
      const commits = repo.commits || [];
      for (let i = 0; i < commits.length; i++) {
        checkNewPage(lineHeight + 5);
        const commit = commits[i];

        // Alternating background
        if (i % 2 === 0) {
          drawRect(margin, y - lineHeight + 2, contentWidth, lineHeight, rgb(0.97, 0.97, 0.97));
        }

        colX = margin;

        // SHA (short)
        const sha = commit.shortSha || commit.sha || '-';
        drawText(sha.substring(0, 7), colX + cellPadding, y - textSize, smallSize, false, rgb(0.3, 0.3, 0.7));
        colX += cols[0].width;

        // Message (truncated)
        const msg = commit.message || '-';
        const maxMsgLen = 40;
        const displayMsg = msg.length > maxMsgLen ? msg.substring(0, maxMsgLen - 2) + '..' : msg;
        drawText(displayMsg.replace(/\n/g, ' '), colX + cellPadding, y - textSize, smallSize);
        colX += cols[1].width;

        // Author (extract name from object)
        let authorName = '-';
        if (commit.author) {
          if (typeof commit.author === 'string') {
            authorName = commit.author;
          } else if (commit.author.name) {
            authorName = commit.author.name;
          }
        }
        const maxAuthorLen = 18;
        const displayAuthor = authorName.length > maxAuthorLen ? authorName.substring(0, maxAuthorLen - 2) + '..' : authorName;
        drawText(displayAuthor, colX + cellPadding, y - textSize, smallSize);
        colX += cols[2].width;

        // Date (extract from author object or commit)
        let dateStr = '-';
        if (commit.author && commit.author.date) {
          dateStr = formatDateTime(commit.author.date);
        } else if (commit.date) {
          dateStr = formatDateTime(commit.date);
        }
        drawText(dateStr, colX + cellPadding, y - textSize, smallSize);

        // Row border
        drawLine(margin, y - lineHeight + 2, margin + contentWidth, y - lineHeight + 2);
        y -= lineHeight;
      }

      // Table borders
      drawLine(margin, y + (commits.length + 1) * lineHeight + 2, margin, y + 2);
      drawLine(margin + contentWidth, y + (commits.length + 1) * lineHeight + 2, margin + contentWidth, y + 2);

      y -= 25; // Space between repos
    }
  } else {
    // Generic structured data rendering
    const scalarKeys: string[] = [];
    const arrayKeys: string[] = [];
    const objectKeys: string[] = [];

    if (Array.isArray(data)) {
      arrayKeys.push('_root');
    } else {
      for (const key of Object.keys(data)) {
        const val = data[key];
        if (Array.isArray(val)) {
          arrayKeys.push(key);
        } else if (val && typeof val === 'object') {
          objectKeys.push(key);
        } else {
          scalarKeys.push(key);
        }
      }
    }

    // Title
    const genericTitle = options.pdfTitle || 'Datenreport';
    drawText(genericTitle, margin, y, titleSize, true);
    y -= titleSize + 15;

    // Render scalar values
    if (scalarKeys.length > 0) {
      drawText('Zusammenfassung', margin, y, headerSize, true, rgb(0.2, 0.4, 0.6));
      y -= headerSize + 8;

      const labelWidth = 160;
      for (const key of scalarKeys) {
        checkNewPage(lineHeight + 5);
        const val = data[key];
        const label = formatLabelForPdf(key);
        const valueStr = formatValueForPdf(val);

        if (scalarKeys.indexOf(key) % 2 === 0) {
          drawRect(margin, y - lineHeight + 2, contentWidth, lineHeight, rgb(0.96, 0.96, 0.96));
        }

        drawText(label, margin + cellPadding, y - textSize, textSize, true);

        // Truncate long values
        const maxValLen = 60;
        const displayVal = valueStr.length > maxValLen ? valueStr.substring(0, maxValLen - 2) + '..' : valueStr;
        drawText(displayVal, margin + labelWidth, y - textSize, textSize);

        drawLine(margin, y - lineHeight + 2, margin + contentWidth, y - lineHeight + 2);
        y -= lineHeight;
      }
      y -= 15;
    }

    // Render nested objects
    for (const key of objectKeys) {
      checkNewPage(50);
      const obj = data[key];

      drawText(formatLabelForPdf(key), margin, y, subHeaderSize, true, rgb(0.3, 0.5, 0.3));
      y -= subHeaderSize + 6;

      const labelWidth = 140;
      for (const subKey of Object.keys(obj)) {
        checkNewPage(lineHeight + 5);
        const subVal = obj[subKey];

        // Skip nested objects/arrays in sub-objects
        if (typeof subVal === 'object' && subVal !== null) continue;

        drawText(formatLabelForPdf(subKey), margin + 10 + cellPadding, y - textSize, smallSize, true);
        drawText(formatValueForPdf(subVal), margin + 10 + labelWidth, y - textSize, smallSize);
        y -= lineHeight - 2;
      }
      y -= 10;
    }

    // Render arrays as tables
    for (const key of arrayKeys) {
      const arr = key === '_root' ? data : data[key];
      if (!Array.isArray(arr) || arr.length === 0) continue;

      checkNewPage(60);

      if (key !== '_root') {
        drawText(formatLabelForPdf(key), margin, y, subHeaderSize, true, rgb(0.2, 0.4, 0.6));
        y -= subHeaderSize + 8;
      }

      // Get simple (non-object) column keys
      const colKeys: string[] = [];
      if (typeof arr[0] === 'object' && arr[0] !== null) {
        for (const k of Object.keys(arr[0])) {
          const sample = arr[0][k];
          // Only include simple values, not nested objects/arrays
          if (typeof sample !== 'object' || sample === null) {
            colKeys.push(k);
          }
        }
      }

      if (colKeys.length === 0) {
        // Fallback: show as text
        for (const item of arr) {
          checkNewPage(lineHeight);
          drawText('- ' + formatValueForPdf(item), margin, y - textSize, textSize);
          y -= lineHeight;
        }
        continue;
      }

      // Calculate column widths
      const colWidth = contentWidth / colKeys.length;

      // Header
      drawRect(margin, y - lineHeight + 2, contentWidth, lineHeight, rgb(0.9, 0.93, 0.98));
      for (let i = 0; i < colKeys.length; i++) {
        const x = margin + i * colWidth;
        const label = formatLabelForPdf(colKeys[i]);
        const maxChars = Math.floor(colWidth / 5);
        const displayLabel = label.length > maxChars ? label.substring(0, maxChars - 2) + '..' : label;
        drawText(displayLabel, x + cellPadding, y - textSize, smallSize, true);
      }
      drawLine(margin, y - lineHeight + 2, margin + contentWidth, y - lineHeight + 2);
      y -= lineHeight;

      // Data rows
      for (let rowIdx = 0; rowIdx < arr.length; rowIdx++) {
        checkNewPage(lineHeight + 5);
        const row = arr[rowIdx];

        if (rowIdx % 2 === 0) {
          drawRect(margin, y - lineHeight + 2, contentWidth, lineHeight, rgb(0.97, 0.97, 0.97));
        }

        for (let i = 0; i < colKeys.length; i++) {
          const x = margin + i * colWidth;
          const val = row[colKeys[i]];
          const valueStr = formatValueForPdf(val);
          const maxChars = Math.floor(colWidth / 4.5);
          const displayVal = valueStr.length > maxChars ? valueStr.substring(0, maxChars - 2) + '..' : valueStr;
          drawText(displayVal, x + cellPadding, y - textSize, smallSize);
        }

        drawLine(margin, y - lineHeight + 2, margin + contentWidth, y - lineHeight + 2);
        y -= lineHeight;
      }

      y -= 20;
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// Remove emojis and non-WinAnsi characters that pdf-lib cannot encode
function sanitizeForPdf(text: string): string {
  if (!text) return '';
  // Remove emojis and other characters outside the basic Latin range
  // WinAnsi can only encode characters in the Windows-1252 codepage
  return String(text)
    // Remove emojis (Unicode ranges for emojis)
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')  // Misc Symbols, Emoticons, etc.
    .replace(/[\u{2600}-\u{26FF}]/gu, '')    // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')    // Dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')    // Variation Selectors
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')  // Extended emojis
    // Replace common special characters with ASCII equivalents
    .replace(/[\u2018\u2019]/g, "'")         // Smart quotes
    .replace(/[\u201C\u201D]/g, '"')         // Smart double quotes
    .replace(/\u2026/g, '...')               // Ellipsis
    .replace(/\u2013/g, '-')                 // En dash
    .replace(/\u2014/g, '--')                // Em dash
    .replace(/\u00A0/g, ' ')                 // Non-breaking space
    // Remove any remaining non-printable or non-WinAnsi characters
    .replace(/[^\x00-\xFF]/g, '')
    .trim();
}

// Format label for PDF (camelCase to readable)
function formatLabelForPdf(key: string): string {
  const label = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, str => str.toUpperCase());
  return sanitizeForPdf(label);
}

// Format value for PDF display
function formatValueForPdf(val: any): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'boolean') return val ? 'Ja' : 'Nein';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') return sanitizeForPdf(val);
  if (Array.isArray(val)) return sanitizeForPdf(val.map(v => formatValueForPdf(v)).join(', '));
  if (typeof val === 'object') return sanitizeForPdf(JSON.stringify(val));
  return String(val);
}

// Process HTML template with data placeholders
function processTemplate(template: string, data: any, title: string): string {
  if (!template) return '';

  let result = template;

  // Current date/time
  const now = new Date();
  const dateStr = now.toLocaleString('de-CH', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  // Replace simple placeholders
  result = result.replace(/\{\{title\}\}/gi, escapeHtml(title || 'Dokument'));
  result = result.replace(/\{\{date\}\}/gi, dateStr);
  result = result.replace(/\{\{datetime\}\}/gi, dateStr);

  // Replace {{json}} with formatted JSON
  result = result.replace(/\{\{json\}\}/gi, `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`);

  // Replace {{content}} with auto-generated HTML from data
  result = result.replace(/\{\{content\}\}/gi, toHtml(data));

  // Replace {{table}} with table rendering (for arrays)
  if (Array.isArray(data)) {
    result = result.replace(/\{\{table\}\}/gi, renderArrayAsHtml(data));
  } else if (data && typeof data === 'object') {
    // Find first array in data for table
    const arrayKey = Object.keys(data).find(k => Array.isArray(data[k]));
    if (arrayKey) {
      result = result.replace(/\{\{table\}\}/gi, renderArrayAsHtml(data[arrayKey]));
    } else {
      result = result.replace(/\{\{table\}\}/gi, renderObjectAsHtml(data));
    }
  } else {
    result = result.replace(/\{\{table\}\}/gi, '');
  }

  // Replace {{data.fieldName}} with specific field values
  result = result.replace(/\{\{data\.([a-zA-Z0-9_\.]+)\}\}/gi, (match, fieldPath) => {
    const value = getNestedValue(data, fieldPath);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        return renderArrayAsHtml(value);
      }
      return renderObjectAsHtml(value);
    }
    return escapeHtml(String(value));
  });

  // Replace {{fieldName}} directly (without data. prefix)
  result = result.replace(/\{\{([a-zA-Z0-9_]+)\}\}/gi, (match, fieldName) => {
    // Skip already processed placeholders
    if (['title', 'date', 'datetime', 'json', 'content', 'table'].includes(fieldName.toLowerCase())) {
      return match;
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const value = data[fieldName];
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') {
        if (Array.isArray(value)) {
          return renderArrayAsHtml(value);
        }
        return renderObjectAsHtml(value);
      }
      return escapeHtml(String(value));
    }
    return '';
  });

  return result;
}

// Get nested value from object using dot notation (e.g., "author.name")
function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function wrapText(text: string, fontSize: number, font: any, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const trial = current ? current + ' ' + w : w;
    const trialWidth = font.widthOfTextAtSize(trial, fontSize);
    if (trialWidth > maxWidth) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function uploadToTempFileService(buffer: Buffer, fileName: string): Promise<string> {
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

      const req = https.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.success && response.link) {
              resolve(response.link);
            } else {
              reject(new Error(response.message || 'Upload failed'));
            }
          } catch (e) {
            reject(new Error('Failed to parse upload response'));
          }
        });
      });

      req.on('error', (e: Error) => {
        reject(e);
      });

      form.pipe(req);
    } catch (e) {
      reject(e);
    }
  });
}
