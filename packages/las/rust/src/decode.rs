//! Decode LAS/LAZ point records into GPU-friendly struct-of-arrays buffers.

use std::io::{Cursor, Seek, SeekFrom};

use laz::{DecompressionSelection, LasZipDecompressor, LazVlr};

use crate::Error;
use crate::header::{Header, PointLayout};

/// Points are decompressed in batches of this many records.
const BATCH: usize = 1 << 16;

#[derive(Debug, Clone, Copy)]
pub struct DecodeOptions {
    /// Keep every `stride`-th point (1 = all).
    pub stride: u32,
    /// Upper bound on kept points; raises the stride when needed. 0 = unlimited.
    pub max_points: u64,
    /// Decode RGB when the point format has it.
    pub colors: bool,
}

impl Default for DecodeOptions {
    fn default() -> Self {
        DecodeOptions {
            stride: 1,
            max_points: 0,
            colors: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PointCloud {
    pub header: Header,
    /// World-space origin that `positions` are relative to. Real-world coordinates
    /// (UTM, state plane…) don't fit in float32, so they are re-centred in f64 first.
    pub origin: [f64; 3],
    /// xyz triplets relative to `origin`.
    pub positions: Vec<f32>,
    /// 8-bit rgb triplets, if present and requested.
    pub colors: Option<Vec<u8>>,
    pub intensity: Vec<u16>,
    pub classification: Vec<u8>,
    /// Actual bounds of the decoded points, in world coordinates.
    pub min: [f64; 3],
    pub max: [f64; 3],
    /// Stride actually applied (after honouring `max_points`).
    pub stride: u32,
}

impl PointCloud {
    pub fn len(&self) -> usize {
        self.positions.len() / 3
    }

    pub fn is_empty(&self) -> bool {
        self.positions.is_empty()
    }
}

pub fn effective_stride(point_count: u64, opts: &DecodeOptions) -> u32 {
    let mut stride = opts.stride.max(1) as u64;
    if opts.max_points > 0 {
        stride = stride.max(point_count.div_ceil(opts.max_points));
    }
    stride.min(u32::MAX as u64) as u32
}

pub fn decode(
    bytes: &[u8],
    opts: &DecodeOptions,
    mut progress: impl FnMut(u64, u64),
) -> Result<PointCloud, Error> {
    let header = Header::parse(bytes)?;
    let layout = header.layout();
    let total = header.point_count;
    let stride = effective_stride(total, opts);
    let kept = total.div_ceil(stride as u64);
    let kept = if opts.max_points > 0 {
        kept.min(opts.max_points)
    } else {
        kept
    } as usize;
    let want_rgb = opts.colors && layout.rgb.is_some();

    let origin = pick_origin(&header);
    let mut sink = Sink {
        header: &header,
        layout,
        origin,
        stride: stride as u64,
        kept_limit: kept,
        positions: Vec::with_capacity(kept * 3),
        rgb16: if want_rgb {
            Vec::with_capacity(kept * 3)
        } else {
            Vec::new()
        },
        intensity: Vec::with_capacity(kept),
        classification: Vec::with_capacity(kept),
        min: [f64::INFINITY; 3],
        max: [f64::NEG_INFINITY; 3],
        want_rgb,
    };

    match header.laszip_vlr() {
        Some(vlr) => decode_laz(bytes, &header, &vlr.data, &mut sink, &mut progress)?,
        None => decode_las(bytes, &header, &mut sink, &mut progress)?,
    }

    let colors = want_rgb.then(|| to_8bit(&sink.rgb16));
    let (min, max) = if sink.intensity.is_empty() {
        (header.min, header.max)
    } else {
        (sink.min, sink.max)
    };

    Ok(PointCloud {
        origin,
        positions: sink.positions,
        colors,
        intensity: sink.intensity,
        classification: sink.classification,
        min,
        max,
        stride,
        header,
    })
}

fn decode_las(
    bytes: &[u8],
    header: &Header,
    sink: &mut Sink,
    progress: &mut impl FnMut(u64, u64),
) -> Result<(), Error> {
    let len = header.point_record_length as usize;
    let start = header.point_data_offset as usize;
    let end = start + len * header.point_count as usize;
    let data = bytes.get(start..end).ok_or(Error::Truncated)?;

    for (b, batch) in data.chunks(BATCH * len).enumerate() {
        let first = (b * BATCH) as u64;
        sink.push_batch(first, batch, len);
        progress(
            (first + (batch.len() / len) as u64).min(header.point_count),
            header.point_count,
        );
        if sink.full() {
            break;
        }
    }
    Ok(())
}

fn decode_laz(
    bytes: &[u8],
    header: &Header,
    vlr_data: &[u8],
    sink: &mut Sink,
    progress: &mut impl FnMut(u64, u64),
) -> Result<(), Error> {
    let vlr = LazVlr::from_buffer(vlr_data).map_err(|e| Error::Laz(e.to_string()))?;
    let len = vlr.items_size() as usize;

    let mut src = Cursor::new(bytes);
    src.seek(SeekFrom::Start(header.point_data_offset as u64))
        .map_err(|e| Error::Laz(e.to_string()))?;

    // Formats 6–10 are layered: skipping layers we never read saves real work.
    let mut sel = DecompressionSelection::XY_RETURNS_CHANNEL
        | DecompressionSelection::Z
        | DecompressionSelection::CLASSIFICATION
        | DecompressionSelection::INTENSITY;
    if sink.want_rgb {
        sel |= DecompressionSelection::RGB;
    }
    let mut dec = LasZipDecompressor::selective(src, vlr, DecompressionSelection(sel))
        .map_err(|e| Error::Laz(e.to_string()))?;

    let total = header.point_count;
    let mut buf = vec![0u8; BATCH * len];
    let mut done = 0u64;
    while done < total && !sink.full() {
        let n = (total - done).min(BATCH as u64) as usize;
        let chunk = &mut buf[..n * len];
        dec.decompress_many(chunk)
            .map_err(|e| Error::Laz(e.to_string()))?;
        sink.push_batch(done, chunk, len);
        done += n as u64;
        progress(done, total);
    }
    Ok(())
}

struct Sink<'h> {
    header: &'h Header,
    layout: PointLayout,
    origin: [f64; 3],
    stride: u64,
    kept_limit: usize,
    positions: Vec<f32>,
    rgb16: Vec<u16>,
    intensity: Vec<u16>,
    classification: Vec<u8>,
    min: [f64; 3],
    max: [f64; 3],
    want_rgb: bool,
}

impl Sink<'_> {
    fn full(&self) -> bool {
        self.intensity.len() >= self.kept_limit
    }

    /// `first` is the global index of the first record in `batch`.
    fn push_batch(&mut self, first: u64, batch: &[u8], len: usize) {
        let h = self.header;
        // Index (within this batch) of the first record that falls on the stride.
        let skip = ((self.stride - first % self.stride) % self.stride) as usize;
        let step = self.stride as usize;
        for rec in batch.chunks_exact(len).skip(skip).step_by(step) {
            if self.full() {
                return;
            }
            for a in 0..3 {
                let raw = i32::from_le_bytes(rec[a * 4..a * 4 + 4].try_into().unwrap());
                let world = raw as f64 * h.scale[a] + h.offset[a];
                self.min[a] = self.min[a].min(world);
                self.max[a] = self.max[a].max(world);
                self.positions.push((world - self.origin[a]) as f32);
            }
            self.intensity.push(u16::from_le_bytes([rec[12], rec[13]]));
            self.classification
                .push(rec[self.layout.classification] & self.layout.classification_mask);
            if self.want_rgb {
                let o = self.layout.rgb.unwrap();
                for c in 0..3 {
                    self.rgb16
                        .push(u16::from_le_bytes([rec[o + c * 2], rec[o + c * 2 + 1]]));
                }
            }
        }
    }
}

/// Centre of the header bounding box, falling back to the coordinate offset when the
/// header bounds are missing or nonsensical.
fn pick_origin(h: &Header) -> [f64; 3] {
    let valid =
        (0..3).all(|a| h.min[a].is_finite() && h.max[a].is_finite() && h.min[a] <= h.max[a]);
    if valid {
        [0, 1, 2].map(|a| ((h.min[a] + h.max[a]) * 0.5).round())
    } else {
        h.offset
    }
}

/// LAS says colours are 16-bit, but plenty of writers store 8-bit values unscaled.
/// If nothing exceeds 255 treat them as 8-bit, otherwise take the high byte.
pub fn to_8bit(rgb16: &[u16]) -> Vec<u8> {
    let is_16bit = rgb16.iter().any(|&v| v > 255);
    if is_16bit {
        rgb16.iter().map(|&v| (v >> 8) as u8).collect()
    } else {
        rgb16.iter().map(|&v| v as u8).collect()
    }
}
