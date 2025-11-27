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
        const returnItems = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            // derive HTML string from many input types
            const html = toHtml(item.json);
            let pdfBuffer;
            // Prefer Puppeteer (renders HTML/CSS) — if it fails, fallback to text PDF using pdf-lib
            try {
                pdfBuffer = await renderHtmlToPdfUsingPuppeteer(html, pageFormat);
            }
            catch (err) {
                // fallback to basic text PDF using pdf-lib
                pdfBuffer = await renderTextPdfFallback(html);
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
    if (typeof obj === 'string') {
        const s = obj.trim();
        if (s.startsWith('<') && s.endsWith('>'))
            return s;
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
        // detect if array of objects
        if (obj.length && typeof obj[0] === 'object') {
            const keys = Array.from(obj.reduce((acc, cur) => {
                Object.keys(cur).forEach(k => acc.add(k));
                return acc;
            }, new Set()));
            const header = keys.map(k => `<th>${escapeHtml(String(k))}</th>`).join('');
            const rows = obj.map((row) => `<tr>${keys.map(k => `<td>${escapeHtml(String(row[k] ?? ''))}</td>`).join('')}</tr>`).join('');
            return `<html><body><table border="1" style="border-collapse:collapse">${header ? `<thead><tr>${header}</tr></thead>` : ''}<tbody>${rows}</tbody></table></body></html>`;
        }
        // fallback to list
        const listItems = obj.map((x) => `<li>${escapeHtml(JSON.stringify(x))}</li>`).join('');
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
async function renderHtmlToPdfUsingPuppeteer(html, pageFormat = 'A4') {
    // Try to render HTML into a PDF using headless Chrome
    const puppeteerModule = require('puppeteer');
    const browser = await puppeteerModule.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
        const page = await browser.newPage();
        // Set content — include a minimal meta for responsive
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const buffer = await page.pdf({ format: pageFormat });
        await page.close();
        await browser.close();
        return Buffer.from(buffer);
    }
    catch (err) {
        try {
            await browser.close();
        }
        catch (_) {
            // ignore
        }
        throw err;
    }
}
async function renderTextPdfFallback(htmlOrText) {
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
