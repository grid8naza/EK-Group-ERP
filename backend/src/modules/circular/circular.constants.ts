import { mkdirSync } from 'fs';
import { join } from 'path';
import { UPLOAD_ROOT } from '../../common/uploads';

/** Circular attachments live beside the other uploads, under their own folder. */
export const CIRCULAR_UPLOAD_DIR = join(UPLOAD_ROOT, 'circulars');

/** Public URL prefix these files are served under (see main.ts useStaticAssets). */
export const CIRCULAR_URL_PREFIX = '/uploads/circulars';

/** Per-file ceiling for an attachment — the policy PDF a notice is about. */
export const CIRCULAR_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

/** How many circulars a list page holds. */
export const CIRCULAR_PAGE_SIZE = 25;

/**
 * The most people one circular may go to. High enough for "everybody in the
 * group" and low enough that a mis-clicked audience is caught rather than
 * written 50,000 rows deep.
 */
export const CIRCULAR_MAX_RECIPIENTS = 5000;

// multer does not create its dest dir; make sure it exists before the first
// upload. Safe at import time (mirrors the mail and chat modules).
mkdirSync(CIRCULAR_UPLOAD_DIR, { recursive: true });
