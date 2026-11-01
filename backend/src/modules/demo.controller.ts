import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import { Db } from '../db/db.service';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth';
import { dutyQr, hospitalQr, visitQr } from '../common/qr';
import { int } from '../common/dto';
import { config } from '../config';

/**
 * DEMO MODE ONLY (DEMO_MODE=true). The prototype screens simulate camera scans with a "Scan" button.
 * These endpoints hand the app the same signed codes a real camera would read, so the real checks still run.
 * Turn DEMO_MODE off in production: doctors then scan the printed duty QR and the patient's live QR.
 */
@Controller('demo')
@Roles('doctor')
export class DemoController {
  constructor(private db: Db) {}

  private guard() { if (!config.demoMode) throw new ForbiddenException('Demo mode is off. Please scan the real QR code.'); }

  @Get('duty-qr')
  async duty(@CurrentUser() u: AuthUser) {
    this.guard();
    const h = await this.db.one(`SELECT h.id, h.qr_version FROM doctor_profiles dp JOIN hospitals h ON h.id=dp.hospital_id WHERE dp.user_id=$1`, [u.id]);
    if (!h) throw new NotFoundException('No hospital linked to this doctor.');
    return { code: dutyQr(h.id, h.qr_version) };
  }

  @Get('patient-qr/:visitId')
  async patient(@CurrentUser() u: AuthUser, @Param('visitId') id: string) {
    this.guard();
    const v = await this.db.one('SELECT patient_id, doctor_id FROM visits WHERE id=$1', [int(id, 'Visit')]);
    if (!v || v.doctor_id !== u.id) throw new NotFoundException('This patient is not in your queue.');
    return visitQr(v.patient_id);
  }
}

/** DEMO MODE ONLY: the printed hospital QR for a hospital, so the patient's Scan screen can be shown without a printout. */
@Controller('demo')
export class DemoPublicController {
  constructor(private db: Db) {}
  @Public() @Get('hospital-qr/:slug')
  async hospital(@Param('slug') slug: string) {
    if (!config.demoMode) throw new ForbiddenException('Demo mode is off. Please scan the real QR code.');
    const h = await this.db.one(`SELECT id, qr_version FROM hospitals WHERE slug=$1 AND on_medilink`, [String(slug).slice(0, 40)]);
    if (!h) throw new NotFoundException('Hospital not found.');
    return { code: hospitalQr(h.id, h.qr_version) };
  }
}
