import { join } from 'path';

/**
 * Where uploaded files live, for every module that stores one.
 *
 * Shared here rather than owned by whichever module uploaded first: main.ts
 * serves this ONE directory at /uploads, so a module that computed its own
 * would be writing somewhere the app does not serve the moment UPLOAD_DIR is
 * set. In dev the backend source is bind-mounted (./backend:/app), so this
 * persists on the host; production should mount a volume for UPLOAD_DIR.
 */
export const UPLOAD_ROOT =
  process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
