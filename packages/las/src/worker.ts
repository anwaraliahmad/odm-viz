/// <reference lib="webworker" />
import { decodeLas, init } from './decode.js';
import type { WorkerRequest, WorkerResponse } from './protocol.js';
import { transferablesOf } from './types.js';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  scope.postMessage(msg, transfer);

scope.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  const { id, buffer, options, progress } = data;
  try {
    await init();
    const cloud = decodeLas(new Uint8Array(buffer), {
      ...options,
      onProgress: progress
        ? (done, total) => post({ id, type: 'progress', done, total })
        : undefined,
    });
    post({ id, type: 'result', cloud }, transferablesOf(cloud));
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
