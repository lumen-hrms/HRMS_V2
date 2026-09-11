import { InternalServerErrorException } from '@nestjs/common';
import { FieldEncryptionService, maskBankAccount, maskPan } from './field-encryption.service';

function buildConfig(fieldKeyBase64?: string) {
  return { get: () => ({ fieldKeyBase64 }) } as any;
}

const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

describe('FieldEncryptionService', () => {
  it('round-trips a value through encrypt/decrypt', () => {
    const service = new FieldEncryptionService(buildConfig(VALID_KEY));
    const ciphertext = service.encrypt('ABCDE1234F');
    expect(ciphertext).not.toContain('ABCDE1234F');
    expect(service.decrypt(ciphertext)).toBe('ABCDE1234F');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const service = new FieldEncryptionService(buildConfig(VALID_KEY));
    expect(service.encrypt('same-value')).not.toBe(service.encrypt('same-value'));
  });

  it('throws when FIELD_ENCRYPTION_KEY is not configured', () => {
    const service = new FieldEncryptionService(buildConfig(undefined));
    expect(() => service.encrypt('x')).toThrow(InternalServerErrorException);
  });

  it('throws when FIELD_ENCRYPTION_KEY is the wrong length', () => {
    const service = new FieldEncryptionService(buildConfig(Buffer.alloc(16).toString('base64')));
    expect(() => service.encrypt('x')).toThrow(InternalServerErrorException);
  });

  it('rejects a tampered ciphertext (auth tag mismatch)', () => {
    const service = new FieldEncryptionService(buildConfig(VALID_KEY));
    const ciphertext = service.encrypt('secret');
    const parts = ciphertext.split(':');
    parts[3] = Buffer.from('tampered-bytes-here').toString('base64');
    expect(() => service.decrypt(parts.join(':'))).toThrow();
  });
});

describe('maskPan', () => {
  it('masks the middle 4 characters of a 10-char PAN', () => {
    expect(maskPan('ABCDE1234F')).toBe('ABCDE****F');
  });
});

describe('maskBankAccount', () => {
  it('keeps only the last 4 digits visible', () => {
    expect(maskBankAccount('123456781234')).toBe('••••1234');
  });
});
