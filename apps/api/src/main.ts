import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`HRMS API listening on http://localhost:${port}/api`);
}

bootstrap();
