import { mkdirSync } from 'fs';
import { join } from 'path';

// Same root as the static-asset mount in main.ts (served at /uploads).
const UPLOAD_ROOT = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');

/** Product picture uploads, served at /uploads/products/<file>. */
export const PRODUCT_UPLOAD_DIR = join(UPLOAD_ROOT, 'products');
export const PRODUCT_URL_PREFIX = '/uploads/products';

mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });
