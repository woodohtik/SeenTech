/**
 * Validates that a file's actual content (not its browser-reported, spoofable
 * `file.type`) is one of a small allowlist of raster image formats. Rejects
 * everything else, notably SVG — an SVG can carry an embedded `<script>` and,
 * if ever opened directly (not via an `<img>` tag) from its public storage
 * URL, executes in that origin.
 */

const SIGNATURES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  // WEBP: 'RIFF' .... 'WEBP' — two separate matches, checked below.
];

export async function isAllowedImageFile(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (sig.bytes.every((b, i) => head[offset + i] === b)) return true;
  }

  // WebP: bytes 0-3 "RIFF", bytes 8-11 "WEBP"
  const isRiff = [0x52, 0x49, 0x46, 0x46].every((b, i) => head[i] === b);
  const isWebp = [0x57, 0x45, 0x42, 0x50].every((b, i) => head[8 + i] === b);
  if (isRiff && isWebp) return true;

  return false;
}
