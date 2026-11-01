import { BadRequestException } from '@nestjs/common';

/** Small validation helpers so every endpoint rejects bad input with a clear message. */
export function str(v: unknown, name: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return '';
    throw new BadRequestException(`${name} is required.`);
  }
  if (typeof v !== 'string') throw new BadRequestException(`${name} must be text.`);
  const s = v.trim();
  if (opts.min && s.length < opts.min) throw new BadRequestException(`${name} must be at least ${opts.min} characters.`);
  if (opts.max && s.length > opts.max) throw new BadRequestException(`${name} must be at most ${opts.max} characters.`);
  return s;
}
export function int(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequestException(`${name} is invalid.`);
  return n;
}
export function oneOf<T extends string>(v: unknown, name: string, allowed: readonly T[]): T {
  if (!allowed.includes(v as T)) throw new BadRequestException(`${name} must be one of: ${allowed.join(', ')}.`);
  return v as T;
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
