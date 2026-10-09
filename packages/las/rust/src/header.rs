//! LAS public header + VLR parsing (LAS 1.0 – 1.4).
//!
//! Only the fields the viewer needs are read. Offsets follow the ASPRS LAS 1.4 R15 spec.

use crate::Error;

pub const LASZIP_USER_ID: &str = "laszip encoded";
pub const LASZIP_RECORD_ID: u16 = 22204;
pub const COPC_USER_ID: &str = "copc";

#[derive(Debug, Clone, PartialEq)]
pub struct Vlr {
    pub user_id: String,
    pub record_id: u16,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Header {
    pub version: (u8, u8),
    pub header_size: u16,
    pub point_data_offset: u32,
    /// Point data record format (0–10), with the LAZ compression bits stripped.
    pub point_format: u8,
    pub point_record_length: u16,
    pub point_count: u64,
    pub scale: [f64; 3],
    pub offset: [f64; 3],
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub vlrs: Vec<Vlr>,
}

impl Header {
    pub fn parse(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.len() < 227 || &bytes[0..4] != b"LASF" {
            return Err(Error::NotLas);
        }
        let r = Reader(bytes);
        let version = (r.u8(24), r.u8(25));
        let header_size = r.u16(94);
        let point_data_offset = r.u32(96);
        let vlr_count = r.u32(100);
        let point_format = r.u8(104) & 0x3F;
        let point_record_length = r.u16(105);
        let legacy_count = r.u32(107) as u64;

        let f64x3 = |o: usize| [r.f64(o), r.f64(o + 8), r.f64(o + 16)];
        let scale = f64x3(131);
        let offset = f64x3(155);
        // Bounds are stored interleaved: max x, min x, max y, min y, max z, min z.
        let max = [r.f64(179), r.f64(195), r.f64(211)];
        let min = [r.f64(187), r.f64(203), r.f64(219)];

        // LAS 1.4 moved the point count to a 64-bit field; the legacy one may be 0.
        let point_count = if version >= (1, 4) && bytes.len() >= 255 && header_size >= 255 {
            let c = r.u64(247);
            if c > 0 { c } else { legacy_count }
        } else {
            legacy_count
        };

        if point_format > 10 {
            return Err(Error::UnsupportedPointFormat(point_format));
        }
        if (point_data_offset as usize) > bytes.len() {
            return Err(Error::Truncated);
        }

        let mut vlrs = Vec::with_capacity(vlr_count as usize);
        let mut pos = header_size as usize;
        for _ in 0..vlr_count {
            if pos + 54 > bytes.len() {
                return Err(Error::Truncated);
            }
            let user_id = cstr(&bytes[pos + 2..pos + 18]);
            let record_id = r.u16(pos + 18);
            let len = r.u16(pos + 20) as usize;
            let start = pos + 54;
            let end = start + len;
            if end > bytes.len() {
                return Err(Error::Truncated);
            }
            vlrs.push(Vlr {
                user_id,
                record_id,
                data: bytes[start..end].to_vec(),
            });
            pos = end;
        }

        Ok(Header {
            version,
            header_size,
            point_data_offset,
            point_format,
            point_record_length,
            point_count,
            scale,
            offset,
            min,
            max,
            vlrs,
        })
    }

    pub fn find_vlr(&self, user_id: &str, record_id: u16) -> Option<&Vlr> {
        self.vlrs
            .iter()
            .find(|v| v.user_id == user_id && v.record_id == record_id)
    }

    pub fn laszip_vlr(&self) -> Option<&Vlr> {
        self.find_vlr(LASZIP_USER_ID, LASZIP_RECORD_ID)
    }

    pub fn is_compressed(&self) -> bool {
        self.laszip_vlr().is_some()
    }

    /// COPC files carry a `copc`/1 info VLR as the first VLR.
    pub fn is_copc(&self) -> bool {
        self.find_vlr(COPC_USER_ID, 1).is_some()
    }

    pub fn layout(&self) -> PointLayout {
        PointLayout::for_format(self.point_format)
    }
}

/// Byte offsets of the attributes we decode, within one point record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PointLayout {
    pub classification: usize,
    /// For formats 0–5 only the low 5 bits are the class.
    pub classification_mask: u8,
    pub rgb: Option<usize>,
}

impl PointLayout {
    pub fn for_format(format: u8) -> Self {
        let legacy = format <= 5;
        let rgb = match format {
            2 => Some(20),
            3 | 5 => Some(28),
            7 | 8 | 10 => Some(30),
            _ => None,
        };
        PointLayout {
            classification: if legacy { 15 } else { 16 },
            classification_mask: if legacy { 0x1F } else { 0xFF },
            rgb,
        }
    }
}

fn cstr(b: &[u8]) -> String {
    let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    String::from_utf8_lossy(&b[..end]).into_owned()
}

struct Reader<'a>(&'a [u8]);

impl Reader<'_> {
    fn u8(&self, o: usize) -> u8 {
        self.0[o]
    }
    fn u16(&self, o: usize) -> u16 {
        u16::from_le_bytes([self.0[o], self.0[o + 1]])
    }
    fn u32(&self, o: usize) -> u32 {
        u32::from_le_bytes(self.0[o..o + 4].try_into().unwrap())
    }
    fn u64(&self, o: usize) -> u64 {
        u64::from_le_bytes(self.0[o..o + 8].try_into().unwrap())
    }
    fn f64(&self, o: usize) -> f64 {
        f64::from_le_bytes(self.0[o..o + 8].try_into().unwrap())
    }
}
