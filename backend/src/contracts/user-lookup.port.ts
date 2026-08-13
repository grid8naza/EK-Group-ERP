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

/**
 * An audience, named the way the person choosing it thinks of it: "everybody",
 * "the Bake House", "the Kochi branch", "the packing supervisors", "and also
 * Anita". The union of whatever is set is who it reaches.
 *
 * Asked by Circulars (SRS FR-COM-04) and, later, Broadcast (FR-COM-03) — both
 * address a body of people rather than a list of names.
 */
export interface AudienceSpec {
  /** Everybody the asker can reach. Set on its own; the rest are then ignored. */
  everyone?: boolean;

  /**
   * WHERE they work and WHAT they do, and an audience is always both:
   * `(any of these branches) AND (any of these roles)`, worked out per company
   * and then added together.
   *
   * One sentence covers every case, which is the point of having no options:
   *   · every branch + every role  → everybody in the company
   *   · every branch + Branch Manager → every branch manager in the company
   *   · Kadathy + every role       → everybody at Kadathy
   *
   * Widening within a kind and narrowing across them is what makes that work:
   * two branches has to mean EITHER branch (nobody is assigned to all of them),
   * while a branch and a role has to mean BOTH, or "the managers at Kadathy"
   * could not be said at all.
   *
   * A company is never chosen directly — it is only the heading its branches
   * and roles sit under, and picking all of both is what "the whole company"
   * means. Where a company has no branches at all, its roles stand alone;
   * requiring a branch that cannot exist would put that company out of reach.
   */
  branchIds?: number[];
  userGroupIds?: number[];

  /**
   * Named individuals. Always added on top, never filtered by the above — the
   * picker offers them as "and also, by name", and a name that had to survive
   * the branch-and-role test as well would not be an addition at all. This is
   * also the way to reach somebody who holds no role, such as a super admin.
   */
  userIds?: number[];
}

/**
 * What a person may aim an audience at — the choices their picker offers.
 *
 * Companies are headings, not choices: branches and roles are listed under the
 * one they belong to, and picking every branch and every role under a heading
 * is what selecting that company would have meant.
 */
export interface AudienceOptions {
  companies: { id: number; name: string }[];
  branches: { id: number; name: string; companyId: number }[];
  groups: { id: number; name: string; companyId: number }[];
  /** How many people "everyone" is, so the picker can say so. */
  everyoneCount: number;
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

  /**
   * Active users who share at least one company with this one — everybody they
   * work alongside, wherever in the group that is. Super admins see, and are
   * seen by, everyone: they belong to no company in particular.
   *
   * Asked by Chat to populate its people-picker. Kept HERE rather than worked
   * out by the caller because "who is a colleague" is a fact about company
   * membership, and that is the user module's to answer — Chat cannot read
   * UserCompany without importing it.
   *
   * Excludes the caller. Inactive users are left out: a chat cannot be started
   * with somebody who can no longer sign in.
   */
  findPeers(userId: number): Promise<UserSummary[]>;

  /**
   * The companies, branches and role groups this user may aim an audience at.
   *
   * Kept HERE for the same reason findPeers is: "which company is mine, which
   * branch is under it, which group belongs to it" are facts about Cpanel
   * membership, and a communication module cannot read UserCompany, Branch or
   * UserGroup without importing them.
   */
  audienceOptions(userId: number): Promise<AudienceOptions>;

  /**
   * Turn an audience into the people it reaches — active user ids, the asker
   * excluded (you do not circulate a notice to yourself).
   *
   * Always intersected with findPeers, so an audience can never reach further
   * than the person choosing it could reach by name. That means a target the
   * asker may not aim at contributes nobody rather than raising an error: which
   * of "no such group", "empty group" and "not your group" it was would itself
   * say something about a company they have no business seeing.
   *
   * A company with branches picked but no role — or the other way about — is
   * incomplete, and contributes nobody rather than everybody. Half a rule is
   * the one case where guessing would send a notice to people who were never
   * chosen.
   */
  resolveAudience(userId: number, spec: AudienceSpec): Promise<number[]>;
}
