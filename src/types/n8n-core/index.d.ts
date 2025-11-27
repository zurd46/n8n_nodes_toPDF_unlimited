// minimal stubs for n8n-core used in tests
import { INodeExecutionData, IDataObject } from 'n8n-workflow';

export interface IBinaryData {
  data: string;
  mimeType: string;
  fileName?: string;
}

export interface IExecuteFunctions {
  getInputData(): INodeExecutionData[];
  getCredentials(type: string): Promise<IDataObject | undefined>;
  getNode(): any;
  getNodeParameter(parameterName: string, itemIndex: number, fallbackValue?: any): any;
  helpers: {
    prepareBinaryData(buffer: Buffer, fileName: string, mimeType: string): Promise<IBinaryData>;
  };
  prepareOutputData(outputData: INodeExecutionData[]): INodeExecutionData[][];
}
