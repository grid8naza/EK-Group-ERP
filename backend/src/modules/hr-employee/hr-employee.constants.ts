import { mkdirSync } from 'fs';
import { join } from 'path';

// Same root as the static-asset mount in main.ts (served at /uploads).
const UPLOAD_ROOT = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');

/** Employee photographs, served at /uploads/employees/<file>. */
export const EMPLOYEE_UPLOAD_DIR = join(UPLOAD_ROOT, 'employees');
export const EMPLOYEE_URL_PREFIX = '/uploads/employees';

mkdirSync(EMPLOYEE_UPLOAD_DIR, { recursive: true });

/**
 * The Document Master row an employee code is numbered from (Cpanel → Document
 * Numbering). Seeded by DocumentService.SYSTEM_DOCUMENTS; its issued numbers are
 * read back off Employee.code by the numbering service's SOURCES table.
 */
export const EMPLOYEE_DOCUMENT_CODE = 'EMPLOYEE';
