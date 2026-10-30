import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { backgroundWorkersEnabled } from './common/background-workers';
import { AppLogger } from './common/logging/app-logger';
import {
  ErrorReasonFilter,
  HandlerNameInterceptor,
  requestLogging,
} from './common/logging/request-logging';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Razorpay webhook signatures are computed over the exact raw bytes.
    rawBody: true,
    logger: new AppLogger(),
  });
  const logger = new Logger('Bootstrap');

  // Behind CloudFront + the ALB in production; trust the first proxy hop so
  // `req.ip` is the real client address (used for the login audit trail),
  // not the load balancer's.
  app.set('trust proxy', 1);

  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api');
  app.use(requestLogging);
  app.useGlobalInterceptors(new HandlerNameInterceptor());
  app.useGlobalFilters(new ErrorReasonFilter(app.getHttpAdapter()));

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
  logger.log(`HRMS API listening on http://localhost:${port}/api`);
  logger.log(
    backgroundWorkersEnabled()
      ? 'Background workers: ON (emails, document scans, scheduled jobs run here)'
      : 'Background workers: OFF (NODE_ENV=development) — set WORKERS_ENABLED=true to run them here',
  );
}

bootstrap();
