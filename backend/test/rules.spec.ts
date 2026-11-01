import { routeSymptoms, km } from '../src/common/routing';
import { hospitalQr, parseSigned, parseVisitQr, visitQr } from '../src/common/qr';

describe('symptom routing', () => {
  it('sends red-flag symptoms to emergency', () => expect(routeSymptoms('severe chest pain since morning').emergency).toBe(true));
  it('understands Hindi and Marathi red flags', () => {
    expect(routeSymptoms('सीने में दर्द').emergency).toBe(true);
    expect(routeSymptoms('छातीत दुखणे').emergency).toBe(true);
  });
  it('routes knee pain to Orthopaedics', () => expect(routeSymptoms('knee pain').department).toBe('Orthopaedics'));
  it('uses the body picker', () => expect(routeSymptoms('', 'Skin').department).toBe('Dermatology'));
  it('falls back to General Physician', () => expect(routeSymptoms('not feeling well').department).toBe('General Physician'));
  it('never claims a diagnosis', () => expect(routeSymptoms('fever').note).toMatch(/not a diagnosis/));
});

describe('QR codes', () => {
  it('accepts a genuine hospital QR and rejects a tampered one', () => {
    const code = hospitalQr(3, 2);
    expect(parseSigned(code, 'ML-H')).toEqual({ hospitalId: 3, version: 2 });
    expect(parseSigned(code.replace('ML-H.3', 'ML-H.4'), 'ML-H')).toBeNull();
  });
  it('visit QR expires after two 30-second windows', () => {
    const now = Date.now();
    const { code } = visitQr(7, now);
    expect(parseVisitQr(code, now)).toBe(7);
    expect(parseVisitQr(code, now + 65_000)).toBeNull();
  });
});

describe('distance', () => {
  it('computes Andheri to Bandra as roughly 9 km', () => {
    const d = km(19.131, 72.8253, 19.051, 72.829);
    expect(d).toBeGreaterThan(8); expect(d).toBeLessThan(10);
  });
});
