import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { config } from '../config';

const MAX = 15 * 1024 * 1024;

/** Validates a file by its real content (not just the name) and stores it. Supports PDF, JPEG, PNG and DICOM. */
export function storeFile(fileName: string, dataBase64: string): { mime: string; size: number; sha256: string; path: string } {
  if (!fileName || !dataBase64) throw new BadRequestException('Please attach a file.');
  const buf = Buffer.from(dataBase64.replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw new BadRequestException('The file is empty.');
  if (buf.length > MAX) throw new BadRequestException('The file is larger than 15 MB.');
  let mime: string | null = null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') mime = 'application/pdf';
  else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) mime = 'image/jpeg';
  else if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) mime = 'image/png';
  else if (buf.length > 132 && buf.subarray(128, 132).toString('latin1') === 'DICM') mime = 'application/dicom';
  if (!mime) throw new BadRequestException('Only PDF, JPEG, PNG or DICOM files are accepted. This file does not match any of them.');
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const dir = resolve(config.uploadDir);
  mkdirSync(dir, { recursive: true });
  const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'application/dicom': '.dcm' }[mime];
  const path = join(dir, `${Date.now()}-${sha256.slice(0, 16)}${ext}`);
  writeFileSync(path, buf, { flag: 'wx' });
  return { mime, size: buf.length, sha256, path };
}
