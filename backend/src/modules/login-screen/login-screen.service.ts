import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma, LoginMediaKind } from '@prisma/client';
import { rename, unlink } from 'fs/promises';
import { join, extname } from 'path';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginScreenConfigDto } from './login-screen.dto';
import { LOGIN_UPLOAD_DIR, LOGIN_URL_PREFIX } from './login-screen.constants';
import { installDefaultLoginScreen } from './login-screen.defaults';

/** Minimal multer file shape (avoids needing @types/multer). */
interface UploadedFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class LoginScreenService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LoginScreenService.name);

  constructor(private prisma: PrismaService) {}

  // Ship a default login screen with the project: install it when none has been
  // configured yet (never overwrites a saved one).
  async onApplicationBootstrap(): Promise<void> {
    try {
      if (await installDefaultLoginScreen(this.prisma)) {
        this.logger.log('Default login screen installed.');
      }
    } catch (e) {
      this.logger.error(
        `Default login screen install failed: ${
          e instanceof Error ? e.message : e
        }`,
      );
    }
  }

  /** Config blob + the media library. Find-or-creates the singleton row. */
  async getConfig() {
    const row = await this.prisma.loginScreenConfig.upsert({
      where: { id: 1 },
      create: { id: 1, config: Prisma.JsonNull },
      update: {},
    });
    const media = await this.prisma.loginMedia.findMany({
      orderBy: { id: 'desc' },
    });
    return { config: (row.config as unknown) ?? null, media };
  }

  async saveConfig(config: LoginScreenConfigDto | null | undefined) {
    const value = config
      ? (config as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;
    await this.prisma.loginScreenConfig.upsert({
      where: { id: 1 },
      create: { id: 1, config: value },
      update: { config: value },
    });
    return this.getConfig();
  }

  /** Merge a partial patch into the existing config JSON. */
  private async patchConfig(patch: Record<string, unknown>) {
    const { config } = await this.getConfig();
    const next = { ...((config as Record<string, unknown>) ?? {}), ...patch };
    return this.saveConfig(next as LoginScreenConfigDto);
  }

  async addLogo(file: UploadedFile) {
    const url = await this.persist(file);
    return this.patchConfig({ logoUrl: url });
  }

  async addMedia(file: UploadedFile) {
    const url = await this.persist(file);
    return this.prisma.loginMedia.create({
      data: {
        kind: this.kindOf(file.mimetype),
        url,
        originalName: file.originalname,
        sizeBytes: file.size,
      },
    });
  }

  async removeMedia(id: number) {
    const media = await this.prisma.loginMedia.findUnique({ where: { id } });
    if (media) {
      await this.prisma.loginMedia.delete({ where: { id } });
      await this.deleteFileByUrl(media.url);
      // Clear the background selection if it pointed at the deleted media.
      const { config } = await this.getConfig();
      const c = (config as Record<string, unknown>) ?? {};
      if (c.backgroundMediaId === id) {
        await this.saveConfig({ ...c, backgroundMediaId: null } as LoginScreenConfigDto);
      }
    }
    return this.getConfig();
  }

  private kindOf(mime: string): LoginMediaKind {
    if (mime === 'image/gif') return LoginMediaKind.GIF;
    if (mime.startsWith('video/')) return LoginMediaKind.VIDEO;
    return LoginMediaKind.IMAGE;
  }

  /** Move the multer temp file into the uploads dir with a real extension. */
  private async persist(file: UploadedFile): Promise<string> {
    const ext = extname(file.originalname) || this.extFromMime(file.mimetype);
    const name = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
    await rename(file.path, join(LOGIN_UPLOAD_DIR, name));
    return `${LOGIN_URL_PREFIX}/${name}`;
  }

  private extFromMime(mime: string): string {
    const map: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
    };
    return map[mime] || '';
  }

  private async deleteFileByUrl(url: string) {
    const name = url.split('/').pop();
    if (!name) return;
    try {
      await unlink(join(LOGIN_UPLOAD_DIR, name));
    } catch {
      /* best-effort */
    }
  }
}
