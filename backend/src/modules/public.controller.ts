import { Throttle } from '@nestjs/throttler';
import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Db } from '../db/db.service';
import { Public } from '../common/auth';
import { parseSigned } from '../common/qr';
import { EMERGENCY_RINGS_KM, BODY_AREAS, km, routeSymptoms } from '../common/routing';
import { int, str } from '../common/dto';

@Controller()
export class PublicController {
  constructor(private db: Db) {}

  @Public() @Get('health')
  async health() { await this.db.q('SELECT 1'); return { ok: true, service: 'medilink-api' }; }

  @Public() @Get('hospitals')
  async hospitals(@Query('q') q?: string, @Query('type') type?: string) {
    const rows = await this.db.q(
      `SELECT id, slug, name, address, area, type, phone, lat, lng, has_emergency, on_medilink FROM hospitals
       WHERE active AND status='active' AND ($1::text IS NULL OR name ILIKE '%'||$1||'%' OR area ILIKE '%'||$1||'%')
         AND ($2::text IS NULL OR type = $2) ORDER BY name`, [q || null, type || null]);
    return rows;
  }

  @Public() @Get('hospitals/:id')
  async hospital(@Param('id') id: string) {
    const h = await this.db.one('SELECT id, slug, name, address, area, type, phone, lat, lng, has_emergency, on_medilink, extra_fields FROM hospitals WHERE id=$1 AND active', [int(id, 'Hospital')]);
    if (!h) throw new NotFoundException('Hospital not found.');
    const departments = await this.db.q('SELECT id, name, kind FROM departments WHERE hospital_id=$1 AND active ORDER BY kind, name', [h.id]);
    const doctors = await this.doctorsOf(h.id);
    return { ...h, departments, doctors };
  }

  async doctorsOf(hospitalId: number) {
    return this.db.q(
      `SELECT u.id, u.name, d.name AS department, dp.gender, dp.is_gp, dp.on_leave,
              EXISTS (SELECT 1 FROM shifts s WHERE s.doctor_id=u.id AND s.clock_out IS NULL) AS on_duty,
              (SELECT count(*)::int FROM visits v WHERE v.doctor_id=u.id AND v.visit_date=CURRENT_DATE AND v.status IN ('Requested','Approved','Arrived','Called')) AS waiting
       FROM users u JOIN doctor_profiles dp ON dp.user_id=u.id JOIN departments d ON d.id=dp.department_id
       WHERE dp.hospital_id=$1 AND u.active ORDER BY d.name, u.name`, [hospitalId]);
  }

  /** Resolves a scanned hospital QR. Only genuine, current MediLink codes work. */
  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @Post('qr/resolve')
  async resolve(@Body() b: any) {
    const parsed = parseSigned(str(b.code, 'QR code'), 'ML-H');
    if (!parsed) throw new BadRequestException('This is not a valid MediLink hospital QR code.');
    const h = await this.db.one('SELECT id, name, address, lat, lng, qr_version, status FROM hospitals WHERE id=$1 AND active', [parsed.hospitalId]);
    if (h && h.status !== 'active') throw new BadRequestException('This hospital is not taking MediLink registrations right now. Please go to the counter.');
    if (!h || h.qr_version !== parsed.version) throw new BadRequestException('This QR code is old. Please scan the current QR at the hospital.');
    let distanceKm: number | null = null;
    if (typeof b.lat === 'number' && typeof b.lng === 'number') distanceKm = Math.round(km(b.lat, b.lng, h.lat, h.lng) * 10) / 10;
    return { hospitalId: h.id, name: h.name, address: h.address, distanceKm, farAway: distanceKm !== null && distanceKm > 5 };
  }

  @Public() @Post('symptoms/route')
  route(@Body() b: any) { return routeSymptoms(str(b.text, 'Symptoms', { optional: true }), b.bodyArea); }

  @Public() @Get('symptoms/body-areas')
  bodyAreas() { return Object.keys(BODY_AREAS); }

  /** Emergency: nearest hospitals with emergency services, searched in widening rings (5, 10, 25, 50 km). */
  @Public() @Get('emergency/nearby')
  async nearby(@Query('lat') lat: string, @Query('lng') lng: string) {
    const la = Number(lat), lo = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) throw new BadRequestException('Location is required.');
    const all = (await this.db.q('SELECT id, name, address, phone, lat, lng, type, on_medilink FROM hospitals WHERE active AND has_emergency'))
      .map((h) => ({ ...h, distanceKm: Math.round(km(la, lo, h.lat, h.lng) * 10) / 10 }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    for (const ring of EMERGENCY_RINGS_KM) {
      const found = all.filter((h) => h.distanceKm <= ring);
      if (found.length) await this.db.q('INSERT INTO emergency_searches (ring_km, results) VALUES ($1,$2)', [ring, found.length]);
      if (found.length) return { ringKm: ring, hospitals: found.map((h) => ({ ...h, etaMinutes: Math.max(3, Math.round(h.distanceKm * 3)) })) };
    }
    return { ringKm: null, hospitals: all.slice(0, 5).map((h) => ({ ...h, etaMinutes: Math.round(h.distanceKm * 3) })) };
  }

  @Public() @Post('emergency/inform')
  async inform(@Body() b: any) {
    const hospitalId = int(b.hospitalId, 'Hospital');
    const h = await this.db.one('SELECT id, on_medilink FROM hospitals WHERE id=$1', [hospitalId]);
    if (!h?.on_medilink) throw new BadRequestException('This hospital is not on MediLink. Please call the hospital.');
    await this.db.q('INSERT INTO emergency_alerts (hospital_id, name, lat, lng, eta_minutes, note) VALUES ($1,$2,$3,$4,$5,$6)',
      [hospitalId, str(b.name, 'Name', { optional: true }) || 'Unknown', b.lat ?? null, b.lng ?? null, b.etaMinutes ?? null, str(b.note, 'Note', { optional: true, max: 300 })]);
    return { ok: true, message: 'The hospital has been told you are on the way.' };
  }
}
