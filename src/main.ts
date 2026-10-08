import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { Environment } from './config/environment.js';
import { configureHttp } from './http/configure-http.js';
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    abortOnError: false,
  });
  configureHttp(app);
  app.enableShutdownHooks();
  const environment = app.get(Environment);
  await app.listen(environment.port, environment.host);
}
try {
  await bootstrap();
} catch {
  console.error(
    'Backend startup failed. Check environment and database connectivity.',
  );
  process.exitCode = 1;
}
