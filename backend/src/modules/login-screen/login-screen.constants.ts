import { mkdirSync } from 'fs';
import { join } from 'path';
import { UPLOAD_ROOT } from '../../common/uploads';

// Re-exported so main.ts (and anything else already importing it from here)
// keeps working; the definition itself now lives in common/ because Chat stores
// attachments under the same root.
export { UPLOAD_ROOT };

/** Login-screen assets (logo + background media library). */
export const LOGIN_UPLOAD_DIR = join(UPLOAD_ROOT, 'login-screen');

/** Public URL prefix the files are served under (see main.ts useStaticAssets). */
export const LOGIN_URL_PREFIX = '/uploads/login-screen';

// Ensure the directory exists before multer ever writes to it (multer does not
// create its dest dir). Safe to run at import time.
mkdirSync(LOGIN_UPLOAD_DIR, { recursive: true });
