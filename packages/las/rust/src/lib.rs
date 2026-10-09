//! LAS/LAZ decoding for odm-viz.
//!
//! The core is plain Rust (tested natively with `cargo test`); `wasm.rs` exposes it to
//! JavaScript through wasm-bindgen when compiled for `wasm32`.

pub mod decode;
pub mod header;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use decode::{DecodeOptions, PointCloud, decode};
pub use header::Header;

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    NotLas,
    Truncated,
    UnsupportedPointFormat(u8),
    Laz(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::NotLas => write!(f, "not a LAS/LAZ file (missing LASF signature)"),
            Error::Truncated => write!(f, "file is truncated"),
            Error::UnsupportedPointFormat(p) => write!(f, "unsupported point format {p}"),
            Error::Laz(e) => write!(f, "LAZ decompression failed: {e}"),
        }
    }
}

impl std::error::Error for Error {}
