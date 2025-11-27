// minimal stubs for n8n-workflow used for compilation and tests
export interface INodeType {
  description: INodeTypeDescription;
  methods?: any;
  execute?(this: any): Promise<INodeExecutionData[][]>;
}

export interface INodeTypeDescription {
  displayName?: string;
  name?: string;
  icon?: string;
  group?: string[];
  version?: number;
  description?: string;
  defaults?: {
    name?: string;
    color?: string;
  };
  inputs?: string[];
  outputs?: string[];
  credentials?: Array<{
    name: string;
    required?: boolean;
  }>;
  properties?: INodeProperties[];
}

export interface INodeProperties {
  displayName: string;
  name: string;
  type: string;
  default?: any;
  description?: string;
  options?: Array<{
    name: string;
    value: string;
  }>;
  required?: boolean;
  typeOptions?: {
    rows?: number;
    [key: string]: any;
  };
  displayOptions?: {
    show?: {
      [key: string]: string[];
    };
    hide?: {
      [key: string]: string[];
    };
  };
}

export interface IDataObject { [key: string]: any }
export interface INodeExecutionData { json?: IDataObject; binary?: any }

export class NodeOperationError extends Error {
  constructor(node: any, message: string) {
    super(message);
    this.name = 'NodeOperationError';
  }
}

export interface ICredentialType {
  name: string;
  displayName: string;
  properties: INodeProperties[];
}
