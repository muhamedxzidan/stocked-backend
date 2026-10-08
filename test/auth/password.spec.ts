import { PasswordService } from '../../src/auth/password.service.js';

describe('Password policy and storage', () => {
  const service = new PasswordService();
  beforeAll(async () => {
    await service.onModuleInit();
  });
  it('hashes using the agreed Argon2id parameters and verifies without trimming', async () => {
    const password = '  Warehouse phrase number 742  ';
    const encoded = await service.hash(password);
    expect(encoded).toMatch(/^\$argon2id\$v=19\$/);
    expect(encoded.split('$')[3].split(',').sort()).toEqual([
      'm=19456',
      'p=1',
      't=2',
    ]);
    expect(encoded).not.toContain(password);
    expect(await service.verify(password, encoded)).toBe(true);
    expect(await service.verify(password.trim(), encoded)).toBe(false);
  });
  it('counts Unicode characters and enforces both limits', () => {
    expect(() => service.validate('😀'.repeat(15))).not.toThrow();
    expect(() => service.validate('😀'.repeat(128))).not.toThrow();
    expect(() => service.validate('😀'.repeat(14))).toThrow();
    expect(() => service.validate('😀'.repeat(129))).toThrow();
  });
  it('rejects a long common password present in the pinned list', () => {
    expect(() => service.validate('FILMS+PIC+GALERIES')).toThrow('less common');
  });
  it('unknown account uses a dummy hash and rejects incorrect or malformed hashes', async () => {
    expect(await service.verify('Not the randomly generated dummy')).toBe(
      false,
    );
    expect(await service.verify('Not a password', 'broken-hash')).toBe(false);
  });
});
