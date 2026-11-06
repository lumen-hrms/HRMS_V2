/**
 * Roster for the "demo" sales-demo tenant (`seed-demo-org.ts`): a ~40-person
 * company, 5 levels deep across 7 departments, with the contact/location/
 * tenure fields the org chart's hover card shows. Pure data — no side
 * effects on import, so the web app's org-chart preview can reuse it too.
 *
 * Phone numbers are made-up in a fixed pattern; emails are built from
 * `DEMO_EMAIL_DOMAIN` by the seed script.
 */

export type DemoRole = 'COMPANY_ADMIN' | 'HR_MANAGER' | 'LINE_MANAGER' | 'EMPLOYEE' | 'AUDITOR';
export type DemoLifecycle = 'PRE_JOINING' | 'PROBATION' | 'CONFIRMED' | 'NOTICE_PERIOD';

export interface DemoPerson {
  code: string;
  first: string;
  last: string;
  designation: string;
  dept: string;
  managerCode?: string;
  role: DemoRole;
  location: string;
  /** ISO date (yyyy-mm-dd). */
  joined: string;
  lifecycle?: DemoLifecycle;
}

export const DEMO_TENANT = { name: 'Zenith Labs Pvt Ltd', subdomain: 'demo' };

const BLR = 'Bengaluru HQ';
const MUM = 'Mumbai';
const DEL = 'Delhi NCR';
const CHN = 'Chennai';
const PUN = 'Pune';
const REMOTE = 'Remote';

export const DEMO_ROSTER: DemoPerson[] = [
  { code: 'ZEN-001', first: 'Aarav', last: 'Mehta', designation: 'Chief Executive Officer', dept: 'Leadership', role: 'COMPANY_ADMIN', location: BLR, joined: '2018-04-02' },

  // Engineering
  { code: 'ZEN-002', first: 'Nisha', last: 'Kapoor', designation: 'Chief Technology Officer', dept: 'Engineering', managerCode: 'ZEN-001', role: 'LINE_MANAGER', location: BLR, joined: '2018-06-11' },
  { code: 'ZEN-003', first: 'Rohan', last: 'Iyer', designation: 'Engineering Manager, Platform', dept: 'Engineering', managerCode: 'ZEN-002', role: 'LINE_MANAGER', location: BLR, joined: '2019-08-19' },
  { code: 'ZEN-004', first: 'Karthik', last: 'Reddy', designation: 'Senior Backend Engineer', dept: 'Engineering', managerCode: 'ZEN-003', role: 'EMPLOYEE', location: BLR, joined: '2020-01-06' },
  { code: 'ZEN-005', first: 'Pooja', last: 'Nair', designation: 'Backend Engineer', dept: 'Engineering', managerCode: 'ZEN-003', role: 'EMPLOYEE', location: REMOTE, joined: '2022-07-18' },
  { code: 'ZEN-006', first: 'Arjun', last: 'Bhat', designation: 'DevOps Engineer', dept: 'Engineering', managerCode: 'ZEN-003', role: 'EMPLOYEE', location: PUN, joined: '2021-03-01' },
  { code: 'ZEN-007', first: 'Fatima', last: 'Sheikh', designation: 'Backend Engineer', dept: 'Engineering', managerCode: 'ZEN-003', role: 'EMPLOYEE', location: BLR, joined: '2026-07-14', lifecycle: 'PROBATION' },
  { code: 'ZEN-008', first: 'Sana', last: 'Qureshi', designation: 'Engineering Manager, Product', dept: 'Engineering', managerCode: 'ZEN-002', role: 'LINE_MANAGER', location: BLR, joined: '2019-11-04' },
  { code: 'ZEN-009', first: 'Vivek', last: 'Sharma', designation: 'Senior Frontend Engineer', dept: 'Engineering', managerCode: 'ZEN-008', role: 'EMPLOYEE', location: BLR, joined: '2020-09-14' },
  { code: 'ZEN-010', first: 'Ishita', last: 'Ghosh', designation: 'Frontend Engineer', dept: 'Engineering', managerCode: 'ZEN-008', role: 'EMPLOYEE', location: REMOTE, joined: '2023-02-20' },
  { code: 'ZEN-011', first: 'Aditya', last: 'Rao', designation: 'Mobile Engineer', dept: 'Engineering', managerCode: 'ZEN-008', role: 'EMPLOYEE', location: PUN, joined: '2022-10-03' },
  { code: 'ZEN-012', first: 'Meghna', last: 'Das', designation: 'QA Lead', dept: 'Engineering', managerCode: 'ZEN-002', role: 'LINE_MANAGER', location: BLR, joined: '2020-05-25' },
  { code: 'ZEN-013', first: 'Harsh', last: 'Patel', designation: 'QA Engineer', dept: 'Engineering', managerCode: 'ZEN-012', role: 'EMPLOYEE', location: BLR, joined: '2023-06-12' },
  { code: 'ZEN-014', first: 'Lavanya', last: 'Krishnan', designation: 'QA Engineer', dept: 'Engineering', managerCode: 'ZEN-012', role: 'EMPLOYEE', location: CHN, joined: '2026-11-03', lifecycle: 'PRE_JOINING' },

  // Finance
  { code: 'ZEN-015', first: 'Rajesh', last: 'Menon', designation: 'Chief Financial Officer', dept: 'Finance', managerCode: 'ZEN-001', role: 'LINE_MANAGER', location: MUM, joined: '2019-01-14' },
  { code: 'ZEN-016', first: 'Anjali', last: 'Verma', designation: 'Finance Manager', dept: 'Finance', managerCode: 'ZEN-015', role: 'LINE_MANAGER', location: MUM, joined: '2020-08-03' },
  { code: 'ZEN-017', first: 'Siddharth', last: 'Jain', designation: 'Accountant', dept: 'Finance', managerCode: 'ZEN-016', role: 'EMPLOYEE', location: MUM, joined: '2022-04-11' },
  { code: 'ZEN-018', first: 'Priyanka', last: 'Bose', designation: 'Payroll Specialist', dept: 'Finance', managerCode: 'ZEN-016', role: 'EMPLOYEE', location: MUM, joined: '2021-12-06' },

  // People
  { code: 'ZEN-019', first: 'Kavya', last: 'Reddy', designation: 'VP, People', dept: 'People', managerCode: 'ZEN-001', role: 'HR_MANAGER', location: BLR, joined: '2019-03-18' },
  { code: 'ZEN-020', first: 'Neha', last: 'Joshi', designation: 'HR Business Partner', dept: 'People', managerCode: 'ZEN-019', role: 'HR_MANAGER', location: BLR, joined: '2021-01-11' },
  { code: 'ZEN-021', first: 'Imran', last: 'Khan', designation: 'Talent Acquisition Lead', dept: 'People', managerCode: 'ZEN-019', role: 'LINE_MANAGER', location: BLR, joined: '2020-10-19' },
  { code: 'ZEN-022', first: 'Ritu', last: 'Singh', designation: 'Recruiter', dept: 'People', managerCode: 'ZEN-021', role: 'EMPLOYEE', location: DEL, joined: '2023-09-04' },
  { code: 'ZEN-023', first: 'Manish', last: 'Gupta', designation: 'Recruiter', dept: 'People', managerCode: 'ZEN-021', role: 'EMPLOYEE', location: BLR, joined: '2024-02-12' },

  // Sales
  { code: 'ZEN-024', first: 'Vikram', last: 'Singh', designation: 'VP, Sales', dept: 'Sales', managerCode: 'ZEN-001', role: 'LINE_MANAGER', location: DEL, joined: '2019-07-08' },
  { code: 'ZEN-025', first: 'Deepak', last: 'Chauhan', designation: 'Sales Manager, North', dept: 'Sales', managerCode: 'ZEN-024', role: 'LINE_MANAGER', location: DEL, joined: '2020-11-16' },
  { code: 'ZEN-026', first: 'Ayesha', last: 'Siddiqui', designation: 'Account Executive', dept: 'Sales', managerCode: 'ZEN-025', role: 'EMPLOYEE', location: DEL, joined: '2022-01-17' },
  { code: 'ZEN-027', first: 'Rahul', last: 'Saxena', designation: 'Account Executive', dept: 'Sales', managerCode: 'ZEN-025', role: 'EMPLOYEE', location: DEL, joined: '2023-03-06' },
  { code: 'ZEN-028', first: 'Tanvi', last: 'Malhotra', designation: 'Sales Development Rep', dept: 'Sales', managerCode: 'ZEN-025', role: 'EMPLOYEE', location: DEL, joined: '2024-06-03' },
  { code: 'ZEN-029', first: 'Gaurav', last: 'Arora', designation: 'Sales Development Rep', dept: 'Sales', managerCode: 'ZEN-025', role: 'EMPLOYEE', location: DEL, joined: '2025-01-13' },
  { code: 'ZEN-030', first: 'Shreya', last: 'Pillai', designation: 'Sales Manager, South', dept: 'Sales', managerCode: 'ZEN-024', role: 'LINE_MANAGER', location: CHN, joined: '2021-02-08' },
  { code: 'ZEN-031', first: 'Naveen', last: 'Kumar', designation: 'Account Executive', dept: 'Sales', managerCode: 'ZEN-030', role: 'EMPLOYEE', location: CHN, joined: '2022-08-22' },
  { code: 'ZEN-032', first: 'Divya', last: 'Menon', designation: 'Account Executive', dept: 'Sales', managerCode: 'ZEN-030', role: 'EMPLOYEE', location: CHN, joined: '2021-06-14', lifecycle: 'NOTICE_PERIOD' },

  // Product
  { code: 'ZEN-033', first: 'Ananya', last: 'Desai', designation: 'Head of Product', dept: 'Product', managerCode: 'ZEN-001', role: 'LINE_MANAGER', location: BLR, joined: '2019-09-23' },
  { code: 'ZEN-034', first: 'Kunal', last: 'Shah', designation: 'Product Manager', dept: 'Product', managerCode: 'ZEN-033', role: 'EMPLOYEE', location: MUM, joined: '2021-04-05' },
  { code: 'ZEN-035', first: 'Riya', last: 'Banerjee', designation: 'Product Designer', dept: 'Product', managerCode: 'ZEN-033', role: 'EMPLOYEE', location: BLR, joined: '2022-03-14' },
  { code: 'ZEN-036', first: 'Omkar', last: 'Kulkarni', designation: 'UX Researcher', dept: 'Product', managerCode: 'ZEN-033', role: 'EMPLOYEE', location: PUN, joined: '2023-11-20' },

  // Customer Success
  { code: 'ZEN-037', first: 'Maya', last: 'Fernandes', designation: 'Head of Customer Success', dept: 'Customer Success', managerCode: 'ZEN-001', role: 'LINE_MANAGER', location: MUM, joined: '2020-02-17' },
  { code: 'ZEN-038', first: 'Abhishek', last: 'Yadav', designation: 'Customer Success Manager', dept: 'Customer Success', managerCode: 'ZEN-037', role: 'EMPLOYEE', location: MUM, joined: '2022-05-09' },
  { code: 'ZEN-039', first: 'Sneha', last: 'Kulkarni', designation: 'Support Engineer', dept: 'Customer Success', managerCode: 'ZEN-037', role: 'EMPLOYEE', location: PUN, joined: '2023-08-28' },
  { code: 'ZEN-040', first: 'Farhan', last: 'Ali', designation: 'Support Engineer', dept: 'Customer Success', managerCode: 'ZEN-037', role: 'EMPLOYEE', location: REMOTE, joined: '2025-04-07' },
];

/** Deterministic, obviously-generated mobile number per employee code. */
export function demoPhone(code: string) {
  const n = Number(code.replace(/\D/g, ''));
  return `+91 98450 ${String(10000 + n * 137).padStart(5, '0')}`;
}

export function demoEmail(p: Pick<DemoPerson, 'first' | 'last'>, domain: string) {
  return `${p.first}.${p.last}@${domain}`.toLowerCase();
}
