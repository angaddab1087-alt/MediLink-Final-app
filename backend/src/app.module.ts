import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { config } from './config';
import { Db } from './db/db.service';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './common/auth';
import { AuthController } from './modules/auth.controller';
import { PublicController } from './modules/public.controller';
import { PatientController } from './modules/patient.controller';
import { DoctorController } from './modules/doctor.controller';
import { DiagnosticsController, IncidentsController, ReceptionController } from './modules/staff.controller';
import { AdminController } from './modules/admin.controller';
import { VisitsService } from './modules/visits.service';
import { DemoController, DemoPublicController } from './modules/demo.controller';
import { AdminExtrasController, DoctorExtrasController, PatientExtrasController, ReceptionExtrasController } from './modules/stitch.controller';
import { PlatformController } from './modules/platform.controller';

@Module({
  imports: [
    JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: '12h' } }),
    // Rate limiting (token bucket per client IP): 120 requests a minute by default; login, QR and uploads are stricter.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: config.rateLimitPerMinute }]),
  ],
  controllers: [AuthController, PublicController, PatientController, DoctorController, ReceptionController, DiagnosticsController, IncidentsController, AdminController, DemoController, DemoPublicController, PlatformController, PatientExtrasController, DoctorExtrasController, ReceptionExtrasController, AdminExtrasController],
  providers: [Db, AuditService, VisitsService, { provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
