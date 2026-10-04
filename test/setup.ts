import { mock } from 'bun:test';
import * as mockVs from './mockVscode';
import Module from 'module';

mock.module('vscode', () => mockVs);

const origRequire = (Module.prototype as any).require;
(Module.prototype as any).require = function(this: any, path: string, ...args: any[]) {
  if (path === 'vscode') {
    return mockVs;
  }
  return origRequire.apply(this, [path, ...args]);
};
