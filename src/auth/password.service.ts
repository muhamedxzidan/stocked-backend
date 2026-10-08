import {
  BadRequestException,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  } as const;
  private commonPasswords = new Set<string>();
  private dummyHash = '';
  async onModuleInit(): Promise<void> {
    const text = await readFile(
      new URL('./data/common-passwords.txt', import.meta.url),
      'utf8',
    );
    this.commonPasswords = new Set(
      text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((value) => value.toLowerCase()),
    );
    if (this.commonPasswords.size < 9000)
      throw new Error('Common password list is missing or incomplete');
    this.dummyHash = await argon2.hash(randomBytes(32), this.options);
  }
  validate(password: string): void {
    const length = Array.from(password).length;
    if (length < 15 || length > 128)
      throw new BadRequestException(
        'Password must contain 15 to 128 characters',
      );
    if (this.commonPasswords.has(password.toLowerCase()))
      throw new BadRequestException('Choose a less common password');
  }
  async hash(password: string): Promise<string> {
    this.validate(password);
    return argon2.hash(password, this.options);
  }
  async verify(password: string, encoded?: string): Promise<boolean> {
    try {
      return await argon2.verify(encoded ?? this.dummyHash, password);
    } catch {
      return false;
    }
  }
}
