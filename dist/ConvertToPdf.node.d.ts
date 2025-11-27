import { IExecuteFunctions } from 'n8n-core';
import { INodeType, INodeTypeDescription, INodeExecutionData } from 'n8n-workflow';
export declare class ConvertToPdf implements INodeType {
    description: INodeTypeDescription;
    methods: {};
    execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
}
