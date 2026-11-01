import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ErrorFilter } from './common/errors';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ErrorFilter());
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableCors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','), credentials: true });
  app.use(json({ limit: '25mb' }));
  await app.listen(config.port, '0.0.0.0');
  console.log(`MediLink API running on http://localhost:${config.port}/api`);
}
bootstrap();
