import { mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Uploads root — same location main.ts serves at `/uploads`. Computed
 * independently (not imported from another module) to keep module boundaries
 * clean; both resolve to the same path from UPLOAD_DIR / cwd.
 */
export const UPLOAD_ROOT =
  process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');

/** Software-info assets (the brand logo). */
export const SOFTWARE_UPLOAD_DIR = join(UPLOAD_ROOT, 'software-info');

/** Public URL prefix the files are served under (see main.ts useStaticAssets). */
export const SOFTWARE_URL_PREFIX = '/uploads/software-info';

// Ensure the directory exists before multer ever writes to it (multer does not
// create its dest dir). Safe to run at import time.
mkdirSync(SOFTWARE_UPLOAD_DIR, { recursive: true });
