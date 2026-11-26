/**
 * BLP2, WoW's texture format, decoded to RGBA (project-owned). The header
 * and the DXT choice follow wow.export's `blp.js` (MIT, Kruithne/wow.export
 * at 81cc25e4); the BC1/BC2/BC3 block decoders are the public S3TC
 * formulas.
 *
 * Only one mipmap is decoded: the smallest one at least as large as asked,
 * so a 36 px slot decodes the 64 px level and a 16 px one the 16 px level.
 * The file is data: every offset is checked and a malformed file decodes
 * to null.
 */

const MAGIC = 0x32504c42; // "BLP2"
const HEADER = 148;
const PALETTE = 256 * 4;

export interface Rgba {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  pixels: Uint8Array;
}

/** The mipmap of `blp` best for showing it `size` px wide, as RGBA, or null. */
export function decodeBlp(blp: Uint8Array, size: number): Rgba | null {
  if (blp.length < HEADER) return null;
  const view = new DataView(blp.buffer, blp.byteOffset, blp.byteLength);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 1) return null;
  const encoding = blp[8]!;
  const alphaDepth = blp[9]!;
  const alphaType = blp[10]!;
  const hasMips = blp[11]! !== 0;
  const width = view.getUint32(12, true);
  const height = view.getUint32(16, true);
  if (width < 1 || height < 1 || width > 4096 || height > 4096) return null;

  // Halve while the next level is still large enough and present.
  let level = 0;
  while (hasMips && level < 15) {
    const next = level + 1;
    if (Math.max(width >> next, height >> next) < Math.max(1, size)) break;
    if (view.getUint32(20 + next * 4, true) === 0 || view.getUint32(84 + next * 4, true) === 0) break;
    level = next;
  }
  const offset = view.getUint32(20 + level * 4, true);
  const length = view.getUint32(84 + level * 4, true);
  if (offset < HEADER || offset + length > blp.length) return null;
  const data = blp.subarray(offset, offset + length);
  const w = Math.max(1, width >> level);
  const h = Math.max(1, height >> level);

  let pixels: Uint8Array | null = null;
  if (encoding === 1) {
    if (blp.length < HEADER + PALETTE) return null;
    pixels = paletted(data, blp.subarray(HEADER, HEADER + PALETTE), w, h, alphaDepth);
  } else if (encoding === 2) {
    pixels = alphaDepth === 0 ? blocks(data, w, h, 8, bc1Opaque)
      : alphaDepth === 1 ? blocks(data, w, h, 8, bc1)
        : blocks(data, w, h, 16, alphaType === 7 ? bc3 : bc2);
  } else if (encoding === 3) {
    if (data.length < w * h * 4) return null;
    pixels = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h * 4; i += 4) {
      pixels[i] = data[i + 2]!;
      pixels[i + 1] = data[i + 1]!;
      pixels[i + 2] = data[i]!;
      pixels[i + 3] = data[i + 3]!;
    }
  }
  return pixels ? { width: w, height: h, pixels } : null;
}

/** Palette indices (BGRA entries), then the alpha plane at 0, 1, 4 or 8 bits. */
function paletted(data: Uint8Array, palette: Uint8Array, w: number, h: number, alphaDepth: number): Uint8Array | null {
  const count = w * h;
  if (![0, 1, 4, 8].includes(alphaDepth) || data.length < count + Math.ceil((count * alphaDepth) / 8)) return null;
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const p = data[i]! * 4;
    out[i * 4] = palette[p + 2]!;
    out[i * 4 + 1] = palette[p + 1]!;
    out[i * 4 + 2] = palette[p]!;
    let alpha = 255;
    if (alphaDepth === 1) alpha = (data[count + (i >> 3)]! >> (i & 7)) & 1 ? 255 : 0;
    else if (alphaDepth === 4) alpha = ((data[count + (i >> 1)]! >> ((i & 1) * 4)) & 0xf) * 17;
    else if (alphaDepth === 8) alpha = data[count + i]!;
    out[i * 4 + 3] = alpha;
  }
  return out;
}

/** One 4×4 block's 16 RGBA pixels. */
type BlockDecoder = (data: Uint8Array, at: number, out: Uint8Array) => void;

/** Decode S3TC blocks of `blockBytes` each, clipping the edge blocks of a small mip. */
function blocks(data: Uint8Array, w: number, h: number, blockBytes: number, decode: BlockDecoder): Uint8Array | null {
  const across = Math.ceil(w / 4);
  const down = Math.ceil(h / 4);
  if (data.length < across * down * blockBytes) return null;
  const out = new Uint8Array(w * h * 4);
  const block = new Uint8Array(64);
  for (let by = 0; by < down; by++) {
    for (let bx = 0; bx < across; bx++) {
      decode(data, (by * across + bx) * blockBytes, block);
      for (let y = 0; y < 4 && by * 4 + y < h; y++) {
        const rowStart = ((by * 4 + y) * w + bx * 4) * 4;
        const columns = Math.min(4, w - bx * 4);
        out.set(block.subarray(y * 16, y * 16 + columns * 4), rowStart);
      }
    }
  }
  return out;
}

const palette4 = new Uint8Array(16);

/**
 * The BC1 colour block at `at` into `out`. `dxt1` allows its three-colour
 * mode (c0 ≤ c1), where index 3 is black, and transparent when
 * `writeAlpha`; otherwise the alpha already in `out` stays.
 */
function colours(data: Uint8Array, at: number, out: Uint8Array, dxt1: boolean, writeAlpha: boolean): void {
  const c0 = data[at]! | (data[at + 1]! << 8);
  const c1 = data[at + 2]! | (data[at + 3]! << 8);
  rgb565(c0, palette4, 0);
  rgb565(c1, palette4, 4);
  const fourColour = !dxt1 || c0 > c1;
  for (let k = 0; k < 3; k++) {
    const a = palette4[k]!;
    const b = palette4[4 + k]!;
    if (fourColour) {
      palette4[8 + k] = (2 * a + b + 1) / 3;
      palette4[12 + k] = (a + 2 * b + 1) / 3;
    } else {
      palette4[8 + k] = (a + b) >> 1;
      palette4[12 + k] = 0;
    }
  }
  palette4[3] = palette4[7] = palette4[11] = 255;
  palette4[15] = fourColour ? 255 : 0;
  const bits = (data[at + 4]! | (data[at + 5]! << 8) | (data[at + 6]! << 16) | (data[at + 7]! << 24)) >>> 0;
  for (let i = 0; i < 16; i++) {
    const p = ((bits >>> (i * 2)) & 3) * 4;
    out[i * 4] = palette4[p]!;
    out[i * 4 + 1] = palette4[p + 1]!;
    out[i * 4 + 2] = palette4[p + 2]!;
    if (writeAlpha) out[i * 4 + 3] = palette4[p + 3]!;
  }
}

function rgb565(c: number, out: Uint8Array, at: number): void {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  out[at] = (r << 3) | (r >> 2);
  out[at + 1] = (g << 2) | (g >> 4);
  out[at + 2] = (b << 3) | (b >> 2);
}

/** DXT1 with 1-bit alpha: index 3 is transparent when c0 ≤ c1. */
const bc1: BlockDecoder = (data, at, out) => colours(data, at, out, true, true);
/** DXT1 in a texture without alpha: every pixel opaque. */
const bc1Opaque: BlockDecoder = (data, at, out) => {
  colours(data, at, out, true, false);
  for (let i = 3; i < 64; i += 4) out[i] = 255;
};

/** DXT3: 4-bit explicit alpha, then a colour block. */
const bc2: BlockDecoder = (data, at, out) => {
  for (let i = 0; i < 16; i++) out[i * 4 + 3] = ((data[at + (i >> 1)]! >> ((i & 1) * 4)) & 0xf) * 17;
  colours(data, at + 8, out, false, false);
};

const alphas = new Uint8Array(8);

/** DXT5: two alpha end points and 3-bit indices, then a colour block. */
const bc3: BlockDecoder = (data, at, out) => {
  const a0 = data[at]!;
  const a1 = data[at + 1]!;
  alphas[0] = a0;
  alphas[1] = a1;
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) alphas[i + 1] = ((7 - i) * a0 + i * a1 + 3) / 7;
  } else {
    for (let i = 1; i < 5; i++) alphas[i + 1] = ((5 - i) * a0 + i * a1 + 2) / 5;
    alphas[6] = 0;
    alphas[7] = 255;
  }
  // 48 bits of indices: two 24-bit halves keep the arithmetic in 32 bits.
  const low = data[at + 2]! | (data[at + 3]! << 8) | (data[at + 4]! << 16);
  const high = data[at + 5]! | (data[at + 6]! << 8) | (data[at + 7]! << 16);
  for (let i = 0; i < 16; i++) {
    const bits = i < 8 ? low >> (i * 3) : high >> ((i - 8) * 3);
    out[i * 4 + 3] = alphas[bits & 7]!;
  }
  colours(data, at + 8, out, false, false);
};
