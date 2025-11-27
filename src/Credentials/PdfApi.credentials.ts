import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class PdfApi implements ICredentialType {
  name = 'pdfApi';
  displayName = 'PDF API Key';
  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      default: '',
      description: 'A secret API key used to enable this node — the node will refuse to run without it.'
    }
  ];
}
