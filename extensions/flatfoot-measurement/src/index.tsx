import { Types } from '@ohif/core';
import { id } from './id';
import init from './init';
import getToolbarModule from './getToolbarModule';

const flatfootExtension: Types.Extensions.Extension = {
  id,
  preRegistration: init,
  getToolbarModule,
};

export default flatfootExtension;
