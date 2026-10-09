import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, type Request, type Response, type NextFunction } from 'express';
import { Environment } from '../config/environment.js';
import { ApiExceptionFilter } from './api-exception.filter.js';

export function configureHttp(app: INestApplication): void {
  const environment = app.get(Environment);
  app.setGlobalPrefix('api/v1');
  app
    .getHttpAdapter()
    .getInstance()
    .set(
      'trust proxy',
      environment.trustedProxies.length ? environment.trustedProxies : false,
    );
  app.use(helmet());
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(json({ limit: '16kb' }));
  // Browser integration is a later explicit cookie/CSRF slice. No wildcard CORS.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  if (!environment.production) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Stocked Backend')
        .setDescription(
          'Stocked API: bearer sessions, merchant-owned catalog, receipts, inventory, stock adjustments and shipment milestones.',
        )
        .setVersion('1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer' })
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: false },
    });
  }
}
