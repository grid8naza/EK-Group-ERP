/**
 * Auto-generated 17-digit hierarchy codes for Category / Group (up to 5 levels)
 * / Item / Product. Layout (each box a fixed-width numeric segment):
 *
 *   ┌──┬──┬──┬──┬──┬──┬─────┐
 *   │CC│L1│L2│L3│L4│L5│IIIII│   = 2 + 2·5 + 5 = 17 digits
 *   └──┴──┴──┴──┴──┴──┴─────┘
 *    cat  group levels    item/product sequence (shared per leaf group)
 *
 * A category's code fills CC and zeros the rest.
 *
 * A GROUP leaves CC as 00 and fills only its level segments. It has to: one
 * group serves several categories (Bakery is both semi-finished and finished),
 * so there is no single CC to write. Group level-1 numbering is therefore a
 * single global namespace rather than one per category.
 *
 * An ITEM / PRODUCT does name exactly one category, so its code is its leaf
 * group's code with the IIIII slot filled AND the CC digits stamped from its
 * own category — see `withCategory`. Two products sharing a group but sitting
 * in different categories differ in CC, which is what makes the code sort and
 * report by category:
 *
 *   Group   Bakery > Bread        00 01 01 00 00 00 00000
 *   Product Bread Dough  (Semi)   03 01 01 00 00 00 00001
 *   Product White Bread  (Fin)    04 01 01 00 00 00 00002
 *
 * Because the code is fixed-width and positional, plain ascending sort yields
 * the correct tree order (parent, then its children, then the next sibling).
 */

export const CATEGORY_DIGITS = 2;
export const LEVEL_DIGITS = 2;
export const ITEM_DIGITS = 5;

export const MAX_LEVEL = 5;
export const MAX_CATEGORY = 99; // CC segment
export const MAX_GROUP = 99; // each level segment
export const MAX_ITEM_SEQ = 99999; // IIIII segment

export const CODE_LENGTH =
  CATEGORY_DIGITS + MAX_LEVEL * LEVEL_DIGITS + ITEM_DIGITS; // 17

const ZEROS = '0'.repeat(CODE_LENGTH);
const ITEM_OFFSET = CATEGORY_DIGITS + MAX_LEVEL * LEVEL_DIGITS; // 12

/** 0-based string offset of a group level's 2-digit segment (level 1 → 2). */
function levelOffset(level: number): number {
  return CATEGORY_DIGITS + (level - 1) * LEVEL_DIGITS;
}

function setSegment(
  code: string,
  offset: number,
  width: number,
  value: number,
): string {
  const seg = String(value).padStart(width, '0');
  return code.slice(0, offset) + seg + code.slice(offset + width);
}

function readSegment(code: string, offset: number, width: number): number {
  return parseInt(code.slice(offset, offset + width), 10) || 0;
}

// ---- Builders -------------------------------------------------------------

export function categoryCode(n: number): string {
  return setSegment(ZEROS, 0, CATEGORY_DIGITS, n);
}

/** The all-zero code a level-1 group builds on (groups carry no category). */
export const GROUP_ROOT_CODE = ZEROS;

/**
 * Build a group's code by filling in its own level segment. A level-1 group
 * starts from GROUP_ROOT_CODE, a sub-group from its parent group's code; either
 * way the CC digits stay 00, because a group is not owned by a category.
 */
export function groupCode(parentCode: string, level: number, n: number): string {
  return setSegment(parentCode, levelOffset(level), LEVEL_DIGITS, n);
}

export function itemCode(leafGroupCode: string, seq: number): string {
  return setSegment(leafGroupCode, ITEM_OFFSET, ITEM_DIGITS, seq);
}

/**
 * Stamp a category's CC digits onto an item/product code built from a (CC-less)
 * group code. `categoryCode` is the category's own 17-digit code; only its CC
 * segment is read.
 */
export function withCategory(code: string, categoryCode: string): string {
  return setSegment(code, 0, CATEGORY_DIGITS, categoryNumberOf(categoryCode));
}

// ---- Readers --------------------------------------------------------------

export function categoryNumberOf(code: string): number {
  return readSegment(code, 0, CATEGORY_DIGITS);
}

export function groupNumberAt(code: string, level: number): number {
  return readSegment(code, levelOffset(level), LEVEL_DIGITS);
}

export function itemSeqOf(code: string): number {
  return readSegment(code, ITEM_OFFSET, ITEM_DIGITS);
}

/** The code prefix (CC + L1) shared by a primary group and all its descendants. */
export function primaryPrefix(code: string): string {
  return code.slice(0, CATEGORY_DIGITS + LEVEL_DIGITS);
}

// ---- Allocation -----------------------------------------------------------

/** Lowest integer in [1..max] not already taken, or null if the range is full. */
export function lowestFree(used: Iterable<number>, max: number): number | null {
  const taken = new Set(used);
  for (let i = 1; i <= max; i++) if (!taken.has(i)) return i;
  return null;
}
