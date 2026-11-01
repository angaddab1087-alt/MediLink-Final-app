import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';

const sign = (s: string) => createHmac('sha256', config.qrSecret).update(s).digest('base64url').slice(0, 22);
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Hospital QR: ML-H.<hospitalId>.<version>.<sig> — printed at the hospital, changes when the admin rotates it. */
export const hospitalQr = (hospitalId: number, version: number) => { const p = `ML-H.${hospitalId}.${version}`; return `${p}.${sign(p)}`; };
/** Duty QR for doctor clock-in: ML-D.<hospitalId>.<version>.<sig> */
export const dutyQr = (hospitalId: number, version: number) => { const p = `ML-D.${hospitalId}.${version}`; return `${p}.${sign(p)}`; };

export function parseSigned(code: string, prefix: 'ML-H' | 'ML-D'): { hospitalId: number; version: number } | null {
  const parts = (code || '').trim().split('.');
  if (parts.length !== 4 || parts[0] !== prefix) return null;
  const p = parts.slice(0, 3).join('.');
  if (!safeEq(sign(p), parts[3])) return null;
  return { hospitalId: Number(parts[1]), version: Number(parts[2]) };
}

/** Rotating visit QR: ML-P.<patientId>.<window>.<sig>. Valid for the current and previous 30-second window only. */
export const visitQr = (patientId: number, now = Date.now()) => {
  const w = Math.floor(now / 1000 / config.visitQrWindowSeconds);
  const p = `ML-P.${patientId}.${w}`;
  return { code: `${p}.${sign(p)}`, expiresInSeconds: config.visitQrWindowSeconds - Math.floor((now / 1000) % config.visitQrWindowSeconds) };
};

export function parseVisitQr(code: string, now = Date.now()): number | null {
  const parts = (code || '').trim().split('.');
  if (parts.length !== 4 || parts[0] !== 'ML-P') return null;
  const p = parts.slice(0, 3).join('.');
  if (!safeEq(sign(p), parts[3])) return null;
  const w = Math.floor(now / 1000 / config.visitQrWindowSeconds);
  const qw = Number(parts[2]);
  if (qw !== w && qw !== w - 1) return null;
  return Number(parts[1]);
}
