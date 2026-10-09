export interface Shot {
  filename: string;
  x: number;
  y: number;
  z: number;
  omega: number;
  phi: number;
  kappa: number;
  camera: string;
}

type RawShotData = Record<string, Omit<Shot, 'filename'> & { filename?: string }>;

/** Flatten a `{ [filename]: shot }` map into an array of shots. */
export function parseShots(json: RawShotData): Shot[] {
  return Object.entries(json).map(([filename, shot]) => ({
    ...shot,
    filename: shot.filename || filename,
  }));
}

/** Keep every `every`-th shot. */
export function sampleShots(shots: Shot[], every = 3): Shot[] {
  return shots.filter((_, i) => i % every === 0);
}
