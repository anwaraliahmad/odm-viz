import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, GizmoHelper, GizmoViewport, OrbitControls, useBounds } from '@react-three/drei';
import { Leva, useControls } from 'leva';
import {
  PointCloud,
  usePointCloud,
  type ColorMode,
  type LoadState,
  type PointCloudSource,
  type Ramp,
} from '@odm-viz/r3f';
import type { DecodedPointCloud } from '@odm-viz/las';

const SAMPLE = {
  label: 'Autzen Stadium, Oregon (10.6M pts, 81 MB)',
  url: 'https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz',
};

const BUDGETS = { '1M': 1e6, '2M': 2e6, '4M': 4e6, '8M': 8e6, '16M': 16e6, All: 0 };

function initialSource(): { source: PointCloudSource; name: string } | null {
  const url = new URLSearchParams(location.search).get('url');
  return url ? { source: url, name: url.split('/').pop() ?? url } : null;
}

/** Re-frames the camera whenever a new cloud arrives. */
function FitOnLoad({ cloud }: { cloud: DecodedPointCloud | null }) {
  const bounds = useBounds();
  useEffect(() => {
    if (cloud) bounds.refresh().clip().fit();
  }, [cloud, bounds]);
  return null;
}

export default function App() {
  const [input, setInput] = useState(initialSource);
  const [dragging, setDragging] = useState(false);

  const { colorMode, ramp, pointSize, budget, solidColor } = useControls({
    colorMode: {
      label: 'color',
      value: 'auto',
      options: ['auto', 'rgb', 'elevation', 'intensity', 'classification', 'solid'],
    },
    ramp: { value: 'turbo', options: ['turbo', 'viridis', 'grayscale'] },
    pointSize: { label: 'point px', value: 2, min: 1, max: 8, step: 0.5 },
    budget: { label: 'max points', value: '4M', options: Object.keys(BUDGETS) },
    solidColor: { label: 'solid', value: '#e0e0e0' },
  });

  const state = usePointCloud(input?.source, {
    maxPoints: BUDGETS[budget as keyof typeof BUDGETS],
  });
  const cloud = state.status === 'ready' ? state.cloud : null;

  const open = useCallback((source: PointCloudSource, name: string) => {
    setInput({ source, name });
    const url = new URL(location.href);
    if (typeof source === 'string') url.searchParams.set('url', source);
    else url.searchParams.delete('url');
    history.replaceState(null, '', url);
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) open(file, file.name);
  };

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <Canvas camera={{ fov: 50, near: 0.1, far: 100_000, position: [0, 200, 400] }} dpr={[1, 2]}>
        <color attach="background" args={['#0b0d12']} />
        <Bounds fit clip margin={1.1}>
          {cloud && (
            <PointCloud
              cloud={cloud}
              colorMode={colorMode === 'auto' ? undefined : (colorMode as ColorMode)}
              ramp={ramp as Ramp}
              pointSize={pointSize}
              solidColor={solidColor}
            />
          )}
          <FitOnLoad cloud={cloud} />
        </Bounds>
        <OrbitControls makeDefault enableDamping />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.9} />
        </GizmoHelper>
      </Canvas>

      <Leva collapsed={false} titleBar={{ title: 'view' }} />

      <aside className="panel">
        <h1>ODM Viz</h1>
        <p className="muted">
          Open LAS / LAZ point clouds in your browser. Files are decoded locally, in WebAssembly,
          and never uploaded.
        </p>
        <label className="button">
          Open file…
          <input
            type="file"
            accept=".las,.laz"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) open(f, f.name);
            }}
          />
        </label>
        <button className="button" onClick={() => open(SAMPLE.url, SAMPLE.label)}>
          Load sample: {SAMPLE.label}
        </button>
        <form
          className="url"
          onSubmit={(e) => {
            e.preventDefault();
            const url = new FormData(e.currentTarget).get('url');
            if (typeof url === 'string' && url) open(url, url.split('/').pop() ?? url);
          }}
        >
          <input name="url" type="url" placeholder="…or paste a .laz URL (CORS)" />
          <button className="button">Load</button>
        </form>
        <Status state={state} name={input?.name} />
      </aside>

      {dragging && <div className="drop">Drop a .las / .laz file</div>}
    </div>
  );
}

const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;
const fmt = (n: number) => n.toLocaleString();

function Status({ state, name }: { state: LoadState; name?: string }) {
  switch (state.status) {
    case 'idle':
      return <p className="muted">Drop a file anywhere to start.</p>;
    case 'fetching':
      return (
        <Progress
          label={`Downloading ${name ?? ''}`}
          value={state.total ? state.loaded / state.total : undefined}
          detail={state.total ? `${mb(state.loaded)} / ${mb(state.total)}` : mb(state.loaded)}
        />
      );
    case 'decoding':
      return (
        <Progress
          label="Decoding"
          value={state.total ? state.done / state.total : undefined}
          detail={state.total ? `${fmt(state.done)} / ${fmt(state.total)} pts` : ''}
        />
      );
    case 'error':
      return <p className="error">{state.error.message}</p>;
    case 'ready': {
      const { cloud } = state;
      const h = cloud.header;
      return (
        <dl className="stats">
          <dt>File</dt>
          <dd title={name}>{name}</dd>
          <dt>Format</dt>
          <dd>
            LAS {h.version} · PDRF {h.pointFormat}
            {h.isCompressed ? ' · LAZ' : ''}
            {h.isCopc ? ' · COPC' : ''}
          </dd>
          <dt>Points</dt>
          <dd>
            {fmt(cloud.pointCount)} of {fmt(h.pointCount)}
            {cloud.stride > 1 ? ` (every ${cloud.stride})` : ''}
          </dd>
          <dt>Extent</dt>
          <dd>
            {(cloud.bounds[3] - cloud.bounds[0]).toFixed(0)} ×{' '}
            {(cloud.bounds[4] - cloud.bounds[1]).toFixed(0)} ×{' '}
            {(cloud.bounds[5] - cloud.bounds[2]).toFixed(0)} (map units)
          </dd>
          <dt>Load</dt>
          <dd>
            {mb(state.bytes)} in {(state.fetchMs / 1000).toFixed(1)} s · decoded in{' '}
            {(cloud.decodeMs / 1000).toFixed(2)} s
          </dd>
        </dl>
      );
    }
  }
}

function Progress({ label, value, detail }: { label: string; value?: number; detail: string }) {
  return (
    <div className="progress">
      <div className="progress-label">
        <span>{label}</span>
        <span className="muted">{detail}</span>
      </div>
      <progress value={value} max={1} />
    </div>
  );
}
