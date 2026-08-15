/**
 * Port — how OTHER modules read employee data without importing the HR module's
 * internals. Consumers depend ONLY on this interface + token; the hr-employee
 * module owns the implementation (see modules/hr-employee/employee-lookup.adapter.ts)
 * and registers it in contracts/contracts.module.ts.
 *
 * Its first consumer is the User module, which has to answer one question before
 * it will create a login: is there an employee behind this account? Logins are
 * set up from Employee Master, so every account names the person who holds it —
 * and "does that person exist, and do they still work here" is a fact about the
 * HR master, not something the User service may read for itself.
 *
 * Rules (the same as every other port here):
 *   - Never widen this with Prisma types or full entities.
 *   - Methods are async even where today's implementation is synchronous.
 */

/** DI token for the employee-lookup port. Inject with `@Inject(EMPLOYEE_LOOKUP)`. */
export const EMPLOYEE_LOOKUP = Symbol('EMPLOYEE_LOOKUP');

/** The minimal, cross-module-safe view of an employee. */
export interface EmployeeSummary {
  id: number;
  /** EMP-0001 and the like — generated per company by Document Numbering. */
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** The company they are on the books of. */
  companyId: number;
  /** Null = the company as a whole rather than one of its branches. */
  branchId: number | null;
  /** Somebody who has left is set inactive rather than deleted. */
  isActive: boolean;
}

export interface EmployeeLookupPort {
  /** One employee by id, or null if there is no such record. */
  findById(id: number): Promise<EmployeeSummary | null>;

  /**
   * The given employees, in any order, missing ids simply absent. Batched so a
   * list of logins can name the people holding them in one query rather than
   * one per row.
   */
  findByIds(ids: number[]): Promise<EmployeeSummary[]>;
}
