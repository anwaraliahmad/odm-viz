import type { WorkerRequest, WorkerResponse } from './protocol.js';
import type { DecodeOptions, DecodedPointCloud } from './types.js';

export interface WorkerDecodeOptions extends DecodeOptions {
  /** Abort the decode. The worker is restarted, so other in-flight decodes also reject. */
  signal?: AbortSignal;
  /**
   * Transfer `buffer` to the worker instead of copying it (default true). The caller's
   * ArrayBuffer is detached afterwards; pass false to keep using it.
   */
  transfer?: boolean;
}

interface Pending {
  resolve: (cloud: DecodedPointCloud) => void;
  reject: (err: unknown) => void;
  onProgress?: (done: number, total: number) => void;
}

const abortError = () => new DOMException('Decode aborted', 'AbortError');

/** Decodes LAS/LAZ off the main thread. Results come back as transferred typed arrays. */
export class LasWorker {
  #worker: Worker | null = null;
  #pending = new Map<number, Pending>();
  #nextId = 1;
  readonly #create: () => Worker;

  constructor(create?: () => Worker) {
    this.#create =
      create ?? (() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
  }

  #ensure(): Worker {
    if (this.#worker) return this.#worker;
    const w = this.#create();
    w.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const job = this.#pending.get(data.id);
      if (!job) return;
      if (data.type === 'progress') return job.onProgress?.(data.done, data.total);
      this.#pending.delete(data.id);
      if (data.type === 'result') job.resolve(data.cloud);
      else job.reject(new Error(data.message));
    };
    w.onerror = (e) => this.#reset(new Error(e.message || 'LAS worker crashed'));
    this.#worker = w;
    return w;
  }

  #reset(reason: unknown) {
    this.#worker?.terminate();
    this.#worker = null;
    for (const job of this.#pending.values()) job.reject(reason);
    this.#pending.clear();
  }

  decode(buffer: ArrayBuffer, options: WorkerDecodeOptions = {}): Promise<DecodedPointCloud> {
    const { signal, transfer = true, onProgress, ...rest } = options;
    if (signal?.aborted) return Promise.reject(abortError());

    return new Promise<DecodedPointCloud>((resolve, reject) => {
      const id = this.#nextId++;
      const onAbort = () => this.#reset(abortError());
      const settle =
        <T>(fn: (v: T) => void) =>
        (v: T) => {
          signal?.removeEventListener('abort', onAbort);
          fn(v);
        };
      this.#pending.set(id, { resolve: settle(resolve), reject: settle(reject), onProgress });
      signal?.addEventListener('abort', onAbort, { once: true });

      const msg: WorkerRequest = { id, buffer, options: rest, progress: !!onProgress };
      this.#ensure().postMessage(msg, transfer ? [buffer] : []);
    });
  }

  /** Terminate the worker; pending decodes reject. The instance can still be reused. */
  terminate() {
    this.#reset(abortError());
  }
}
