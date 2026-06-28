import { mkdirSync } from 'fs';
import { join } from 'path';

// Same root as the static-asset mount in main.ts (served at /uploads).
const UPLOAD_ROOT = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');

/** Per-company logo uploads, served at /uploads/companies/<file>. */
export const COMPANY_UPLOAD_DIR = join(UPLOAD_ROOT, 'companies');
export const COMPANY_URL_PREFIX = '/uploads/companies';

mkdirSync(COMPANY_UPLOAD_DIR, { recursive: true });
