/// Generates a synthetic "AI pixel art" test image:
/// A small 8x8 pixel art sprite upscaled 4x to 32x32,
/// with anti-aliasing noise injected at block boundaries
/// to simulate what AI generates.
use image::{Rgba, RgbaImage};

fn main() {
    let scale = 4u32;
    let small_w = 8u32;
    let small_h = 8u32;
    let big_w = small_w * scale;
    let big_h = small_h * scale;

    // Define a small sprite (simple face)
    let bg = Rgba([40, 40, 60, 255]); // dark blue-gray background
    let skin = Rgba([255, 200, 150, 255]); // skin tone
    let eye = Rgba([30, 30, 80, 255]); // dark eye color
    let mouth = Rgba([200, 80, 80, 255]); // red mouth
    let hair = Rgba([100, 60, 30, 255]); // brown hair

    // 8x8 sprite layout
    #[rustfmt::skip]
    let sprite: [[Rgba<u8>; 8]; 8] = [
        [bg,   bg,   hair, hair, hair, hair, bg,   bg  ],
        [bg,   hair, hair, hair, hair, hair, hair, bg  ],
        [bg,   hair, skin, skin, skin, skin, hair, bg  ],
        [bg,   skin, eye,  skin, skin, eye,  skin, bg  ],
        [bg,   skin, skin, skin, skin, skin, skin, bg  ],
        [bg,   skin, skin, mouth,mouth,skin, skin, bg  ],
        [bg,   bg,   skin, skin, skin, skin, bg,   bg  ],
        [bg,   bg,   bg,   skin, skin, bg,   bg,   bg  ],
    ];

    let mut img = RgbaImage::new(big_w, big_h);

    // Upscale with perfect blocks
    for sy in 0..small_h {
        for sx in 0..small_w {
            let color = sprite[sy as usize][sx as usize];
            for dy in 0..scale {
                for dx in 0..scale {
                    img.put_pixel(sx * scale + dx, sy * scale + dy, color);
                }
            }
        }
    }

    // Inject AI-style artifacts: anti-aliasing at some block boundaries
    for sy in 0..small_h - 1 {
        for sx in 0..small_w {
            let c1 = sprite[sy as usize][sx as usize];
            let c2 = sprite[(sy + 1) as usize][sx as usize];
            if c1 != c2 {
                // Blend at the boundary
                let blend = Rgba([
                    ((c1[0] as u16 + c2[0] as u16) / 2) as u8,
                    ((c1[1] as u16 + c2[1] as u16) / 2) as u8,
                    ((c1[2] as u16 + c2[2] as u16) / 2) as u8,
                    255,
                ]);
                // Set the last row of the top block and first row of bottom block
                let boundary_y = (sy + 1) * scale;
                for dx in 0..scale {
                    img.put_pixel(sx * scale + dx, boundary_y - 1, blend);
                    img.put_pixel(sx * scale + dx, boundary_y, blend);
                }
            }
        }
    }

    // Also inject horizontal boundary artifacts
    for sy in 0..small_h {
        for sx in 0..small_w - 1 {
            let c1 = sprite[sy as usize][sx as usize];
            let c2 = sprite[sy as usize][(sx + 1) as usize];
            if c1 != c2 {
                let blend = Rgba([
                    ((c1[0] as u16 + c2[0] as u16) / 2) as u8,
                    ((c1[1] as u16 + c2[1] as u16) / 2) as u8,
                    ((c1[2] as u16 + c2[2] as u16) / 2) as u8,
                    255,
                ]);
                let boundary_x = (sx + 1) * scale;
                for dy in 0..scale {
                    img.put_pixel(boundary_x - 1, sy * scale + dy, blend);
                    img.put_pixel(boundary_x, sy * scale + dy, blend);
                }
            }
        }
    }

    img.save("test_images/synthetic_ai_sprite.png").unwrap();
    println!("Generated test_images/synthetic_ai_sprite.png ({}x{})", big_w, big_h);

    // Also save the "ground truth" clean version
    let mut clean = RgbaImage::new(small_w, small_h);
    for sy in 0..small_h {
        for sx in 0..small_w {
            clean.put_pixel(sx, sy, sprite[sy as usize][sx as usize]);
        }
    }
    clean.save("test_images/ground_truth.png").unwrap();
    println!("Generated test_images/ground_truth.png ({}x{})", small_w, small_h);
}
