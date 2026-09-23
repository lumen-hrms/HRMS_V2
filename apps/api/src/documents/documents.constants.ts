import { BadRequestException } from '@nestjs/common';

export const DOCUMENTS_QUEUE = 'documents';

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB, module 03 §3/FR-EMP-005

/**
 * The upload allow-list (module 09 §3.2), each with the leading "magic
 * bytes" its content must actually start with — a claimed MIME type alone
 * is just a client-supplied header.
 */
const SIGNATURES: Record<string, { label: string; magic: number[] }> = {
  'application/pdf': { label: 'PDF', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  'image/jpeg': { label: 'JPG', magic: [0xff, 0xd8, 0xff] },
  'image/png': { label: 'PNG', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
};

/** Throws a 400 unless `file` is a non-empty, ≤10 MB PDF/JPEG/PNG whose bytes match its type. */
export function assertValidUpload(file: Express.Multer.File | undefined): asserts file {
  if (!file || !file.buffer || file.size === 0) {
    throw new BadRequestException('A non-empty file is required.');
  }
  const sig = SIGNATURES[file.mimetype];
  if (!sig) {
    throw new BadRequestException(
      `Unsupported file type "${file.mimetype}" — allowed: PDF, JPG, PNG.`,
    );
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new BadRequestException('File exceeds the 10 MB limit.');
  }
  const matches = sig.magic.every((byte, i) => file.buffer[i] === byte);
  if (!matches) {
    throw new BadRequestException(`File content is not a valid ${sig.label}.`);
  }
}
