import { mkdirSync } from 'fs';
import { join } from 'path';
import { UPLOAD_ROOT } from '../../common/uploads';

/** Chat attachments live beside the other uploads, under their own folder. */
export const CHAT_UPLOAD_DIR = join(UPLOAD_ROOT, 'chat');

/** Public URL prefix these files are served under (see main.ts useStaticAssets). */
export const CHAT_URL_PREFIX = '/uploads/chat';

/** Per-file ceiling for an attachment. */
export const CHAT_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

/** How many messages a thread page holds. */
export const CHAT_PAGE_SIZE = 40;

// multer does not create its dest dir; make sure it exists before the first
// upload. Safe at import time (mirrors the login-screen module).
mkdirSync(CHAT_UPLOAD_DIR, { recursive: true });
