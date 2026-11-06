/**
 * Module 08 (Statutory Compliance) will own real investment declarations
 * (`InvestmentDeclaration`, already spec'd there). Payroll's TDS projection
 * only reads a declared/verified exemption total through this interface so
 * Phase 6 doesn't block on that module (module 07 §9 Phase 6, §12 "Still
 * open"). Swap the `DECLARATION_PROVIDER` binding in `payroll.module.ts` to
 * a real implementation once module 08's declaration workflow exists —
 * nothing in Payroll's TDS code needs to change.
 */
export interface DeclarationProvider {
  /**
   * Total declared/verified exemption amount (80C/80D/etc.) for the OLD
   * regime, for this employee and financial year. Never called for an
   * employee on the NEW regime. 0 if nothing is on file.
   */
  getDeclaredExemptions(employeeId: string, financialYear: string): Promise<number>;
}

/** The default until module 08 exists: no declaration on file for anyone. */
export class NullDeclarationProvider implements DeclarationProvider {
  async getDeclaredExemptions(): Promise<number> {
    return 0;
  }
}

export const DECLARATION_PROVIDER = Symbol('DECLARATION_PROVIDER');
