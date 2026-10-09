import type { DecodeOptions, DecodedPointCloud } from './types.js';

export type WorkerRequest = {
  id: number;
  buffer: ArrayBuffer;
  options: Omit<DecodeOptions, 'onProgress'>;
  progress: boolean;
};

export type WorkerResponse =
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'result'; cloud: DecodedPointCloud }
  | { id: number; type: 'error'; message: string };
