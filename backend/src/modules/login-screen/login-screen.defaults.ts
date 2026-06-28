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
 * Two responsibilities, run on every boot:
 *  1. SELF-HEAL the default asset FILES: always copy the committed assets into
 *     the served uploads dir if missing. This is what fixes a rebuild where the
 *     uploads dir wasn't persisted (the DB config survives but the files don't),
 *     so the default config's references keep resolving.
 *  2. INSTALL the default CONFIG the first time only (when nothing is configured
 *     yet). Never overwrites a customised login screen.
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
  const logoSrc = join(ASSET_DIR, 'logo.png');
  const bgSrc = join(ASSET_DIR, 'background.png');
  let assetsPresent = true;
  try {
    await access(logoSrc);
    await access(bgSrc);
  } catch {
    assetsPresent = false; // default assets not shipped
  }

  // 1) Self-heal: ensure the committed default files exist in the served uploads
  //    dir, even after a rebuild with a fresh/ephemeral uploads volume.
  if (assetsPresent) {
    await mkdir(LOGIN_UPLOAD_DIR, { recursive: true });
    await copyIfMissing(logoSrc, join(LOGIN_UPLOAD_DIR, SEEDED_LOGO));
    await copyIfMissing(bgSrc, join(LOGIN_UPLOAD_DIR, SEEDED_BG));
  }

  // 2) Install the default config only when nothing has been configured yet.
  const existing = await prisma.loginScreenConfig.findUnique({ where: { id: 1 } });
  const mediaCount = await prisma.loginMedia.count();
  if ((existing && existing.config) || mediaCount > 0) return false;
  if (!assetsPresent) return false;

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
