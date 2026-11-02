import { phoneError, splitPhone } from './phone';

describe('phoneError', () => {
  it('accepts valid numbers for several countries', () => {
    for (const n of [
      '+919876543210',
      '+12025550123',
      '+447912345678',
      '+971501234567',
      '+6591234567',
      '+61412345678',
    ]) {
      expect(phoneError(n)).toBeUndefined();
    }
  });

  it('rejects numbers that break a country rule', () => {
    expect(phoneError('+915876543210')).toMatch(/India/); // must start 6-9
    expect(phoneError('+91987654321')).toMatch(/India/); // 9 digits
    expect(phoneError('+11025550123')).toMatch(/United States/); // area code can't start with 1
    expect(phoneError('+6511234567')).toMatch(/Singapore/);
  });

  it('treats a number without a + (older data) as Indian and ignores spacing', () => {
    expect(phoneError('98765 43210')).toBeUndefined();
    expect(phoneError('12345')).toMatch(/India/);
  });

  it('reads the longest matching dial code', () => {
    expect(splitPhone('+971501234567')).toEqual({ country: 'AE', national: '501234567' });
  });

  it('treats empty as no error (required-ness is checked elsewhere)', () => {
    expect(phoneError('')).toBeUndefined();
  });
});
