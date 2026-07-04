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
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

/** Server-generated full-database backup file names look exactly like this. */
const BACKUP_FILE_RE = /^erpgrip-\d{8}-\d{6}\.dump$/;

/**
 * Per-table dump file names: `table-<table>-<timestamp>.dump`. The table name
 * is baked into the file name so a restore can refuse a dump that belongs to a
 * different table (the "no wrong dump for a table" guard).
 */
const TABLE_DUMP_RE = /^table-([a-z0-9_]+)-\d{8}-\d{6}\.dump$/;

/** Tables never offered for table-wise backup/restore (sensitive / internal). */
const EXCLUDED_TABLES = new Set(['security_settings', '_prisma_migrations']);

/** Friendlier display names; anything unlisted is prettified from its name. */
const TABLE_LABELS: Record<string, string> = {
  hsn_codes: 'HSN Codes',
  product_bom_lines: 'Recipe Master Lines',
  category_companies: 'Category–Company Links',
  group_companies: 'Group–Company Links',
  item_companies: 'Item–Company Links',
  product_companies: 'Product–Company Links',
  unit_chain_links: 'Unit Chain Links',
};

export interface BackupEntry {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  note: string | null;
  createdBy: string | null;
}

export interface TableInfo {
  /** Physical table name (the value the API expects back). */
  name: string;
  /** Human-friendly label for the UI. */
  label: string;
  /** Exact current row count. */
  rowCount: number;
}

export interface TableDumpEntry {
  fileName: string;
  /** Which table this dump holds. */
  table: string;
  tableLabel: string;
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

  // ---- Table-wise backup & restore ----------------------------------------

  private prettyLabel(table: string): string {
    return (
      TABLE_LABELS[table] ??
      table
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    );
  }

  /** The tables a user may back up / restore, with exact row counts. */
  async listTables(): Promise<TableInfo[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const names = rows
      .map((r) => r.name)
      .filter((n) => !EXCLUDED_TABLES.has(n));
    if (names.length === 0) return [];

    // One round-trip for exact counts of every table. Names come straight from
    // the catalog, so they're safe to interpolate as identifiers.
    const countSql = names
      .map((n) => `SELECT '${n}' AS name, count(*)::int AS count FROM "public"."${n}"`)
      .join(' UNION ALL ');
    const counts = await this.prisma.$queryRawUnsafe<
      { name: string; count: number }[]
    >(countSql);
    const countByName = new Map(counts.map((c) => [c.name, Number(c.count)]));

    return names.map((name) => ({
      name,
      label: this.prettyLabel(name),
      rowCount: countByName.get(name) ?? 0,
    }));
  }

  /** Reject a table name that isn't a real, backable public table. */
  private async assertBackableTable(table: string): Promise<void> {
    if (!/^[a-z_][a-z0-9_]*$/.test(table) || EXCLUDED_TABLES.has(table)) {
      throw new BadRequestException(`Invalid table "${table}".`);
    }
    const found = await this.prisma.$queryRawUnsafe<{ ok: string | null }[]>(
      `SELECT to_regclass('public.' || $1)::text AS ok`,
      table,
    );
    if (!found[0]?.ok) {
      throw new BadRequestException(`Unknown table "${table}".`);
    }
  }

  /** List the per-table dump files on the server. */
  async listTableDumps(): Promise<TableDumpEntry[]> {
    const files = await fs.readdir(this.backupDir).catch(() => [] as string[]);
    const dumps = files.filter((f) => TABLE_DUMP_RE.test(f));
    const entries = await Promise.all(
      dumps.map(async (fileName) => {
        const stat = await fs.stat(path.join(this.backupDir, fileName));
        const meta = await this.readMeta(fileName);
        const table = TABLE_DUMP_RE.exec(fileName)![1];
        return {
          fileName,
          table: meta?.table ?? table,
          tableLabel: this.prettyLabel(meta?.table ?? table),
          sizeBytes: stat.size,
          createdAt: meta?.createdAt ?? stat.mtime.toISOString(),
          note: meta?.note ?? null,
          createdBy: meta?.createdBy ?? null,
        } satisfies TableDumpEntry;
      }),
    );
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Back up each selected table to its own dump file. */
  async backupTables(
    password: string,
    tables: string[],
    note: string | undefined,
    createdBy: string | null,
  ): Promise<TableDumpEntry[]> {
    await this.verifyPassword(password);
    if (!tables?.length) {
      throw new BadRequestException('Select at least one table to back up.');
    }
    // De-dupe and validate every table up front.
    const unique = [...new Set(tables)];
    for (const t of unique) await this.assertBackableTable(t);

    const conn = this.connection();
    const createdAt = new Date().toISOString();
    const stamp = this.timestamp();
    const out: TableDumpEntry[] = [];

    for (const table of unique) {
      const fileName = `table-${table}-${stamp}.dump`;
      const filePath = path.join(this.backupDir, fileName);
      const result = await this.run(
        'pg_dump',
        [
          '-h', conn.host,
          '-p', conn.port,
          '-U', conn.user,
          '-d', conn.database,
          '-Fc',
          '-t', `public.${table}`,
          '-f', filePath,
        ],
        conn.password,
      );
      if (result.code !== 0) {
        await fs.rm(filePath, { force: true });
        this.logger.error(`pg_dump (${table}) failed: ${result.stderr}`);
        throw new InternalServerErrorException(
          `Backup of "${table}" failed: ${this.tail(result.stderr)}`,
        );
      }
      await this.writeMeta(fileName, {
        note: note?.trim() || null,
        createdBy,
        createdAt,
        table,
      });
      const stat = await fs.stat(filePath);
      out.push({
        fileName,
        table,
        tableLabel: this.prettyLabel(table),
        sizeBytes: stat.size,
        createdAt,
        note: note?.trim() || null,
        createdBy,
      });
    }
    return out;
  }

  /** Restore a single table from a server-side per-table dump. */
  async restoreTableFromFile(password: string, table: string, fileName: string) {
    await this.verifyPassword(password);
    await this.assertBackableTable(table);
    const match = TABLE_DUMP_RE.exec(fileName);
    if (!match) {
      throw new BadRequestException('Invalid table dump file name.');
    }
    // Guard #1: the table baked into the file name must match the target.
    if (match[1] !== table) {
      throw new BadRequestException(
        `That dump is for "${match[1]}", not "${table}". Pick the matching dump.`,
      );
    }
    const filePath = path.join(this.backupDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('Dump file not found.');
    }
    // Guard #2: the sidecar metadata must agree.
    const meta = await this.readMeta(fileName);
    if (meta?.table && meta.table !== table) {
      throw new BadRequestException(
        `That dump's metadata says "${meta.table}", not "${table}".`,
      );
    }
    await this.restoreTableDump(table, filePath);
    return { success: true };
  }

  /** Restore a single table from an uploaded dump (temp path), then clean up. */
  async restoreTableFromUpload(password: string, table: string, tempPath: string) {
    await this.verifyPassword(password);
    await this.assertBackableTable(table);
    try {
      await this.restoreTableDump(table, tempPath);
    } finally {
      await fs.rm(tempPath, { force: true });
    }
    return { success: true };
  }

  /**
   * Inspect a custom-format dump's table of contents and return the set of
   * tables it carries DATA for. Used to refuse a dump that doesn't match the
   * table being restored — including an uploaded full-database dump.
   */
  private async dumpDataTables(filePath: string): Promise<string[]> {
    const toc = await this.run('pg_restore', ['-l', filePath], '');
    if (toc.code !== 0) {
      throw new BadRequestException(
        `Not a valid dump file: ${this.tail(toc.stderr)}`,
      );
    }
    const tables = new Set<string>();
    for (const line of toc.stdout.split('\n')) {
      // e.g. ";  201; 1259 16490 TABLE DATA public items erpgrip"
      const m = /\bTABLE DATA\s+(\S+)\s+(\S+)\s+\S+\s*$/.exec(line);
      if (m && m[1] === 'public') tables.add(m[2]);
    }
    return [...tables];
  }

  /**
   * Replace a single table's contents with the dump's. FK triggers are turned
   * off for the load (session_replication_role = replica), so a parent table
   * can be reloaded without tripping child references, and the old rows are
   * cleared first so the result is exactly the dump.
   */
  private async restoreTableDump(table: string, filePath: string) {
    // Hard guard: the dump must contain DATA for this table and nothing else.
    const dataTables = await this.dumpDataTables(filePath);
    if (dataTables.length === 0 || !dataTables.includes(table)) {
      throw new BadRequestException(
        `This dump does not contain data for "${table}". Wrong file selected.`,
      );
    }
    if (dataTables.some((t) => t !== table)) {
      throw new BadRequestException(
        `This dump holds other tables (${dataTables.join(', ')}), not just ` +
          `"${table}". Use a single-table dump.`,
      );
    }

    const conn = this.connection();

    // Extract just the table's data as SQL (COPY blocks + sequence resets).
    const sqlPath = path.join(os.tmpdir(), `restore-${table}-${randomUUID()}.sql`);
    const extract = await this.run(
      'pg_restore',
      ['--data-only', '-t', table, '-f', sqlPath, filePath],
      conn.password,
    );
    if (extract.code !== 0) {
      await fs.rm(sqlPath, { force: true });
      throw new InternalServerErrorException(
        `Restore failed while reading the dump: ${this.tail(extract.stderr)}`,
      );
    }

    // Wrap the extracted data: clear the table, then reload — all with FK
    // enforcement disabled, in one transaction.
    const wrappedPath = path.join(os.tmpdir(), `restore-${table}-${randomUUID()}-wrapped.sql`);
    const data = await fs.readFile(sqlPath, 'utf8');
    const script =
      `BEGIN;\nSET session_replication_role = replica;\n` +
      `DELETE FROM "${table}";\n${data}\nCOMMIT;\n`;
    await fs.writeFile(wrappedPath, script, 'utf8');

    try {
      const run = await this.run(
        'psql',
        [
          '-h', conn.host,
          '-p', conn.port,
          '-U', conn.user,
          '-d', conn.database,
          '-v', 'ON_ERROR_STOP=1',
          '-f', wrappedPath,
        ],
        conn.password,
      );
      if (run.code !== 0) {
        this.logger.error(`table restore (${table}) failed: ${run.stderr}`);
        throw new InternalServerErrorException(
          `Restore of "${table}" failed: ${this.tail(run.stderr)}`,
        );
      }
    } finally {
      await fs.rm(sqlPath, { force: true });
      await fs.rm(wrappedPath, { force: true });
    }
  }

  async getTableFileForDownload(fileName: string) {
    if (!TABLE_DUMP_RE.test(fileName)) {
      throw new BadRequestException('Invalid table dump file name.');
    }
    const filePath = path.join(this.backupDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('Dump file not found.');
    }
    return { fileName, stream: createReadStream(filePath) };
  }

  async removeTableDump(fileName: string) {
    if (!TABLE_DUMP_RE.test(fileName)) {
      throw new BadRequestException('Invalid table dump file name.');
    }
    const filePath = path.join(this.backupDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('Dump file not found.');
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
    meta: {
      note: string | null;
      createdBy: string | null;
      createdAt: string;
      /** Present only for per-table dumps. */
      table?: string;
    },
  ) {
    await fs.writeFile(this.metaPath(fileName), JSON.stringify(meta), 'utf8');
  }

  private async readMeta(
    fileName: string,
  ): Promise<{
    note: string | null;
    createdBy: string | null;
    createdAt: string;
    table?: string;
  } | null> {
    try {
      const raw = await fs.readFile(this.metaPath(fileName), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
