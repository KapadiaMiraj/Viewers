import { Types } from '@ohif/core';
import { addTool } from '@cornerstonejs/tools';
import FlatfootMeasurementTool from './tools/FlatfootMeasurementTool';

/**
 * Add our custom tool to cornerstoneTools before the mode connects everything
 */
export default function init({ servicesManager, configuration = {} }: Types.Extensions.ExtensionParams): void {
  addTool(FlatfootMeasurementTool);
}
