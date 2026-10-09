/** ASPRS LAS 1.4 standard point classes (codes 0–18); 19–63 reserved, 64–255 user defined. */
export const ASPRS_CLASSES: Readonly<Record<number, { name: string; color: string }>> = {
  0: { name: 'Created, never classified', color: '#9e9e9e' },
  1: { name: 'Unclassified', color: '#bdbdbd' },
  2: { name: 'Ground', color: '#a1734a' },
  3: { name: 'Low vegetation', color: '#9ccc65' },
  4: { name: 'Medium vegetation', color: '#43a047' },
  5: { name: 'High vegetation', color: '#1b5e20' },
  6: { name: 'Building', color: '#e53935' },
  7: { name: 'Low point (noise)', color: '#ff00ff' },
  8: { name: 'Model key-point', color: '#ffeb3b' },
  9: { name: 'Water', color: '#1e88e5' },
  10: { name: 'Rail', color: '#6d4c41' },
  11: { name: 'Road surface', color: '#616161' },
  12: { name: 'Overlap', color: '#ffb74d' },
  13: { name: 'Wire – guard (shield)', color: '#ffee58' },
  14: { name: 'Wire – conductor (phase)', color: '#fdd835' },
  15: { name: 'Transmission tower', color: '#8e24aa' },
  16: { name: 'Wire-structure connector', color: '#ce93d8' },
  17: { name: 'Bridge deck', color: '#00acc1' },
  18: { name: 'High noise', color: '#f06292' },
};

const FALLBACK = '#ffffff';

/**
 * 256-entry RGB lookup table (Uint8, 768 bytes) indexed by classification code, ready to
 * upload as a 256×1 texture.
 */
export function classificationLut(): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let code = 0; code < 256; code++) {
    const hex = ASPRS_CLASSES[code]?.color ?? FALLBACK;
    lut[code * 3] = parseInt(hex.slice(1, 3), 16);
    lut[code * 3 + 1] = parseInt(hex.slice(3, 5), 16);
    lut[code * 3 + 2] = parseInt(hex.slice(5, 7), 16);
  }
  return lut;
}
