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
    ],
  };

  methods = {};

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();

    const fileNameParam = this.getNodeParameter('fileName', 0) as string;
    const pageFormat = this.getNodeParameter('pageFormat', 0) as string || 'A4';
    const outputType = this.getNodeParameter('outputType', 0) as string || 'binary';
    const inputSource = this.getNodeParameter('inputSource', 0) as string || 'previousNode';

    const returnItems: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      let html: string = '';

      if (inputSource === 'manual') {
        // Get HTML from manual input field (supports expressions)
        html = this.getNodeParameter('htmlContent', i) as string || '';
        if (!html) {
          html = '<div></div>';
        }
      } else {
        // Get HTML from previous node data
        const inputField = this.getNodeParameter('inputField', i) as string || 'output';
        const fieldValue = (item.json as any)[inputField];

        if (fieldValue && typeof fieldValue === 'string') {
          // Use string value directly (it should be HTML)
          html = fieldValue;
        } else if (fieldValue) {
          // Convert non-string value to HTML
          html = toHtml(fieldValue);
        } else {
          // Fallback: try common fields like 'output', 'html', 'text'
          const commonFields = ['output', 'html', 'text', 'content', 'body'];
          let found = false;
          for (const field of commonFields) {
            const val = (item.json as any)[field];
            if (val && typeof val === 'string') {
              html = val;
              found = true;
              break;
            }
          }
          if (!found) {
            // Last resort: convert entire json to HTML table
            html = toHtml(item.json);
          }
        }
      }

      let pdfBuffer: Buffer | undefined;

      // Prefer Puppeteer (renders HTML/CSS) — if it fails, fallback to text PDF using pdf-lib
      try {
        pdfBuffer = await renderHtmlToPdfUsingPuppeteer(html, pageFormat);
      } catch (err) {
        // fallback to basic text PDF using pdf-lib
        pdfBuffer = await renderTextPdfFallback(html);
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

  if (typeof obj === 'string') {
    const s = obj.trim();
    if (s.startsWith('<') && s.endsWith('>')) return s;
    return `<div><pre>${escapeHtml(s)}</pre></div>`;
  }

  // if object has a field 'html'
  if (obj.html && typeof obj.html === 'string') return obj.html;

  // if text
  if (obj.text && typeof obj.text === 'string') return `<div><pre>${escapeHtml(obj.text)}</pre></div>`;

  // if array -> render table for arrays of objects
  if (Array.isArray(obj)) {
    // detect if array of objects
    if (obj.length && typeof obj[0] === 'object') {
      const keys = Array.from(obj.reduce((acc: Set<string>, cur: any) => {
        Object.keys(cur).forEach(k => acc.add(k));
        return acc;
      }, new Set()));

      const header = keys.map(k => `<th>${escapeHtml(String(k))}</th>`).join('');
      const rows = obj.map((row: any) => `<tr>${keys.map(k => `<td>${escapeHtml(String(row[k] ?? ''))}</td>`).join('')}</tr>`).join('');

      return `<html><body><table border="1" style="border-collapse:collapse">${header ? `<thead><tr>${header}</tr></thead>` : ''}<tbody>${rows}</tbody></table></body></html>`;
    }

    // fallback to list
    const listItems = obj.map((x: any) => `<li>${escapeHtml(JSON.stringify(x))}</li>`).join('');
    return `<html><body><ul>${listItems}</ul></body></html>`;
  }

  // if plain object -> render as table
  if (typeof obj === 'object') {
    const htmlRows = Object.keys(obj).map(k => `<tr><th style="text-align:left">${escapeHtml(k)}</th><td>${escapeHtml(JSON.stringify(obj[k]))}</td></tr>`).join('');
    return `<html><body><table border="1" style="border-collapse:collapse">${htmlRows}</table></body></html>`;
  }

  // fallback to string conversion
  return `<div><pre>${escapeHtml(String(obj))}</pre></div>`;
}

async function renderHtmlToPdfUsingPuppeteer(html: string, pageFormat = 'A4'): Promise<Buffer> {
  // Strategy 1: Try local Puppeteer
  try {
    const puppeteerModule = require('puppeteer');
    const browser = await puppeteerModule.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' } as any);
      const buffer = await page.pdf({ format: pageFormat as any, printBackground: true });
      await page.close();
      await browser.close();
      return Buffer.from(buffer);
    } catch (err) {
      try { await browser.close(); } catch (_) {}
      throw err;
    }
  } catch (puppeteerError) {
    // Strategy 2: Try wkhtmltopdf
    try {
      return await renderWithWkhtmltopdf(html, pageFormat);
    } catch (wkError) {
      // Strategy 3: Use free cloud API
      return await renderWithCloudApi(html, pageFormat);
    }
  }
}

async function renderWithWkhtmltopdf(html: string, pageFormat: string): Promise<Buffer> {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const tmpDir = os.tmpdir();
  const htmlFile = path.join(tmpDir, `html2pdf_${Date.now()}.html`);
  const pdfFile = path.join(tmpDir, `html2pdf_${Date.now()}.pdf`);

  fs.writeFileSync(htmlFile, html);

  const pageSize = pageFormat === 'Letter' ? 'Letter' : 'A4';
  execSync(`wkhtmltopdf --page-size ${pageSize} --enable-local-file-access "${htmlFile}" "${pdfFile}"`, {
    timeout: 30000,
    stdio: 'pipe'
  });

  const pdfBuffer = fs.readFileSync(pdfFile);

  try { fs.unlinkSync(htmlFile); } catch (_) {}
  try { fs.unlinkSync(pdfFile); } catch (_) {}

  return pdfBuffer;
}

async function renderWithCloudApi(html: string, pageFormat: string): Promise<Buffer> {
  const https = require('https');

  // Use free tier of html2pdf.app API
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);

    // Build multipart form data
    let body = '';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="html"; filename="document.html"\r\n`;
    body += `Content-Type: text/html\r\n\r\n`;
    body += html + '\r\n';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="pageSize"\r\n\r\n`;
    body += (pageFormat === 'Letter' ? 'Letter' : 'A4') + '\r\n';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="marginTop"\r\n\r\n`;
    body += '10\r\n';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="marginBottom"\r\n\r\n`;
    body += '10\r\n';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="marginLeft"\r\n\r\n`;
    body += '10\r\n';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="marginRight"\r\n\r\n`;
    body += '10\r\n';
    body += `--${boundary}--\r\n`;

    const options = {
      hostname: 'api.html2pdf.app',
      path: '/v1/generate',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const result = Buffer.concat(chunks);
        if (res.statusCode === 200 && result.length > 0) {
          // Check if it's actually a PDF (starts with %PDF)
          if (result.slice(0, 4).toString() === '%PDF') {
            resolve(result);
          } else {
            reject(new Error('API did not return a valid PDF'));
          }
        } else {
          reject(new Error(`Cloud API failed with status ${res.statusCode}: ${result.toString()}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function renderTextPdfFallback(htmlOrText: string): Promise<Buffer> {
  // Create a very simple PDF from the text content of the HTML using pdf-lib
  // Avoid requiring heavy DOM library in tests; do a simple tag-strip to extract text.
  const text = stripHtmlTags(htmlOrText);

  // Require pdf-lib dynamically so tests don't need this package to be installed
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 12;
  const { width, height } = page.getSize();
  const margin = 36;
  const maxWidth = width - margin * 2;

  // simple text wrapping
  const lines = wrapText(String(text), fontSize, font, maxWidth);

  let y = height - margin;
  for (const line of lines) {
    if (y < margin + fontSize) {
      // next page
      const p = pdfDoc.addPage();
      y = p.getSize().height - margin;
    }
    page.drawText(line, { x: margin, y: y - fontSize, size: fontSize, font, color: rgb(0, 0, 0) });
    y -= fontSize + 4;
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
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
