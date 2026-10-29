import { IndianState } from '@prisma/client';

/**
 * Company profile rules, shared by `PATCH /api/tenant-config/company-profile`
 * and company setup's Company step so both reject exactly the same input.
 */
export interface CompanyProfileInput {
  legalName?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  city?: string;
  state?: string;
  pincode?: string;
  contactEmail?: string;
  contactPhone?: string;
  gstin?: string | null;
  cin?: string | null;
}

export const PINCODE_PATTERN = /^[1-9]\d{5}$/;
export const PHONE_PATTERN = /^(\+91[\s-]?)?[6-9]\d{9}$/;
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const CIN_PATTERN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATES = new Set<string>(Object.values(IndianState));

/** Field → message for every problem; empty when the profile is complete and valid. */
export function companyProfileErrors(p: CompanyProfileInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const required: [keyof CompanyProfileInput, string][] = [
    ['legalName', 'Legal name'],
    ['addressLine1', 'Address'],
    ['city', 'City'],
    ['state', 'State'],
    ['pincode', 'PIN code'],
    ['contactEmail', 'Contact email'],
    ['contactPhone', 'Contact phone'],
  ];
  for (const [field, label] of required) {
    if (!String(p[field] ?? '').trim()) errors[field] = `${label} is required`;
  }
  if (p.state && !STATES.has(p.state)) errors.state = 'Pick a state from the list';
  if (p.pincode && !PINCODE_PATTERN.test(p.pincode.trim())) {
    errors.pincode = 'PIN code must be 6 digits';
  }
  if (p.contactEmail && !EMAIL_PATTERN.test(p.contactEmail.trim())) {
    errors.contactEmail = 'Enter a valid email address';
  }
  if (p.contactPhone && !PHONE_PATTERN.test(p.contactPhone.replace(/\s/g, ''))) {
    errors.contactPhone = 'Enter a 10-digit Indian mobile number';
  }
  if (p.gstin && !GSTIN_PATTERN.test(p.gstin.trim().toUpperCase())) {
    errors.gstin = 'GSTIN must be 15 characters, e.g. 27AAPFU0939F1ZV';
  }
  if (p.cin && !CIN_PATTERN.test(p.cin.trim().toUpperCase())) {
    errors.cin = 'CIN must be 21 characters, e.g. U72200MH2009PTC123456';
  }
  return errors;
}

/** Trimmed, upper-cased where it matters, blanks → null — the shape written to the DB. */
export function normalizeCompanyProfile(p: CompanyProfileInput) {
  const opt = (v?: string | null) => (v && v.trim() ? v.trim() : null);
  return {
    legalName: p.legalName!.trim(),
    addressLine1: p.addressLine1!.trim(),
    addressLine2: opt(p.addressLine2),
    city: p.city!.trim(),
    state: p.state as IndianState,
    pincode: p.pincode!.trim(),
    contactEmail: p.contactEmail!.trim().toLowerCase(),
    contactPhone: p.contactPhone!.replace(/\s/g, ''),
    gstin: opt(p.gstin)?.toUpperCase() ?? null,
    cin: opt(p.cin)?.toUpperCase() ?? null,
  };
}
