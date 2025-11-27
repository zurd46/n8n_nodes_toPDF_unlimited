"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdfApi = void 0;
class PdfApi {
    constructor() {
        this.name = 'pdfApi';
        this.displayName = 'PDF API Key';
        this.properties = [
            {
                displayName: 'API Key',
                name: 'apiKey',
                type: 'string',
                default: '',
                description: 'A secret API key used to enable this node — the node will refuse to run without it.'
            }
        ];
    }
}
exports.PdfApi = PdfApi;
