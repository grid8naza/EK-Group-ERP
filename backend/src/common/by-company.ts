/**
 * Split a count by company, for a WorkplaceTile.
 *
 * Lives here rather than in one of the modules that use it: every Workplace
 * summary adapter needs the same three lines, and a module importing another
 * module for them is exactly what the boundary rule forbids. `src/common` is
 * shared plumbing — no module owns it, and nothing in it may reach into a module.
 */
export function countByCompany(
  rows: { companyId: number | null }[],
): { companyId: number; count: number }[] {
  const by = new Map<number, number>();
  for (const row of rows) {
    if (row.companyId == null) continue;
    by.set(row.companyId, (by.get(row.companyId) ?? 0) + 1);
  }
  return [...by].map(([companyId, count]) => ({ companyId, count }));
}
