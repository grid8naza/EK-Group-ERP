import { Injectable } from '@nestjs/common';
import { rename } from 'fs/promises';
import { join, extname } from 'path';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveSoftwareInfoDto } from './software-info.dto';
import { SOFTWARE_UPLOAD_DIR, SOFTWARE_URL_PREFIX } from './software-info.constants';

/** Minimal multer file shape (avoids needing @types/multer). */
interface UploadedFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class SoftwareInfoService {
  constructor(private prisma: PrismaService) {}

  /** The singleton record; find-or-creates row id=1. */
  get() {
    return this.prisma.softwareInfo.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  /** Save the text fields. Leaves `logoUrl` untouched unless explicitly passed. */
  save(dto: SaveSoftwareInfoDto) {
    const data = {
      companyName: dto.companyName ?? null,
      address: dto.address ?? null,
      email: dto.email ?? null,
      contactNumber: dto.contactNumber ?? null,
      softwareName: dto.softwareName ?? null,
      softwareVersion: dto.softwareVersion ?? null,
      licenceKey: dto.licenceKey ?? null,
      subscriptionExpiry: dto.subscriptionExpiry
        ? new Date(dto.subscriptionExpiry)
        : null,
      logoSize: dto.logoSize ?? null,
      ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
    };
    return this.prisma.softwareInfo.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
  }

  async addLogo(file: UploadedFile) {
    const url = await this.persist(file);
    return this.prisma.softwareInfo.upsert({
      where: { id: 1 },
      create: { id: 1, logoUrl: url },
      update: { logoUrl: url },
    });
  }

  /** Move the multer temp file into the uploads dir with a real extension. */
  private async persist(file: UploadedFile): Promise<string> {
    const ext = extname(file.originalname) || this.extFromMime(file.mimetype);
    const name = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
    await rename(file.path, join(SOFTWARE_UPLOAD_DIR, name));
    return `${SOFTWARE_URL_PREFIX}/${name}`;
  }

  private extFromMime(mime: string): string {
    const map: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
    };
    return map[mime] || '';
  }
}
