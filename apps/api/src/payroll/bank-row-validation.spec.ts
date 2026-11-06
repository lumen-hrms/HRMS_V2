import { cleanBeneficiaryName, validateBankRow } from './bank-row-validation';

const ok = { accountNumber: '123456789012', ifsc: 'HDFC0001234', name: 'Asha Rao', amount: 40000 };

describe('validateBankRow', () => {
  it('passes a good row', () => {
    expect(validateBankRow(ok)).toEqual([]);
  });

  it('flags missing details as MISSING', () => {
    const p = validateBankRow({ ...ok, accountNumber: null, ifsc: null });
    expect(p.map((x) => x.kind)).toEqual(['MISSING', 'MISSING']);
  });

  it('flags a malformed account number and IFSC as INVALID', () => {
    const p = validateBankRow({ ...ok, accountNumber: '12AB', ifsc: 'HDFC123' });
    expect(p.map((x) => x.message)).toEqual([
      'Account number must be 9–18 digits',
      'IFSC must be 11 characters, e.g. HDFC0001234',
    ]);
  });

  it('flags zero or negative pay and a name with no usable letters', () => {
    expect(validateBankRow({ ...ok, amount: 0 })[0].message).toMatch(/zero or negative/);
    expect(validateBankRow({ ...ok, name: '12 34' })[0].message).toMatch(/no letters/);
  });
});

describe('cleanBeneficiaryName', () => {
  it('folds accents and drops characters banks reject', () => {
    expect(cleanBeneficiaryName('José Núñez')).toBe('Jose Nunez');
    expect(cleanBeneficiaryName('Rao, Asha "A."')).toBe('Rao Asha A.');
    expect(cleanBeneficiaryName("O'Neil-Smith")).toBe("O'Neil-Smith");
  });
});
