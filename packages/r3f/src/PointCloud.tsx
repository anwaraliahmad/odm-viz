import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useThree, type ThreeElements } from '@react-three/fiber';
import type { DecodedPointCloud } from '@odm-viz/las';
import { createPointCloudGeometry, percentileRange } from './geometry.js';
import { PointCloudMaterial, type ColorMode, type Ramp } from './material.js';

export type PointCloudProps = Omit<ThreeElements['group'], 'children'> & {
  cloud: DecodedPointCloud;
  /** Default: 'rgb' when the cloud has colours, otherwise 'elevation'. */
  colorMode?: ColorMode;
  ramp?: Ramp;
  /** Point diameter in pixels (multiplied by the device pixel ratio). */
  pointSize?: number;
  solidColor?: string;
  /**
   * LAS data is z-up; three.js is y-up. When true (default) the cloud is rotated so the
   * ground plane lies on three's XZ plane.
   */
  zUp?: boolean;
};

/**
 * Renders a decoded cloud. Positions stay relative to `cloud.origin`, so the scene works
 * in local metres around the data instead of in raw (float32-hostile) map coordinates.
 */
export function PointCloud({
  cloud,
  colorMode,
  ramp = 'turbo',
  pointSize = 2,
  solidColor = '#e0e0e0',
  zUp = true,
  ...group
}: PointCloudProps) {
  const geometry = useMemo(() => createPointCloudGeometry(cloud), [cloud]);
  const material = useMemo(() => new PointCloudMaterial(), []);
  const ranges = useMemo(() => {
    const z = percentileRange(cloud.positions, 0.01, 0.99, 3, 2);
    const i = percentileRange(cloud.intensity, 0.02, 0.98);
    return { z, intensity: [i[0] / 65535, i[1] / 65535] as [number, number] };
  }, [cloud]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  const dpr = useThree((s) => s.viewport.dpr);
  const mode = colorMode ?? (cloud.colors ? 'rgb' : 'elevation');
  useLayoutEffect(() => {
    material.set({
      colorMode: mode,
      ramp,
      pointSize: pointSize * dpr,
      solidColor,
      zRange: ranges.z,
      intensityRange: ranges.intensity,
    });
  }, [material, mode, ramp, pointSize, dpr, solidColor, ranges]);

  return (
    <group rotation={zUp ? [-Math.PI / 2, 0, 0] : [0, 0, 0]} {...group}>
      <points geometry={geometry} material={material} />
    </group>
  );
}
