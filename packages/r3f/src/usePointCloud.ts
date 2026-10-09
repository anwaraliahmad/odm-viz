import { useEffect, useState } from 'react';
import { LasWorker, type DecodeOptions, type DecodedPointCloud } from '@odm-viz/las';

export type PointCloudSource = string | URL | Blob | ArrayBuffer | null | undefined;

export type LoadState =
  | { status: 'idle' }
  | { status: 'fetching'; loaded: number; total: number }
  | { status: 'decoding'; done: number; total: number }
  | { status: 'ready'; cloud: DecodedPointCloud; bytes: number; fetchMs: number }
  | { status: 'error'; error: Error };

export type UsePointCloudOptions = Pick<DecodeOptions, 'stride' | 'maxPoints' | 'colors'> & {
  /** Worker to decode with. Defaults to one shared worker. */
  worker?: LasWorker;
};

const IDLE: LoadState = { status: 'idle' };

let sharedWorker: LasWorker | null = null;
const getSharedWorker = () => (sharedWorker ??= new LasWorker());

/** Read a fetch Response fully, reporting progress as chunks arrive. */
async function readWithProgress(
  res: Response,
  onProgress: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  if (!res.body) return res.arrayBuffer();
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out.buffer;
}

/**
 * Fetch (or read) and decode a LAS/LAZ point cloud off the main thread. Changing the
 * source or options aborts the previous load.
 */
export function usePointCloud(source: PointCloudSource, options: UsePointCloudOptions = {}) {
  const { stride, maxPoints, colors, worker } = options;
  const [state, setState] = useState<LoadState>(IDLE);

  useEffect(() => {
    if (source == null) return;
    const ac = new AbortController();
    const { signal } = ac;

    (async () => {
      const t0 = performance.now();
      let buffer: ArrayBuffer;
      if (source instanceof ArrayBuffer) {
        // Copy so the caller's buffer survives transfer to the worker.
        buffer = source.slice(0);
      } else if (source instanceof Blob) {
        setState({ status: 'fetching', loaded: 0, total: source.size });
        buffer = await source.arrayBuffer();
      } else {
        setState({ status: 'fetching', loaded: 0, total: 0 });
        const res = await fetch(source, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${String(source)}`);
        let last = 0;
        buffer = await readWithProgress(res, (loaded, total) => {
          // Throttle React updates to roughly every 1%.
          if (loaded - last > Math.max(total / 100, 1 << 20) || loaded === total) {
            last = loaded;
            if (!signal.aborted) setState({ status: 'fetching', loaded, total });
          }
        });
      }
      const fetchMs = performance.now() - t0;
      const bytes = buffer.byteLength;
      if (signal.aborted) return;

      setState({ status: 'decoding', done: 0, total: 0 });
      const cloud = await (worker ?? getSharedWorker()).decode(buffer, {
        stride,
        maxPoints,
        colors,
        signal,
        onProgress: (done, total) => {
          if (!signal.aborted) setState({ status: 'decoding', done, total });
        },
      });
      if (!signal.aborted) setState({ status: 'ready', cloud, bytes, fetchMs });
    })().catch((err: unknown) => {
      if (signal.aborted) return;
      setState({ status: 'error', error: err instanceof Error ? err : new Error(String(err)) });
    });

    return () => ac.abort();
  }, [source, stride, maxPoints, colors, worker]);

  return source == null ? IDLE : state;
}
