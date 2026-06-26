import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

/** Server-generated backup file names look exactly like this. */
const BACKUP_FILE_RE = /^erpgrip-\d{8}-\d{6}\.dump$/;

export interface BackupEntry {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  note: string | null;
  createdBy: string | null;
}

interface DbConnection {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

interface ProcResult {
  code: number;
  stdout: string;
  stderr: string;
}

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);

  /** Where backup .dump files (and their .meta.json sidecars) live. */
  private readonly backupDir =
    process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    // Make sure the backup directory exists so the first backup never fails.
    await fs.mkdir(this.backupDir, { recursive: true });
    // Ensure the high security password row exists. The seed creates it on a
    // fresh DB, but it's skipped on an already-seeded one — so back-fill here
    // (from SEED_HIGH_SECURITY_PASSWORD, default 'Backup@123') so the feature
    // works without a full reseed.
    await this.ensureSecuritySetting();
  }

  private async ensureSecuritySetting() {
    const existing = await this.prisma.securitySetting.findUnique({
      where: { id: 1 },
    });
    if (existing) return;
    const pw = process.env.SEED_HIGH_SECURITY_PASSWORD || 'Backup@123';
    await this.prisma.securitySetting.create({
      data: { id: 1, highSecurityPasswordHash: await bcrypt.hash(pw, 10) },
    });
    this.logger.warn(
      'Initialized the high security password from SEED_HIGH_SECURITY_PASSWORD ' +
        '(default "Backup@123" if unset). Change it in Cpanel → Backup & Restore.',
    );
  }

  // ---- High security password ---------------------------------------------

  /** Whether the high security password has been configured at all. */
  async getStatus(): Promise<{ configured: boolean }> {
    const setting = await this.prisma.securitySetting.findUnique({
      where: { id: 1 },
    });
    return { configured: !!setting };
  }

  /**
   * Throws ForbiddenException unless `plain` matches the stored high security
   * password. Every sensitive operation (backup, restore) calls this first.
   */
  async verifyPassword(plain: string): Promise<void> {
    const setting = await this.prisma.securitySetting.findUnique({
      where: { id: 1 },
    });
    if (!setting) {
      throw new InternalServerErrorException(
        'High security password is not configured. Re-seed the database.',
      );
    }
    const ok = await bcrypt.compare(plain, setting.highSecurityPasswordHash);
    if (!ok) {
      throw new ForbiddenException('Incorrect high security password.');
    }
  }

  async changePassword(currentPassword: string, newPassword: string) {
    await this.verifyPassword(currentPassword);
    await this.prisma.securitySetting.update({
      where: { id: 1 },
      data: { highSecurityPasswordHash: await bcrypt.hash(newPassword, 10) },
    });
    return { success: true };
  }

  // ---- Listing -------------------------------------------------------------

  async list(): Promise<BackupEntry[]> {
    const files = await fs.readdir(this.backupDir).catch(() => [] as string[]);
    const dumps = files.filter((f) => BACKUP_FILE_RE.test(f));
    const entries = await Promise.all(
      dumps.map(async (fileName) => {
        const stat = await fs.stat(path.join(this.backupDir, fileName));
        const meta = await this.readMeta(fileName);
        return {
          fileName,
          sizeBytes: stat.size,
          createdAt: meta?.createdAt ?? stat.mtime.toISOString(),
          note: meta?.note ?? null,
          createdBy: meta?.createdBy ?? null,
        } satisfies BackupEntry;
      }),
    );
    // Newest first.
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ---- Create --------------------------------------------------------------

  async create(
    password: string,
    note: string | undefined,
    createdBy: string | null,
  ): Promise<BackupEntry> {
    await this.verifyPassword(password);
    const conn = this.connection();

    const fileName = `erpgrip-${this.timestamp()}.dump`;
    const filePath = path.join(this.backupDir, fileName);

    // Custom-format dump (-Fc): compact and restorable with pg_restore.
    const result = await this.run(
      'pg_dump',
      [
        '-h',
        conn.host,
        '-p',
        conn.port,
        '-U',
        conn.user,
        '-d',
        conn.database,
        '-Fc',
        '-f',
        filePath,
      ],
      conn.password,
    );
    if (result.code !== 0) {
      await fs.rm(filePath, { force: true });
      this.logger.error(`pg_dump failed: ${result.stderr}`);
      throw new InternalServerErrorException(
        `Backup failed: ${this.tail(result.stderr)}`,
      );
    }

    const createdAt = new Date().toISOString();
    await this.writeMeta(fileName, {
      note: note?.trim() || null,
      createdBy,
      createdAt,
    });

    const stat = await fs.stat(filePath);
    return {
      fileName,
      sizeBytes: stat.size,
      createdAt,
      note: note?.trim() || null,
      createdBy,
    };
  }

  // ---- Restore -------------------------------------------------------------

  /** Restore from a backup that already exists on the server. */
  async restoreFromFile(password: string, fileName: string) {
    await this.verifyPassword(password);
    if (!BACKUP_FILE_RE.test(fileName)) {
      throw new BadRequestException('Invalid backup file name.');
    }
    const filePath = path.join(this.backupDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('Backup file not found.');
    }
    await this.restoreDump(filePath);
    return { success: true };
  }

  /** Restore from an uploaded dump file (temp path), then delete the temp. */
  async restoreFromUpload(password: string, tempPath: string) {
    await this.verifyPassword(password);
    try {
      await this.restoreDump(tempPath);
    } finally {
      await fs.rm(tempPath, { force: true });
    }
    return { success: true };
  }

  /**
   * Wipe and rebuild the public schema, then restore the dump into the empty
   * schema. Doing the drop ourselves (rather than relying on pg_restore
   * --clean) gives a deterministic, fully-clean restore and lets us run
   * pg_restore with --exit-on-error so any real failure is surfaced.
   */
  private async restoreDump(filePath: string) {
    const conn = this.connection();

    const drop = await this.run(
      'psql',
      [
        '-h',
        conn.host,
        '-p',
        conn.port,
        '-U',
        conn.user,
        '-d',
        conn.database,
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        'DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
      ],
      conn.password,
    );
    if (drop.code !== 0) {
      this.logger.error(`schema reset failed: ${drop.stderr}`);
      throw new InternalServerErrorException(
        `Restore failed while resetting the database: ${this.tail(drop.stderr)}`,
      );
    }

    const restore = await this.run(
      'pg_restore',
      [
        '-h',
        conn.host,
        '-p',
        conn.port,
        '-U',
        conn.user,
        '-d',
        conn.database,
        '--no-owner',
        '--no-acl',
        '--exit-on-error',
        filePath,
      ],
      conn.password,
    );
    if (restore.code !== 0) {
      this.logger.error(`pg_restore failed: ${restore.stderr}`);
      throw new InternalServerErrorException(
        `Restore failed: ${this.tail(restore.stderr)}. The database may be in ` +
          `an inconsistent state — restore a known-good backup.`,
      );
    }
  }

  // ---- Download / delete ---------------------------------------------------

  async getFileForDownload(fileName: string) {
    if (!BACKUP_FILE_RE.test(fileName)) {
      throw new BadRequestException('Invalid backup file name.');
    }
    const filePath = path.join(this.backupDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('Backup file not found.');
    }
    return { fileName, stream: createReadStream(filePath) };
  }

  async remove(fileName: string) {
    if (!BACKUP_FILE_RE.test(fileName)) {
      throw new BadRequestException('Invalid backup file name.');
    }
    const filePath = path.join(this.backupDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('Backup file not found.');
    }
    await fs.rm(filePath, { force: true });
    await fs.rm(this.metaPath(fileName), { force: true });
    return { success: true };
  }

  // ---- Helpers -------------------------------------------------------------

  /** Parse DATABASE_URL into the parts the postgres CLI tools need. */
  private connection(): DbConnection {
    const raw = process.env.DATABASE_URL;
    if (!raw) {
      throw new InternalServerErrorException('DATABASE_URL is not set.');
    }
    const url = new URL(raw);
    return {
      host: url.hostname,
      port: url.port || '5432',
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
    };
  }

  /** Run a postgres CLI tool, feeding the password via PGPASSWORD. */
  private run(cmd: string, args: string[], password: string): Promise<ProcResult> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        env: { ...process.env, PGPASSWORD: password },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => {
        resolve({
          code: 1,
          stdout,
          stderr:
            stderr ||
            `Could not run "${cmd}" (is the PostgreSQL client installed?): ${err.message}`,
        });
      });
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  }

  private timestamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
      `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
  }

  /** Last few lines of a tool's stderr, for a readable error message. */
  private tail(text: string, lines = 4): string {
    return text.trim().split('\n').slice(-lines).join(' ').slice(0, 500);
  }

  // Sidecar metadata: stored next to the dump so it survives a restore that
  // would otherwise wipe a DB-held record of the backups.
  private metaPath(fileName: string): string {
    return path.join(this.backupDir, `${fileName}.meta.json`);
  }

  private async writeMeta(
    fileName: string,
    meta: { note: string | null; createdBy: string | null; createdAt: string },
  ) {
    await fs.writeFile(this.metaPath(fileName), JSON.stringify(meta), 'utf8');
  }

  private async readMeta(
    fileName: string,
  ): Promise<{
    note: string | null;
    createdBy: string | null;
    createdAt: string;
  } | null> {
    try {
      const raw = await fs.readFile(this.metaPath(fileName), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
