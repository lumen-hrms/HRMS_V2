import configuration from './configuration';

describe('documents.scanningEnabled (DOCUMENT_SCANNING_ENABLED)', () => {
  const original = process.env.DOCUMENT_SCANNING_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.DOCUMENT_SCANNING_ENABLED;
    else process.env.DOCUMENT_SCANNING_ENABLED = original;
  });

  it.each([undefined, '', 'true', '1', 'yes', 'flase', 'off'])(
    'stays ON for %p (only an explicit false/0 disables)',
    (value) => {
      if (value === undefined) delete process.env.DOCUMENT_SCANNING_ENABLED;
      else process.env.DOCUMENT_SCANNING_ENABLED = value;
      expect(configuration().documents.scanningEnabled).toBe(true);
    },
  );

  it.each(['false', 'FALSE', ' false ', '0'])('is OFF for %p', (value) => {
    process.env.DOCUMENT_SCANNING_ENABLED = value;
    expect(configuration().documents.scanningEnabled).toBe(false);
  });
});
