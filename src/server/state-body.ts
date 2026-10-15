/** Physical D1 encoding for versioned state documents. API values stay plain JSON. */
const PREFIX = '!g4-state-gzip-v1:';
const COMPRESS_AFTER_BYTES = 1_000_000;
// D1 limits a string/row to 2,000,000 bytes. Leave room for platform overhead.
const MAX_BODY_BYTES = 1_800_000;
const encoder = new TextEncoder();

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function compressedBody(json: string): Promise<string> {
  const compressed = new Uint8Array(await new Response(
    new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer());
  return PREFIX + base64(compressed);
}

/** Client snapshots use an ASCII body so a backfill can split SQL imports safely. */
export async function encodeCompressedStateBody(value: unknown): Promise<string> {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') throw new TypeError('State document must be JSON');
  const body = await compressedBody(json);
  if (encoder.encode(body).byteLength > MAX_BODY_BYTES)
    throw new RangeError('State document exceeds D1 row capacity after compression');
  return body;
}

export async function encodeStateBody(value: unknown): Promise<string> {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') throw new TypeError('State document must be JSON');
  const rawBytes = encoder.encode(json).byteLength;
  if (rawBytes <= COMPRESS_AFTER_BYTES) return json;

  const packed = await compressedBody(json);
  const body = packed.length < rawBytes ? packed : json;
  if (encoder.encode(body).byteLength > MAX_BODY_BYTES)
    throw new RangeError('State document exceeds D1 row capacity after compression');
  return body;
}

export async function decodeStateBody(body: string): Promise<unknown> {
  if (!body.startsWith(PREFIX)) return JSON.parse(body);
  const bytes = fromBase64(body.slice(PREFIX.length));
  const json = await new Response(
    new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).text();
  return JSON.parse(json);
}
