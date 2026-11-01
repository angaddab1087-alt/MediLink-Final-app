import * as dotenv from 'dotenv';
dotenv.config();

/** Secrets come only from the environment. A built-in fallback is allowed in demo mode only. */
function requiredSecret(name: string, demoFallback: string): string {
  const v = process.env[name];
  if (v && v.length >= 16) return v;
  if (process.env.DEMO_MODE === 'true') return v || demoFallback;
  throw new Error(`${name} must be set to a random string of at least 16 characters (DEMO_MODE is off).`);
}

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://medilink:medilink@localhost:5432/medilink',
  jwtSecret: requiredSecret('JWT_SECRET', 'dev-jwt-secret-change-me'),
  qrSecret: requiredSecret('QR_SECRET', 'dev-qr-secret-change-me'),
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  visitQrWindowSeconds: 30,
  demoMode: process.env.DEMO_MODE === 'true',
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 120),
  // 10 sign-in attempts a minute per address in production; 60 in demo mode so the view switcher can be used freely during a presentation.
  authLimitPerMinute: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE || (process.env.DEMO_MODE === 'true' ? 60 : 10)),
};
