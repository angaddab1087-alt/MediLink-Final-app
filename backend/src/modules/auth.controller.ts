import { Throttle } from '@nestjs/throttler';
import { config } from '../config';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Db } from '../db/db.service';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { EMAIL_RE, str } from '../common/dto';

@Controller('auth')
export class AuthController {
  constructor(private db: Db, private jwt: JwtService, private audit: AuditService) {}

  private async tokenFor(userId: number, desk: string | null = null) {
    const u = await this.db.one('SELECT id, email, role, name, hospital_id, token_version FROM users WHERE id=$1 AND active', [userId]);
    if (!u) throw new UnauthorizedException('Account not found or deactivated.');
    const desks = u.role === 'staff' ? (await this.db.q('SELECT desk FROM staff_desks WHERE user_id=$1 ORDER BY desk', [u.id])).map((d) => d.desk) : [];
    const chosen = desk ?? (desks.length === 1 ? desks[0] : null);
    const user: AuthUser = { id: u.id, email: u.email, role: u.role, name: u.name, hospitalId: u.hospital_id, desks, desk: chosen, tv: u.token_version || 0 };
    return { token: this.jwt.sign(user), user };
  }

  @Public() @Throttle({ default: { limit: config.authLimitPerMinute, ttl: 60_000 } }) @Post('signup')
  async signup(@Body() b: any) {
    const email = str(b.email, 'Email').toLowerCase();
    if (!EMAIL_RE.test(email)) throw new BadRequestException('Please enter a valid email address.');
    const password = str(b.password, 'Password', { min: 8, max: 100 });
    const pin = str(b.pin, 'Security PIN');
    if (!/^\d{4}$/.test(pin)) throw new BadRequestException('Security PIN must be 4 digits.');
    const name = str(b.name, 'Full name', { min: 2, max: 100 });
    if (await this.db.one('SELECT 1 FROM users WHERE email=$1', [email])) throw new BadRequestException('An account with this email already exists.');
    const id = await this.db.tx(async (c) => {
      const r = await c.query(`INSERT INTO users (email, password_hash, pin_hash, role, name) VALUES ($1,$2,$3,'patient',$4) RETURNING id`,
        [email, await bcrypt.hash(password, 10), await bcrypt.hash(pin, 10), name]);
      const uid = r.rows[0].id;
      await c.query(`INSERT INTO patient_profiles (user_id, medilink_id, full_name) VALUES ($1,$2,$3)`, [uid, 'ML-' + String(100000 + uid).slice(-6), name]);
      return uid;
    });
    await this.audit.log({ id, role: 'patient' }, { action: 'SIGNUP', patientId: id });
    return this.tokenFor(id);
  }

  /** Step 1: email + password. Patients and doctors must then confirm their PIN (step 2). */
  @Public() @Throttle({ default: { limit: config.authLimitPerMinute, ttl: 60_000 } }) @Post('login')
  async login(@Body() b: any) {
    const email = str(b.email, 'Email').toLowerCase();
    const password = str(b.password, 'Password');
    const u = await this.db.one('SELECT * FROM users WHERE email=$1', [email]);
    if (!u || !(await bcrypt.compare(password, u.password_hash))) throw new UnauthorizedException('Wrong email or password.');
    if (!u.active) throw new ForbiddenException('This account has been deactivated. Please contact the hospital admin.');
    if (u.hospital_id && (await this.db.one(`SELECT status FROM hospitals WHERE id=$1`, [u.hospital_id]))?.status === 'suspended') throw new ForbiddenException('This hospital is suspended on MediLink. Please contact MediLink support.');
    if (u.pin_hash) {
      const pinToken = this.jwt.sign({ pinFor: u.id }, { expiresIn: '5m' });
      return { needsPin: true, pinToken };
    }
    await this.audit.log({ id: u.id, role: u.role, hospitalId: u.hospital_id }, { action: 'LOGIN' });
    return this.tokenFor(u.id);
  }

  @Public() @Throttle({ default: { limit: config.authLimitPerMinute, ttl: 60_000 } }) @Post('pin')
  async pin(@Body() b: any) {
    let payload: any;
    try { payload = this.jwt.verify(str(b.pinToken, 'PIN session')); } catch { throw new UnauthorizedException('PIN step expired. Please log in again.'); }
    const u = await this.db.one('SELECT * FROM users WHERE id=$1', [payload.pinFor]);
    if (!u || !(await bcrypt.compare(str(b.pin, 'PIN'), u.pin_hash))) throw new UnauthorizedException('Wrong PIN.');
    await this.audit.log({ id: u.id, role: u.role, hospitalId: u.hospital_id }, { action: 'LOGIN' });
    return this.tokenFor(u.id);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) { return { user }; }

  /** Staff choose which desk they are working at today. */
  @Post('desk')
  async desk(@CurrentUser() user: AuthUser, @Body() b: any) {
    let desk = str(b.desk, 'Desk');
    if (desk.toLowerCase().includes('reception') || desk.toLowerCase().includes('registration') || desk.toLowerCase().includes('opd')) {
      desk = 'Reception';
    }
    if (user.role !== 'staff') throw new ForbiddenException('Only staff accounts have desks.');
    let ok = await this.db.one('SELECT 1 FROM staff_desks WHERE user_id=$1 AND desk=$2', [user.id, desk]);
    if (!ok) {
      await this.db.q('INSERT INTO staff_desks (user_id, desk) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, desk]);
      ok = true;
    }
    await this.audit.log({ ...user, desk }, { action: 'DESK_SELECTED', detail: desk });
    return this.tokenFor(user.id, desk);
  }
}
