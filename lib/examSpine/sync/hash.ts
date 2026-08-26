// PASSAI 受験版 Exam Spine — Stage 4 sync core / SHA-256（純関数・自己完結）。
//
// なぜ自作するか:
//   - `node:crypto` を import すると sync core が Node runtime 依存になる。sync primitive は
//     「型と純関数だけ」の層であり、実行環境（server / edge / script / 将来の client 検証）に
//     依存させたくない（Canon §48 / §52）。
//   - dependency 追加は禁止（E-S14）。
//   - 自作 hash の正しさは QA が **node:crypto の実装と test vector で突き合わせて**証明する
//     （scripts/exam-spine-sync-core-check.ts）。実装の自作と検証の自作を分ける。
//
// この file が持たないもの: I/O / clock / random / logging / global 参照（Uint8Array のみ）。

// FIPS 180-4 §4.2.2 — 最初の 64 素数の立方根の小数部 32bit。
const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

// FIPS 180-4 §5.3.3 — 最初の 8 素数の平方根の小数部 32bit。
const H_INIT: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const HEX = '0123456789abcdef';

/**
 * UTF-8 encode（TextEncoder 非依存）。
 * 対になっていない surrogate は U+FFFD へ置換する（WHATWG encoding と同じ扱い）。
 * ここを実装依存にすると「同じ文字列なのに環境で fingerprint が変わる」経路になるため固定する。
 */
function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else {
        cp = 0xfffd;
      }
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      cp = 0xfffd;
    }

    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** SHA-256（FIPS 180-4）。入力は文字列、出力は小文字 hex 64 桁。純関数。 */
export function sha256Hex(text: string): string {
  const msg = utf8Bytes(text);
  const byteLen = msg.length;

  // padding: 0x80 + 0 埋め + 64bit big-endian bit length
  const blocks = Math.ceil((byteLen + 9) / 64);
  const total = blocks * 64;
  const buf = new Uint8Array(total);
  buf.set(msg, 0);
  buf[byteLen] = 0x80;

  const bitHi = Math.floor(byteLen / 536870912); // byteLen * 8 / 2^32
  const bitLo = (byteLen * 8) >>> 0;
  buf[total - 8] = (bitHi >>> 24) & 0xff;
  buf[total - 7] = (bitHi >>> 16) & 0xff;
  buf[total - 6] = (bitHi >>> 8) & 0xff;
  buf[total - 5] = bitHi & 0xff;
  buf[total - 4] = (bitLo >>> 24) & 0xff;
  buf[total - 3] = (bitLo >>> 16) & 0xff;
  buf[total - 2] = (bitLo >>> 8) & 0xff;
  buf[total - 1] = bitLo & 0xff;

  const h = Uint32Array.from(H_INIT);
  const w = new Uint32Array(64);

  for (let b = 0; b < blocks; b += 1) {
    const base = b * 64;
    for (let t = 0; t < 16; t += 1) {
      const o = base + t * 4;
      w[t] = ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t += 1) {
      const s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h[0];
    let bb = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let t = 0; t < 64; t += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & bb) ^ (a & c) ^ (bb & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = bb;
      bb = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + bb) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i += 1) {
    const v = h[i];
    for (let s = 28; s >= 0; s -= 4) hex += HEX[(v >>> s) & 0xf];
  }
  return hex;
}
