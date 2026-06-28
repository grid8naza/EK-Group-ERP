import { mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Where uploaded files live. In dev the backend source is bind-mounted
 * (./backend:/app), so this persists on the host; production should mount a
 * volume for UPLOAD_DIR.
 */
export const UPLOAD_ROOT =
  process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');

/** Login-screen assets (logo + background media library). */
export const LOGIN_UPLOAD_DIR = join(UPLOAD_ROOT, 'login-screen');

/** Public URL prefix the files are served under (see main.ts useStaticAssets). */
export const LOGIN_URL_PREFIX = '/uploads/login-screen';

// Ensure the directory exists before multer ever writes to it (multer does not
// create its dest dir). Safe to run at import time.
mkdirSync(LOGIN_UPLOAD_DIR, { recursive: true });
