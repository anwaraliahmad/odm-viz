//! wasm-bindgen surface. Every typed-array getter returns a fresh copy owned by JS, so
//! the buffers can be transferred out of a worker without touching wasm memory again.

use js_sys::{Float32Array, Float64Array, Function, Uint8Array, Uint16Array};
use wasm_bindgen::prelude::*;

use crate::decode::{DecodeOptions, PointCloud};
use crate::header::Header;

#[wasm_bindgen(js_name = LasHeader)]
pub struct JsHeader(Header);

#[wasm_bindgen(js_class = LasHeader)]
impl JsHeader {
    #[wasm_bindgen(getter)]
    pub fn version(&self) -> String {
        format!("{}.{}", self.0.version.0, self.0.version.1)
    }
    #[wasm_bindgen(getter, js_name = pointFormat)]
    pub fn point_format(&self) -> u8 {
        self.0.point_format
    }
    /// Total points in the file (f64 so counts above 2^32 survive the trip to JS).
    #[wasm_bindgen(getter, js_name = pointCount)]
    pub fn point_count(&self) -> f64 {
        self.0.point_count as f64
    }
    #[wasm_bindgen(getter, js_name = isCompressed)]
    pub fn is_compressed(&self) -> bool {
        self.0.is_compressed()
    }
    #[wasm_bindgen(getter, js_name = isCopc)]
    pub fn is_copc(&self) -> bool {
        self.0.is_copc()
    }
    #[wasm_bindgen(getter, js_name = hasColor)]
    pub fn has_color(&self) -> bool {
        self.0.layout().rgb.is_some()
    }
    #[wasm_bindgen(getter)]
    pub fn scale(&self) -> Float64Array {
        Float64Array::from(&self.0.scale[..])
    }
    #[wasm_bindgen(getter)]
    pub fn offset(&self) -> Float64Array {
        Float64Array::from(&self.0.offset[..])
    }
    /// [minX, minY, minZ, maxX, maxY, maxZ] as stored in the header.
    #[wasm_bindgen(getter)]
    pub fn bounds(&self) -> Float64Array {
        bounds(&self.0.min, &self.0.max)
    }
}

#[wasm_bindgen(js_name = PointCloud)]
pub struct JsPointCloud(PointCloud);

#[wasm_bindgen(js_class = PointCloud)]
impl JsPointCloud {
    #[wasm_bindgen(getter)]
    pub fn header(&self) -> JsHeader {
        JsHeader(self.0.header.clone())
    }
    #[wasm_bindgen(getter, js_name = pointCount)]
    pub fn point_count(&self) -> u32 {
        self.0.len() as u32
    }
    #[wasm_bindgen(getter)]
    pub fn stride(&self) -> u32 {
        self.0.stride
    }
    #[wasm_bindgen(getter)]
    pub fn origin(&self) -> Float64Array {
        Float64Array::from(&self.0.origin[..])
    }
    /// [minX, minY, minZ, maxX, maxY, maxZ] of the decoded points, world coordinates.
    #[wasm_bindgen(getter)]
    pub fn bounds(&self) -> Float64Array {
        bounds(&self.0.min, &self.0.max)
    }
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Float32Array {
        Float32Array::from(&self.0.positions[..])
    }
    #[wasm_bindgen(getter)]
    pub fn colors(&self) -> Option<Uint8Array> {
        self.0.colors.as_deref().map(Uint8Array::from)
    }
    #[wasm_bindgen(getter)]
    pub fn intensity(&self) -> Uint16Array {
        Uint16Array::from(&self.0.intensity[..])
    }
    #[wasm_bindgen(getter)]
    pub fn classification(&self) -> Uint8Array {
        Uint8Array::from(&self.0.classification[..])
    }
}

fn bounds(min: &[f64; 3], max: &[f64; 3]) -> Float64Array {
    Float64Array::from(&[min[0], min[1], min[2], max[0], max[1], max[2]][..])
}

/// Parse only the header and VLRs. Needs the first `pointDataOffset` bytes at most.
#[wasm_bindgen(js_name = readHeader)]
pub fn read_header(bytes: &[u8]) -> Result<JsHeader, JsError> {
    Header::parse(bytes)
        .map(JsHeader)
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Decode a whole LAS/LAZ file. `on_progress(done, total)` is called once per batch.
#[wasm_bindgen]
pub fn decode(
    bytes: &[u8],
    stride: u32,
    max_points: f64,
    colors: bool,
    on_progress: Option<Function>,
) -> Result<JsPointCloud, JsError> {
    let opts = DecodeOptions {
        stride,
        max_points: max_points.max(0.0) as u64,
        colors,
    };
    let progress = |done: u64, total: u64| {
        if let Some(f) = &on_progress {
            let _ = f.call2(
                &JsValue::NULL,
                &(done as f64).into(),
                &(total as f64).into(),
            );
        }
    };
    crate::decode(bytes, &opts, progress)
        .map(JsPointCloud)
        .map_err(|e| JsError::new(&e.to_string()))
}
