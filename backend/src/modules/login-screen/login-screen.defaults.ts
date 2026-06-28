import { access, copyFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { Prisma, LoginMediaKind } from '@prisma/client';
import { LOGIN_UPLOAD_DIR, LOGIN_URL_PREFIX } from './login-screen.constants';
import { LOGIN_DEFAULT_CONFIG } from './login-screen.default-config';

/**
 * Ships a default login screen with the project. The assets live in the repo
 * (backend/assets/login-default/, committed — unlike the gitignored uploads dir)
 * and the settings are baked in login-screen.default-config.ts.
 *
 * On boot, if no login screen has been configured yet (fresh DB or a teammate
 * who never set one), we copy the assets into the served uploads dir and write
 * the LoginScreenConfig + LoginMedia. Once anyone saves their own settings this
 * is a no-op forever — it never overwrites a customised login screen.
 */

const ASSET_DIR = join(process.cwd(), 'assets', 'login-default');
const SEEDED_LOGO = 'default-logo.png';
const SEEDED_BG = 'default-bg-1.png';

async function copyIfMissing(src: string, dest: string): Promise<void> {
  try {
    await access(dest); // already present — keep it
  } catch {
    await copyFile(src, dest);
  }
}

export async function installDefaultLoginScreen(
  prisma: Prisma.TransactionClient,
): Promise<boolean> {
  // create-if-absent: only when nothing has been configured yet.
  const existing = await prisma.loginScreenConfig.findUnique({ where: { id: 1 } });
  const mediaCount = await prisma.loginMedia.count();
  if ((existing && existing.config) || mediaCount > 0) return false;

  // Copy committed assets into the served uploads directory.
  await mkdir(LOGIN_UPLOAD_DIR, { recursive: true });
  const logoSrc = join(ASSET_DIR, 'logo.png');
  const bgSrc = join(ASSET_DIR, 'background.png');
  try {
    await access(logoSrc);
    await access(bgSrc);
  } catch {
    return false; // default assets not shipped — nothing to install
  }
  await copyIfMissing(logoSrc, join(LOGIN_UPLOAD_DIR, SEEDED_LOGO));
  await copyIfMissing(bgSrc, join(LOGIN_UPLOAD_DIR, SEEDED_BG));

  // Background media (cleared selection-agnostic: split layout cycles all media).
  const bgStat = await stat(bgSrc);
  const media = await prisma.loginMedia.create({
    data: {
      kind: LoginMediaKind.IMAGE,
      url: `${LOGIN_URL_PREFIX}/${SEEDED_BG}`,
      originalName: 'background.png',
      sizeBytes: bgStat.size,
    },
  });

  const config = {
    ...LOGIN_DEFAULT_CONFIG,
    backgroundMediaId: media.id, // so the centered layout also shows it
  };
  await prisma.loginScreenConfig.upsert({
    where: { id: 1 },
    update: { config: config as Prisma.InputJsonValue },
    create: { id: 1, config: config as Prisma.InputJsonValue },
  });
  return true;
}
