import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Db } from '../db/db.service';

export type Role = 'patient' | 'doctor' | 'staff' | 'admin' | 'owner';
export interface AuthUser { id: number; role: Role; name: string; email: string; hospitalId: number | null; desk?: string | null; desks?: string[]; tv?: number }

export const ROLES_KEY = 'roles';
export const PUBLIC_KEY = 'public';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

/** Verifies the bearer token on every request and enforces @Roles(). Desk checks happen in the services. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector, private db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      try { req.user = this.jwt.verify(token); } catch { if (!isPublic) throw new UnauthorizedException('Session expired. Please log in again.'); }
    }
    // A session ends at once when the account is deactivated, logged out by an admin, or its password is reset.
    if (req.user && req.user.id && !req.user.pinFor) {
      const row = await this.db.one('SELECT active, token_version FROM users WHERE id=$1', [req.user.id]);
      if (!row || !row.active || (row.token_version || 0) !== (req.user.tv || 0)) {
        req.user = undefined;
        if (!isPublic) throw new UnauthorizedException('Your session has ended. Please log in again.');
      }
    }
    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException('Please log in.');
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles && !roles.includes(req.user.role)) throw new ForbiddenException('Your role cannot do this.');
    return true;
  }
}

export function requireDesk(user: AuthUser, desk: string) {
  if (user.role !== 'staff' || !user.desks?.includes(desk) || user.desk !== desk) {
    throw new ForbiddenException(`You are not working at the ${desk} desk.`);
  }
}
