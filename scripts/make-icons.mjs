// Draws the Rent Roll app icons: cyan line work on the navy sheet, the same
// gable elevation the app draws. Run with:  npm run icons
//
// No dependencies — the PNGs are encoded here with node's own zlib. Shapes
// are drawn at 4x and box-downsampled, which is enough anti-aliasing to keep
// the roof line clean at 48px.
//
// Output (public/icons/):
//   icon-192.png, icon-512.png                    purpose "any"
//   icon-192-maskable.png, icon-512-maskable.png  purpose "maskable" (the
//                                                 drawing pulled into the
//                                                 safe circle)
//   apple-touch-icon.png (180)                    iOS Add to Home Screen

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const SS = 4 // supersampling factor

// The theme, straight from src/index.css
const SHEET = [0x08, 0x20, 0x2e]
const LINE = [0x5f, 0xb6, 0xd0]
const INK = [0xa8, 0xe8, 0xf5]

// ---------------------------------------------------------------------------
// a tiny canvas
// ---------------------------------------------------------------------------

function canvas(size) {
  const px = new Uint8ClampedArray(size * size * 4)
  return {
    size,
    px,
    fill(rgb) {
      for (let i = 0; i < px.length; i += 4) {
        px[i] = rgb[0]
        px[i + 1] = rgb[1]
        px[i + 2] = rgb[2]
        px[i + 3] = 255
      }
    },
    /** Blend one pixel. `a` is 0..1. */
    dot(x, y, rgb, a = 1) {
      if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return
      const i = (y * size + x) * 4
      px[i] = px[i] + (rgb[0] - px[i]) * a
      px[i + 1] = px[i + 1] + (rgb[1] - px[i + 1]) * a
      px[i + 2] = px[i + 2] + (rgb[2] - px[i + 2]) * a
      px[i + 3] = 255
    },
    rect(x0, y0, x1, y1, rgb, a = 1) {
      for (let y = Math.round(y0); y < Math.round(y1); y++) {
        for (let x = Math.round(x0); x < Math.round(x1); x++) this.dot(x, y, rgb, a)
      }
    },
    /** A stroked segment of width w, round-capped enough for this. */
    line(x0, y0, x1, y1, w, rgb, a = 1) {
      const half = w / 2
      const minX = Math.floor(Math.min(x0, x1) - half - 1)
      const maxX = Math.ceil(Math.max(x0, x1) + half + 1)
      const minY = Math.floor(Math.min(y0, y1) - half - 1)
      const maxY = Math.ceil(Math.max(y0, y1) + half + 1)
      const dx = x1 - x0
      const dy = y1 - y0
      const len2 = dx * dx + dy * dy || 1
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2))
          const px2 = x0 + t * dx
          const py2 = y0 + t * dy
          const d = Math.hypot(x - px2, y - py2)
          if (d <= half) this.dot(x, y, rgb, a)
        }
      }
    },
  }
}

/** Average SS x SS blocks down to the final size: cheap anti-aliasing. */
function downsample(big, size) {
  const out = canvas(size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * big.size + (x * SS + sx)) * 4
          r += big.px[i]
          g += big.px[i + 1]
          b += big.px[i + 2]
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      out.px[i] = r / n
      out.px[i + 1] = g / n
      out.px[i + 2] = b / n
      out.px[i + 3] = 255
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// the drawing: a gable elevation on a drafting grid
// ---------------------------------------------------------------------------

/**
 * `inset` is how much of the canvas the drawing keeps (1 = edge to edge).
 * A maskable icon uses a smaller one so the building survives a circular
 * mask; every icon is full-bleed navy, never transparent.
 */
function drawIcon(size, inset) {
  const big = canvas(size * SS)
  const S = size * SS
  big.fill(SHEET)

  // drafting grid, faint
  const step = S / 8
  for (let i = 1; i < 8; i++) {
    big.line(i * step, 0, i * step, S, Math.max(1, S * 0.004), LINE, 0.12)
    big.line(0, i * step, S, i * step, Math.max(1, S * 0.004), LINE, 0.12)
  }

  // the elevation, in a centred box of `inset` of the canvas
  const box = S * inset
  const ox = (S - box) / 2
  const oy = (S - box) / 2
  const X = (u) => ox + u * box
  const Y = (v) => oy + v * box

  const wall = box * 0.055 // outline
  const inner = box * 0.038 // floor line, opening
  const grade = box * 0.075 // the ground, heaviest line

  // roof: apex and two eaves, drawn wider than the body
  big.line(X(0.06), Y(0.42), X(0.5), Y(0.06), wall, LINE)
  big.line(X(0.5), Y(0.06), X(0.94), Y(0.42), wall, LINE)

  // body: two walls and the floor line between them
  big.line(X(0.16), Y(0.42), X(0.16), Y(0.88), wall, LINE)
  big.line(X(0.84), Y(0.42), X(0.84), Y(0.88), wall, LINE)
  big.line(X(0.16), Y(0.42), X(0.84), Y(0.42), wall, LINE)
  big.line(X(0.16), Y(0.65), X(0.84), Y(0.65), inner, LINE)

  // one lit unit, upper left: the rent box on the drawing
  big.rect(X(0.24), Y(0.48), X(0.46), Y(0.6), INK, 0.85)

  // an opening below it
  big.line(X(0.44), Y(0.7), X(0.44), Y(0.88), inner, LINE)
  big.line(X(0.44), Y(0.7), X(0.62), Y(0.7), inner, LINE)
  big.line(X(0.62), Y(0.7), X(0.62), Y(0.88), inner, LINE)

  // grade line across the sheet
  big.line(X(0.02), Y(0.88), X(0.98), Y(0.88), grade, LINE)

  return downsample(big, size)
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(c) {
  const { size, px } = c
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(px.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------

const ICONS = [
  ['icon-192.png', 192, 0.86],
  ['icon-512.png', 512, 0.86],
  // maskable: everything important inside the middle 80% circle
  ['icon-192-maskable.png', 192, 0.6],
  ['icon-512-maskable.png', 512, 0.6],
  ['apple-touch-icon.png', 180, 0.82],
]

mkdirSync(OUT, { recursive: true })
for (const [name, size, inset] of ICONS) {
  const png = encodePNG(drawIcon(size, inset))
  writeFileSync(join(OUT, name), png)
  console.log(`${name.padEnd(24)} ${size}px  ${(png.length / 1024).toFixed(1)} KB`)
}
