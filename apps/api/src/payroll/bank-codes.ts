/**
 * IFSC → bank lookups and own-bank/other-bank payment-mode rules for the bank
 * advice file. An IFSC is 4 letters (bank), a literal 0, then 6 characters
 * (branch). Limits below are the usual NEFT/RTGS/IMPS rules — confirm them
 * against your bank's current terms.
 */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/;

export type PaymentMode = 'OWN_BANK' | 'NEFT' | 'IMPS' | 'RTGS';
export type PreferredMode = Exclude<PaymentMode, 'OWN_BANK'>;
export const PREFERRED_MODES: PreferredMode[] = ['NEFT', 'IMPS', 'RTGS'];

/** RTGS only accepts ₹2,00,000 and above; IMPS tops out at ₹5,00,000. */
export const RTGS_MIN = 200_000;
export const IMPS_MAX = 500_000;

/** Banks a company can pay salaries from (the launch list). */
export const COMPANY_BANKS = [
  { code: 'ICICI', label: 'ICICI Bank', ifscPrefix: 'ICIC' },
  { code: 'AXIS', label: 'Axis Bank', ifscPrefix: 'UTIB' },
  { code: 'SBI', label: 'State Bank of India', ifscPrefix: 'SBIN' },
  { code: 'HDFC', label: 'HDFC Bank', ifscPrefix: 'HDFC' },
  { code: 'HSBC', label: 'HSBC', ifscPrefix: 'HSBC' },
  { code: 'OTHER', label: 'Another bank', ifscPrefix: null },
] as const;
export type CompanyBankCode = (typeof COMPANY_BANKS)[number]['code'];
export const COMPANY_BANK_CODES = COMPANY_BANKS.map((b) => b.code) as CompanyBankCode[];

/** IFSC prefix → bank name, for labelling employees' banks. */
const IFSC_PREFIX_NAMES: Record<string, string> = {
  ICIC: 'ICICI Bank',
  UTIB: 'Axis Bank',
  SBIN: 'State Bank of India',
  HDFC: 'HDFC Bank',
  HSBC: 'HSBC',
  KKBK: 'Kotak Mahindra Bank',
  YESB: 'Yes Bank',
  BARB: 'Bank of Baroda',
  PUNB: 'Punjab National Bank',
  CNRB: 'Canara Bank',
  UBIN: 'Union Bank of India',
  IDIB: 'Indian Bank',
  INDB: 'IndusInd Bank',
  FDRL: 'Federal Bank',
  IBKL: 'IDBI Bank',
  BKID: 'Bank of India',
  MAHB: 'Bank of Maharashtra',
  CBIN: 'Central Bank of India',
  RATN: 'RBL Bank',
};

export const ifscPrefix = (ifsc: string) => ifsc.trim().toUpperCase().slice(0, 4);

export function bankNameFromIfsc(ifsc: string): string | null {
  return IFSC_PREFIX_NAMES[ifscPrefix(ifsc)] ?? null;
}

/** The IFSC prefix a company bank choice should match (null for "another bank"). */
export function expectedPrefix(code: string): string | null {
  return COMPANY_BANKS.find((b) => b.code === code)?.ifscPrefix ?? null;
}

/**
 * Same bank as the company's account → own-bank transfer. Otherwise the
 * company's preferred mode, stepping down to NEFT when the amount is outside
 * that mode's limits.
 */
export function resolvePaymentMode(
  companyIfsc: string | null,
  employeeIfsc: string,
  amount: number,
  preferred: PreferredMode = 'NEFT',
): PaymentMode {
  if (companyIfsc && ifscPrefix(companyIfsc) === ifscPrefix(employeeIfsc)) return 'OWN_BANK';
  if (preferred === 'RTGS' && amount < RTGS_MIN) return 'NEFT';
  if (preferred === 'IMPS' && amount > IMPS_MAX) return 'NEFT';
  return preferred;
}
