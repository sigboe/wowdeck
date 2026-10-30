/**
 * A `bitcoin:` entry in FUNDING.yml's `custom` → the address a wallet app
 * scans. The file is untrusted input fetched from `next` (ADR-0005), and a
 * mistyped address loses the payment, so the address's own checksum must
 * hold: Base58Check for legacy `1…`/`3…` (P2PKH, P2SH), bech32 (BIP173) or
 * bech32m (BIP350) for `bc1…` (SegWit, Taproot). Only mainnet.
 */

/**
 * The address in a BIP21 `bitcoin:<address>[?params]` URI, or null when
 * the text isn't one or the checksum fails. Parameters (`amount`, `label`,
 * …) are dropped: the player picks the amount in their wallet. A bech32
 * address comes back lowercase.
 */
export function bitcoinAddress(text: string): string | null {
  const match = /^bitcoin:([^?]+)(\?.*)?$/i.exec(text);
  if (!match) return null;
  const address = match[1]!;
  if (/^bc1/i.test(address)) return isSegwit(address) ? address.toLowerCase() : null;
  return isBase58Check(address) ? address : null;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Version bytes of mainnet P2PKH (`1…`) and P2SH (`3…`). */
const BASE58_VERSIONS = new Set([0x00, 0x05]);

function isBase58Check(address: string): boolean {
  if (address.length < 26 || address.length > 35) return false;
  let value = 0n;
  for (const char of address) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return false;
    value = value * 58n + BigInt(digit);
  }
  // Each leading "1" is a leading zero byte.
  const zeros = address.length - address.replace(/^1+/, "").length;
  const tail: number[] = [];
  while (value > 0n) {
    tail.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  const bytes = new Uint8Array([...new Array<number>(zeros).fill(0), ...tail]);
  // Version, 20-byte hash, 4-byte checksum.
  if (bytes.length !== 25 || !BASE58_VERSIONS.has(bytes[0]!)) return false;
  const payload = bytes.subarray(0, 21);
  const once = new Bun.CryptoHasher("sha256").update(payload).digest();
  const twice = new Bun.CryptoHasher("sha256").update(once).digest();
  return twice.subarray(0, 4).equals(bytes.subarray(21));
}

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATOR[i]!;
  }
  return chk >>> 0;
}

function isSegwit(address: string): boolean {
  // Mixed case is invalid; either case alone is the same address.
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) return false;
  const lower = address.toLowerCase();
  if (lower.length > 90) return false;
  const data: number[] = [];
  for (const char of lower.slice(3)) {
    const value = BECH32.indexOf(char);
    if (value < 0) return false;
    data.push(value);
  }
  // Witness version, at least one program group, six checksum groups.
  if (data.length < 8) return false;
  const version = data[0]!;
  if (version > 16) return false;
  // "bc" expanded for the checksum: high bits, a zero, low bits.
  const hrp = [3, 3, 0, 2, 3];
  const expected = version === 0 ? BECH32_CONST : BECH32M_CONST;
  if (polymod([...hrp, ...data]) !== expected) return false;

  // The program: 5-bit groups back to bytes, with no leftover bits set.
  let acc = 0;
  let bits = 0;
  const program: number[] = [];
  for (const value of data.slice(1, -6)) {
    acc = ((acc << 5) | value) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      program.push((acc >>> bits) & 0xff);
    }
  }
  if (bits >= 5 || (acc & ((1 << bits) - 1)) !== 0) return false;
  if (program.length < 2 || program.length > 40) return false;
  return version !== 0 || program.length === 20 || program.length === 32;
}
