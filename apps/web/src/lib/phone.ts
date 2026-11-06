/**
 * Phone numbers are stored as `+<dial code><national digits>` (e.g. +919876543210).
 * Keep the COUNTRIES table identical to `apps/api/src/common/phone.ts`.
 *
 * Rules are on the national number (no leading trunk 0, digits only). Well-known
 * markets get their numbering-plan pattern; the rest use a sane length range.
 */
export interface PhoneCountry {
  code: string;
  name: string;
  dial: string;
  re: RegExp;
  /** Shown when the number doesn't match. */
  hint: string;
}

export const COUNTRIES: PhoneCountry[] = [
  { code: 'IN', name: 'India', dial: '91', re: /^[6-9]\d{9}$/, hint: '10 digits, starting with 6-9' },
  { code: 'US', name: 'United States / Canada', dial: '1', re: /^[2-9]\d{2}[2-9]\d{6}$/, hint: '10 digits, e.g. 2025550123' },
  { code: 'GB', name: 'United Kingdom', dial: '44', re: /^(7\d{9}|[1-3]\d{8,9})$/, hint: '10 digits without the leading 0' },
  { code: 'AE', name: 'United Arab Emirates', dial: '971', re: /^(5\d{8}|[2-467]\d{7})$/, hint: 'e.g. 501234567' },
  { code: 'SA', name: 'Saudi Arabia', dial: '966', re: /^(5\d{8}|1[1-467]\d{7})$/, hint: 'e.g. 512345678' },
  { code: 'QA', name: 'Qatar', dial: '974', re: /^[3-7]\d{7}$/, hint: '8 digits' },
  { code: 'KW', name: 'Kuwait', dial: '965', re: /^[569]\d{7}$/, hint: '8 digits' },
  { code: 'OM', name: 'Oman', dial: '968', re: /^[79]\d{7}$/, hint: '8 digits' },
  { code: 'BH', name: 'Bahrain', dial: '973', re: /^[36]\d{7}$/, hint: '8 digits' },
  { code: 'SG', name: 'Singapore', dial: '65', re: /^[3689]\d{7}$/, hint: '8 digits' },
  { code: 'MY', name: 'Malaysia', dial: '60', re: /^[1-9]\d{7,9}$/, hint: '8-10 digits without the leading 0' },
  { code: 'ID', name: 'Indonesia', dial: '62', re: /^8\d{8,11}$/, hint: '9-12 digits, starting with 8' },
  { code: 'PH', name: 'Philippines', dial: '63', re: /^9\d{9}$/, hint: '10 digits, starting with 9' },
  { code: 'AU', name: 'Australia', dial: '61', re: /^[2-478]\d{8}$/, hint: '9 digits without the leading 0' },
  { code: 'NZ', name: 'New Zealand', dial: '64', re: /^[2-9]\d{7,9}$/, hint: '8-10 digits without the leading 0' },
  { code: 'DE', name: 'Germany', dial: '49', re: /^1[5-7]\d{8,9}$|^[2-9]\d{6,11}$/, hint: 'without the leading 0' },
  { code: 'FR', name: 'France', dial: '33', re: /^[1-9]\d{8}$/, hint: '9 digits without the leading 0' },
  { code: 'ES', name: 'Spain', dial: '34', re: /^[6-9]\d{8}$/, hint: '9 digits' },
  { code: 'IT', name: 'Italy', dial: '39', re: /^(3\d{8,9}|0\d{5,10})$/, hint: 'e.g. 3123456789' },
  { code: 'BR', name: 'Brazil', dial: '55', re: /^[1-9]{2}9?\d{8}$/, hint: 'area code + 8-9 digits' },
  { code: 'ZA', name: 'South Africa', dial: '27', re: /^[1-8]\d{8}$/, hint: '9 digits without the leading 0' },
  { code: 'NG', name: 'Nigeria', dial: '234', re: /^[789]\d{9}$/, hint: '10 digits without the leading 0' },
  { code: 'KE', name: 'Kenya', dial: '254', re: /^[17]\d{8}$/, hint: '9 digits without the leading 0' },
  { code: 'JP', name: 'Japan', dial: '81', re: /^[1-9]\d{8,9}$/, hint: '9-10 digits without the leading 0' },
  { code: 'CN', name: 'China', dial: '86', re: /^(1[3-9]\d{9}|[2-9]\d{8,10})$/, hint: '11-digit mobile, starting with 1' },
  { code: 'BD', name: 'Bangladesh', dial: '880', re: /^1[3-9]\d{8}$/, hint: '10 digits, starting with 1' },
  { code: 'PK', name: 'Pakistan', dial: '92', re: /^3\d{9}$/, hint: '10 digits, starting with 3' },
  { code: 'LK', name: 'Sri Lanka', dial: '94', re: /^[1-9]\d{8}$/, hint: '9 digits without the leading 0' },
  { code: 'NP', name: 'Nepal', dial: '977', re: /^(9[78]\d{8}|[1-9]\d{7})$/, hint: '10-digit mobile, starting with 97/98' },
];

export const DEFAULT_COUNTRY = 'IN';

const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
// Longest dial code first so +971 is never read as +9.
const byDialLongestFirst = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

export function countryByCode(code: string): PhoneCountry {
  return byCode.get(code) ?? byCode.get(DEFAULT_COUNTRY)!;
}

/** Splits a stored value. A value with no `+` (older data) is read as a national number of the default country. */
export function splitPhone(value: string): { country: string; national: string } {
  const v = value.replace(/[\s\-().]/g, '');
  if (v.startsWith('+')) {
    const digits = v.slice(1);
    const c = byDialLongestFirst.find((x) => digits.startsWith(x.dial));
    if (c) return { country: c.code, national: digits.slice(c.dial.length) };
    return { country: DEFAULT_COUNTRY, national: digits };
  }
  return { country: DEFAULT_COUNTRY, national: v.replace(/^0+/, '') };
}

export function joinPhone(country: string, national: string): string {
  const digits = national.replace(/\D/g, '');
  return digits ? `+${countryByCode(country).dial}${digits}` : '';
}

/** Error message, or undefined when the value is empty or valid. */
export function phoneError(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const { country, national } = splitPhone(value);
  const c = countryByCode(country);
  return c.re.test(national) ? undefined : `Enter a valid ${c.name} number (${c.hint})`;
}
