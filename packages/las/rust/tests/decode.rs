#![allow(clippy::needless_range_loop)]

use std::io::{Cursor, Seek, SeekFrom, Write};

use laz::{LasZipCompressor, LazItemRecordBuilder, LazVlr};
use odm_viz_las::{DecodeOptions, Error, Header, decode};

const SCALE: f64 = 0.001;
// Realistic UTM-sized offset: float32 alone would round these to ~0.5 m.
const OFFSET: [f64; 3] = [500_000.0, 4_000_000.0, 100.0];

struct Pt {
    xyz: [i32; 3],
    intensity: u16,
    class: u8,
    rgb: [u16; 3],
}

fn sample_points(n: usize) -> Vec<Pt> {
    (0..n)
        .map(|i| {
            let i = i as i32;
            Pt {
                xyz: [i * 7 - 3000, (i * 13) % 5000, (i * 3) % 997],
                intensity: (i * 31 % 65535) as u16,
                class: (i % 7) as u8 + 1,
                rgb: [(i % 256) as u16 * 257, 1000, 65535],
            }
        })
        .collect()
}

fn record_len(fmt: u8) -> usize {
    match fmt {
        0 => 20,
        3 => 34,
        7 => 36,
        _ => unreachable!(),
    }
}

fn encode_record(fmt: u8, p: &Pt) -> Vec<u8> {
    let mut r = vec![0u8; record_len(fmt)];
    for a in 0..3 {
        r[a * 4..a * 4 + 4].copy_from_slice(&p.xyz[a].to_le_bytes());
    }
    r[12..14].copy_from_slice(&p.intensity.to_le_bytes());
    let (class_at, rgb_at) = match fmt {
        0 => (15, None),
        3 => (15, Some(28)),
        7 => (16, Some(30)),
        _ => unreachable!(),
    };
    if fmt >= 6 {
        r[14] = 0x11; // return 1 of 1
    } else {
        r[14] = 0b0000_1001; // return 1 of 1
    }
    r[class_at] = p.class;
    if let Some(o) = rgb_at {
        for c in 0..3 {
            r[o + c * 2..o + c * 2 + 2].copy_from_slice(&p.rgb[c].to_le_bytes());
        }
    }
    r
}

/// Build a complete LAS (or LAZ, when `compress`) file in memory.
fn build_file(fmt: u8, pts: &[Pt], compress: bool) -> Vec<u8> {
    let len = record_len(fmt);
    let laz_vlr = compress.then(|| {
        let items = LazItemRecordBuilder::default_for_point_format_id(fmt, 0).unwrap();
        let mut v = Vec::new();
        LazVlr::from_laz_items(items).write_to(&mut v).unwrap();
        v
    });

    let header_size = 375u16; // LAS 1.4
    let vlr_bytes = laz_vlr.as_ref().map_or(0, |v| 54 + v.len());
    let mut h = vec![0u8; header_size as usize];
    h[0..4].copy_from_slice(b"LASF");
    h[24] = 1;
    h[25] = 4;
    h[94..96].copy_from_slice(&header_size.to_le_bytes());
    h[96..100].copy_from_slice(&((header_size as usize + vlr_bytes) as u32).to_le_bytes());
    h[100..104].copy_from_slice(&(laz_vlr.is_some() as u32).to_le_bytes());
    h[104] = fmt | if compress { 0x80 } else { 0 };
    h[105..107].copy_from_slice(&(len as u16).to_le_bytes());
    for a in 0..3 {
        h[131 + a * 8..139 + a * 8].copy_from_slice(&SCALE.to_le_bytes());
        h[155 + a * 8..163 + a * 8].copy_from_slice(&OFFSET[a].to_le_bytes());
        let vals = pts.iter().map(|p| p.xyz[a] as f64 * SCALE + OFFSET[a]);
        let (mn, mx) = vals.fold((f64::MAX, f64::MIN), |(lo, hi), v| (lo.min(v), hi.max(v)));
        // max x @179, min x @187, max y @195, ...
        h[179 + a * 16..187 + a * 16].copy_from_slice(&mx.to_le_bytes());
        h[187 + a * 16..195 + a * 16].copy_from_slice(&mn.to_le_bytes());
    }
    h[247..255].copy_from_slice(&(pts.len() as u64).to_le_bytes());

    let mut out = Cursor::new(Vec::new());
    out.write_all(&h).unwrap();
    if let Some(v) = &laz_vlr {
        let mut vh = vec![0u8; 54];
        vh[2..2 + 14].copy_from_slice(b"laszip encoded");
        vh[18..20].copy_from_slice(&22204u16.to_le_bytes());
        vh[20..22].copy_from_slice(&(v.len() as u16).to_le_bytes());
        out.write_all(&vh).unwrap();
        out.write_all(v).unwrap();
    }

    let raw: Vec<u8> = pts.iter().flat_map(|p| encode_record(fmt, p)).collect();
    if compress {
        let vlr = LazVlr::from_buffer(laz_vlr.as_ref().unwrap()).unwrap();
        let mut c = LasZipCompressor::new(&mut out, vlr).unwrap();
        c.compress_many(&raw).unwrap();
        c.done().unwrap();
    } else {
        out.seek(SeekFrom::End(0)).unwrap();
        out.write_all(&raw).unwrap();
    }
    out.into_inner()
}

fn check_roundtrip(fmt: u8, compress: bool) {
    let pts = sample_points(150_000); // > one decode batch and > one LAZ chunk
    let file = build_file(fmt, &pts, compress);
    let pc = decode(&file, &DecodeOptions::default(), |_, _| {}).unwrap();

    assert_eq!(pc.header.point_format, fmt);
    assert_eq!(pc.header.is_compressed(), compress);
    assert_eq!(pc.len(), pts.len());
    for (i, p) in pts.iter().enumerate().step_by(997) {
        for a in 0..3 {
            let world = p.xyz[a] as f64 * SCALE + OFFSET[a];
            let got = pc.origin[a] + pc.positions[i * 3 + a] as f64;
            assert!(
                (got - world).abs() < 1e-3,
                "fmt {fmt} pt {i} axis {a}: {got} vs {world}"
            );
        }
        assert_eq!(pc.intensity[i], p.intensity);
        assert_eq!(pc.classification[i], p.class);
        if fmt != 0 {
            let c = pc.colors.as_ref().unwrap();
            assert_eq!(
                &c[i * 3..i * 3 + 3],
                &[(p.rgb[0] >> 8) as u8, (1000 >> 8) as u8, 255]
            );
        }
    }
    assert_eq!(pc.colors.is_some(), fmt != 0);
}

#[test]
fn las_format_0() {
    check_roundtrip(0, false);
}
#[test]
fn las_format_3() {
    check_roundtrip(3, false);
}
#[test]
fn las_format_7() {
    check_roundtrip(7, false);
}
#[test]
fn laz_format_0() {
    check_roundtrip(0, true);
}
#[test]
fn laz_format_3() {
    check_roundtrip(3, true);
}
#[test]
fn laz_format_7() {
    check_roundtrip(7, true);
}

#[test]
fn stride_and_max_points() {
    let pts = sample_points(10_000);
    let file = build_file(3, &pts, true);

    let pc = decode(
        &file,
        &DecodeOptions {
            stride: 3,
            ..Default::default()
        },
        |_, _| {},
    )
    .unwrap();
    assert_eq!(pc.stride, 3);
    assert_eq!(pc.len(), 10_000usize.div_ceil(3));
    // Every kept point is record i*3.
    assert_eq!(pc.intensity[5], pts[15].intensity);

    let pc = decode(
        &file,
        &DecodeOptions {
            max_points: 1_000,
            ..Default::default()
        },
        |_, _| {},
    )
    .unwrap();
    assert_eq!(pc.stride, 10);
    assert_eq!(pc.len(), 1_000);
    assert_eq!(pc.intensity[999], pts[9_990].intensity);
}

#[test]
fn progress_reaches_total() {
    let pts = sample_points(70_000);
    let file = build_file(0, &pts, true);
    let mut last = (0, 0);
    decode(&file, &DecodeOptions::default(), |d, t| last = (d, t)).unwrap();
    assert_eq!(last, (70_000, 70_000));
}

#[test]
fn eight_bit_colors_pass_through() {
    let mut pts = sample_points(100);
    for p in &mut pts {
        p.rgb = [10, 20, 30];
    }
    let pc = decode(
        &build_file(3, &pts, false),
        &DecodeOptions::default(),
        |_, _| {},
    )
    .unwrap();
    assert_eq!(&pc.colors.unwrap()[..3], &[10, 20, 30]);
}

#[test]
fn rejects_garbage_and_truncation() {
    assert_eq!(Header::parse(b"not a las file").unwrap_err(), Error::NotLas);
    let file = build_file(0, &sample_points(1_000), false);
    let err = decode(
        &file[..file.len() - 10],
        &DecodeOptions::default(),
        |_, _| {},
    )
    .unwrap_err();
    assert_eq!(err, Error::Truncated);
    let file = build_file(0, &sample_points(1_000), true);
    assert!(
        decode(
            &file[..file.len() / 2],
            &DecodeOptions::default(),
            |_, _| {}
        )
        .is_err()
    );
}

/// Real-world check: `ODM_VIZ_SAMPLE=path/to/file.laz cargo test --release -- --ignored`
#[test]
#[ignore]
fn real_world_sample() {
    let path = std::env::var("ODM_VIZ_SAMPLE").expect("set ODM_VIZ_SAMPLE");
    let bytes = std::fs::read(path).unwrap();
    let t = std::time::Instant::now();
    let pc = decode(&bytes, &DecodeOptions::default(), |_, _| {}).unwrap();
    let h = &pc.header;
    println!(
        "LAS {}.{} fmt {} copc={} points={} decoded={} in {:?}",
        h.version.0,
        h.version.1,
        h.point_format,
        h.is_copc(),
        h.point_count,
        pc.len(),
        t.elapsed()
    );
    println!(
        "header min {:?} max {:?}\ndecoded min {:?} max {:?}",
        h.min, h.max, pc.min, pc.max
    );
    assert_eq!(pc.len() as u64, h.point_count);
    for a in 0..3 {
        assert!((pc.min[a] - h.min[a]).abs() < 1.0 && (pc.max[a] - h.max[a]).abs() < 1.0);
    }
}

/// Regenerates the JS test fixtures: `cargo test -- --ignored write_js_fixtures`
#[test]
#[ignore]
fn write_js_fixtures() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../test/fixtures");
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(
        format!("{dir}/fmt3.laz"),
        build_file(3, &sample_points(5_000), true),
    )
    .unwrap();
    std::fs::write(
        format!("{dir}/fmt0.las"),
        build_file(0, &sample_points(2_000), false),
    )
    .unwrap();
}
