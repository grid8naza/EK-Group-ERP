import { mkdirSync } from 'fs';
import { join } from 'path';
import { UPLOAD_ROOT } from '../../common/uploads';

/** Mail attachments live beside the other uploads, under their own folder. */
export const MAIL_UPLOAD_DIR = join(UPLOAD_ROOT, 'mail');

/** Public URL prefix these files are served under (see main.ts useStaticAssets). */
export const MAIL_URL_PREFIX = '/uploads/mail';

/** Per-file ceiling for an attachment. */
export const MAIL_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

/** How many mails a list page holds. */
export const MAIL_PAGE_SIZE = 30;

// multer does not create its dest dir; make sure it exists before the first
// upload. Safe at import time (mirrors the chat and login-screen modules).
mkdirSync(MAIL_UPLOAD_DIR, { recursive: true });
