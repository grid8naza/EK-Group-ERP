import { mkdirSync } from 'fs';
import { join } from 'path';

// Same root as the static-asset mount in main.ts (served at /uploads).
const UPLOAD_ROOT = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');

/** Employee photographs, served at /uploads/employees/<file>. */
export const EMPLOYEE_UPLOAD_DIR = join(UPLOAD_ROOT, 'employees');
export const EMPLOYEE_URL_PREFIX = '/uploads/employees';

mkdirSync(EMPLOYEE_UPLOAD_DIR, { recursive: true });

/** The HR lookup a department is chosen from. Seeded by seedHrDefaults. */
export const DEPARTMENT_LOOKUP_CODE = 'DEPARTMENT';
