import {
  bankNameFromIfsc,
  expectedPrefix,
  ifscPrefix,
  resolvePaymentMode,
  IFSC_PATTERN,
} from './bank-codes';

describe('IFSC helpers', () => {
  it('reads the bank prefix and name', () => {
    expect(ifscPrefix(' hdfc0001234 ')).toBe('HDFC');
    expect(bankNameFromIfsc('UTIB0000123')).toBe('Axis Bank');
    expect(bankNameFromIfsc('ZZZZ0000123')).toBeNull();
  });

  it('knows the IFSC prefix each launch bank must have', () => {
    expect(expectedPrefix('ICICI')).toBe('ICIC');
    expect(expectedPrefix('AXIS')).toBe('UTIB');
    expect(expectedPrefix('SBI')).toBe('SBIN');
    expect(expectedPrefix('HDFC')).toBe('HDFC');
    expect(expectedPrefix('HSBC')).toBe('HSBC');
    expect(expectedPrefix('OTHER')).toBeNull();
  });

  it('accepts a well-formed IFSC and rejects the rest', () => {
    expect(IFSC_PATTERN.test('HDFC0001234')).toBe(true);
    expect(IFSC_PATTERN.test('HDFC1001234')).toBe(false); // 5th char must be 0
    expect(IFSC_PATTERN.test('HDF0001234')).toBe(false);
  });
});

describe('resolvePaymentMode', () => {
  it('is own-bank when the employee banks with the company bank', () => {
    expect(resolvePaymentMode('HDFC0000001', 'HDFC0009999', 50000, 'NEFT')).toBe('OWN_BANK');
  });

  it('uses the preferred mode for other banks', () => {
    expect(resolvePaymentMode('HDFC0000001', 'SBIN0000001', 50000, 'NEFT')).toBe('NEFT');
    expect(resolvePaymentMode('HDFC0000001', 'SBIN0000001', 50000, 'IMPS')).toBe('IMPS');
  });

  it('steps RTGS down to NEFT below ₹2,00,000 and IMPS down above ₹5,00,000', () => {
    expect(resolvePaymentMode('HDFC0000001', 'SBIN0000001', 199999, 'RTGS')).toBe('NEFT');
    expect(resolvePaymentMode('HDFC0000001', 'SBIN0000001', 200000, 'RTGS')).toBe('RTGS');
    expect(resolvePaymentMode('HDFC0000001', 'SBIN0000001', 500001, 'IMPS')).toBe('NEFT');
  });

  it('treats everyone as another-bank when the company bank is unknown', () => {
    expect(resolvePaymentMode(null, 'HDFC0000001', 1000, 'NEFT')).toBe('NEFT');
  });
});
