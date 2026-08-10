/**
 * Port — how OTHER modules read user data without importing the User (Cpanel)
 * module's internals. Consumers depend ONLY on this interface + token; the User
 * module owns the implementation (see modules/user/user-lookup.adapter.ts) and
 * registers it in contracts/contracts.module.ts.
 *
 * Extraction note: when the User module becomes a standalone service, swap the
 * in-process adapter for an HTTP/queue client that implements this SAME
 * interface. No consumer code changes — that is the whole point of the port.
 *
 * Rules:
 *   - Never widen this with Prisma types or full entities. A port exposes a
 *     small, stable, serializable shape — what survives a network hop.
 *   - Methods are async even when today's implementation is synchronous, so a
 *     remote implementation drops in without signature changes.
 */

/** DI token for the user-lookup port. Inject with `@Inject(USER_LOOKUP)`. */
export const USER_LOOKUP = Symbol('USER_LOOKUP');

/** The minimal, cross-module-safe view of a user. */
export interface UserSummary {
  id: number;
  userCode: string;
  username: string;
  name: string;
  email: string | null;
  isActive: boolean;
}

export interface UserLookupPort {
  /** Minimal user record by id, or null if no such user. */
  findById(id: number): Promise<UserSummary | null>;

  /** Minimal user records for the given ids (active + inactive), any order. */
  findByIds(ids: number[]): Promise<UserSummary[]>;

  /** True if the user exists and is allowed to access the given company. */
  canAccessCompany(userId: number, companyId: number): Promise<boolean>;

  /**
   * True if the user may work in this module, in this company — the same
   * "effective access" the application itself grants: the module is enabled for
   * the company, one of the user's groups there manages it, and it is in the
   * user's own module assignment where they have one. Super admins may work in
   * any enabled module; core modules are theirs alone.
   *
   * Asked by the workflow engine so an approver is only sent documents they can
   * actually reach. Kept HERE rather than worked out by the caller because the
   * rule is the user module's to define, and two answers to "may they" is one
   * too many.
   */
  canAccessModule(
    userId: number,
    companyId: number,
    moduleId: number,
  ): Promise<boolean>;

  /**
   * Active user ids assigned to the given user group. Used by the workflow engine
   * to resolve a step's approvers when no explicit users are named. (User groups
   * are company-scoped, so this is already limited to that group's company.)
   */
  usersInGroup(userGroupId: number): Promise<number[]>;
}
