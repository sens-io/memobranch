import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AgentMemoryError } from './errors.js';
import { sha256 } from './utils.js';

export const PDF_IMAGE_MAX_EDGE = 1600;
export const PDF_IMAGE_MAX_BYTES = 2_000_000;
export const PDF_IMAGES_MAX_BYTES = 4_000_000;
export const PDF_IMAGES_MAX_PIXELS = 10_000_000;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const language = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
export const pdfProcessingSelectionSchema = z.object({
  pages: z.array(z.number().int().min(1).max(100)).min(1).max(5),
  languages: z.array(language).min(1).max(2).optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.pages).size !== value.pages.length || new Set(value.languages).size !== value.languages?.length && value.languages !== undefined) {
    context.addIssue({ code: 'custom', message: 'Selected pages and languages must be distinct' });
  }
});
export const pdfProcessorConfigSchema = z.object({
  version: z.literal(1), renderer: z.string().min(1).max(4096), workRoot: z.string().min(1).max(4096),
  ocr: z.string().min(1).max(4096).optional(), languageData: z.string().min(1).max(4096).optional(),
  fontDirectory: z.string().min(1).max(4096).optional(),
}).strict();
const processor = z.object({ sha256: digest, version: z.string().regex(/^[0-9][0-9a-zA-Z.+_-]{0,79}$/) }).strict();
export const pdfPageProcessingSchema = z.object({
  version: z.literal(1), sourceSha256: digest, selection: pdfProcessingSelectionSchema,
  renderer: processor.extend({ fonts: z.array(z.object({ name: z.string().regex(/^[^/\\\0]{1,200}\.(?:ttf|otf)$/i), sha256: digest }).strict()).max(32) }),
  ocr: processor.extend({ languages: z.array(z.object({ name: language, sha256: digest }).strict()).min(1).max(2) }).optional(),
  pages: z.array(z.object({
    number: z.number().int().min(1).max(100), width: z.number().int().min(1).max(PDF_IMAGE_MAX_EDGE), height: z.number().int().min(1).max(PDF_IMAGE_MAX_EDGE),
    mediaType: z.literal('image/png'), bytes: z.number().int().min(1).max(PDF_IMAGE_MAX_BYTES), sha256: digest,
    data: z.string().min(4).max(Math.ceil(PDF_IMAGE_MAX_BYTES / 3) * 4),
    ocrText: z.string().max(40_000).optional(), ocrSha256: digest.optional(),
  }).strict()).min(1).max(5),
}).strict();
export type PdfProcessingSelection = z.infer<typeof pdfProcessingSelectionSchema>;
export type PdfProcessorConfig = z.infer<typeof pdfProcessorConfigSchema>;
export type PdfPageProcessing = z.infer<typeof pdfPageProcessingSchema>;

/** Only ordinary noninterlaced 8-bit PNGs are retained; inflate is bounded. */
export function inspectPdfPng(bytes: Buffer): { width: number; height: number } {
  if (bytes.length > PDF_IMAGE_MAX_BYTES) tooLarge();
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) invalid();
  let offset = 8, width = 0, height = 0, channels = 0, ended = false, seenData = false, dataEnded = false;
  const compressed: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid();
    const size = bytes.readUInt32BE(offset), end = offset + size + 12;
    if (end > bytes.length) invalid();
    // latin1 preserves high bits; ASCII decoding would silently turn 0xc9 into I.
    const type = bytes.toString('latin1', offset + 4, offset + 8), value = bytes.subarray(offset + 8, end - 4);
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2]?.toUpperCase()) invalid();
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
    if (!width && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (width || offset !== 8 || size !== 13) invalid();
      width = value.readUInt32BE(0); height = value.readUInt32BE(4);
      if (!width || !height || width > PDF_IMAGE_MAX_EDGE || height > PDF_IMAGE_MAX_EDGE) tooLarge();
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[value[9]!] ?? 0;
      if (value[8] !== 8 || !channels || value[10] || value[11] || value[12]) invalid();
    } else if (type === 'IDAT') {
      if (dataEnded) invalid(); seenData = true; compressed.push(value);
    } else if (type === 'IEND') {
      if (size || !seenData || end !== bytes.length) invalid(); ended = true;
    } else {
      if (seenData) dataEnded = true;
      // Unknown critical chunks and animated images are not a supported output.
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT' || type[0] === type[0]?.toUpperCase()) invalid();
    }
    offset = end;
  }
  if (!ended) invalid();
  const stride = width * channels + 1, expected = stride * height;
  let raw: Buffer;
  try {
    // Node 20 supports info:true, although the installed Node types omit its overload.
    const encoded = Buffer.concat(compressed), result = inflateSync(encoded, { maxOutputLength: expected, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    if (result.engine.bytesWritten !== encoded.length) invalid();
    raw = result.buffer;
  } catch { invalid(); }
  if (raw.length !== expected) invalid();
  for (let row = 0; row < height; row++) if (raw[row * stride]! > 4) invalid();
  return { width, height };
}

export function assertPdfPageProcessing(value: unknown): asserts value is PdfPageProcessing {
  const result = pdfPageProcessingSchema.safeParse(value); if (!result.success) invalid();
  const record = result.data; let totalBytes = 0, totalPixels = 0, characters = 0;
  if (record.pages.length !== record.selection.pages.length) invalid();
  if (!!record.ocr !== !!record.selection.languages) invalid();
  if (record.ocr && JSON.stringify(record.ocr.languages.map(item => item.name)) !== JSON.stringify(record.selection.languages)) invalid();
  for (const [index, page] of record.pages.entries()) {
    if (page.number !== record.selection.pages[index] || page.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(page.data)) invalid();
    const bytes = Buffer.from(page.data, 'base64'), size = inspectPdfPng(bytes);
    if (bytes.length !== page.bytes || bytes.toString('base64') !== page.data || createHash('sha256').update(bytes).digest('hex') !== page.sha256 || size.width !== page.width || size.height !== page.height) invalid();
    totalBytes += bytes.length; totalPixels += page.width * page.height; characters += page.ocrText?.length ?? 0;
    if (record.ocr ? page.ocrText === undefined || page.ocrSha256 !== sha256(page.ocrText) || page.ocrText.includes('\0') : page.ocrText !== undefined || page.ocrSha256 !== undefined) invalid();
  }
  if (totalBytes > PDF_IMAGES_MAX_BYTES || totalPixels > PDF_IMAGES_MAX_PIXELS || characters > 200_000) tooLarge();
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const value of bytes) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function invalid(): never { throw new AgentMemoryError('VALIDATION_FAILED', 'Invalid PDF page processing output'); }
function tooLarge(): never { throw new AgentMemoryError('CONTENT_TOO_LARGE', 'PDF page image or complete processing output exceeds limits'); }
