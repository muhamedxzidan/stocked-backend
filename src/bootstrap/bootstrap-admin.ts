import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PrismaModule } from '../database/prisma.module.js';
import { PasswordService } from '../auth/password.service.js';
import { SecurityAuditService } from '../auth/security-audit.service.js';
import { BootstrapAdminService } from './bootstrap-admin.service.js';
import { passwordPrompt } from './password-prompt.js';
@Module({
  imports: [PrismaModule],
  providers: [PasswordService, SecurityAuditService, BootstrapAdminService],
})
class BootstrapModule {}

async function bootstrap(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error('Interactive terminal required');
  const input = createInterface({ input: stdin, output: stdout });
  let email: string;
  let displayName: string;
  try {
    email = await input.question('Admin email: ');
    displayName = await input.question('Display name: ');
  } finally {
    input.close();
  }
  const password = await passwordPrompt(
    'Password (hidden, 15–128 characters): ',
  );
  const confirmation = await passwordPrompt('Confirm password (hidden): ');
  if (password !== confirmation) throw new Error('Passwords do not match');
  const app = await NestFactory.createApplicationContext(BootstrapModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    await app.get(BootstrapAdminService).create(email, displayName, password);
    stdout.write(
      'First admin created. Change the password after signing in.\n',
    );
  } finally {
    await app.close();
  }
}
try {
  await bootstrap();
} catch (error) {
  // Known validation errors are safe; never print database errors/configuration.
  const safe =
    error instanceof Error &&
    ['BadRequestException', 'ConflictException'].includes(error.name);
  console.error(
    safe
      ? error.message
      : 'Admin bootstrap failed. Check configuration and input; no credentials were logged.',
  );
  process.exitCode = 1;
}
