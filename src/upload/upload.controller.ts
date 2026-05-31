import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

const UPLOAD_DIR = join(process.cwd(), 'uploads');

// Ensure directory exists at module load time
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

@Controller('upload')
export class UploadController {
  @Post('files')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const ext = ALLOWED_MIME[file.mimetype] ?? extname(file.originalname).toLowerCase();
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: MAX_FILE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME[file.mimetype]) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
        }
      },
    }),
  )
  uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: { protocol: string; get: (h: string) => string },
  ) {
    if (!files?.length) {
      throw new BadRequestException('No files received');
    }
    const base = `${req.protocol}://${req.get('host')}`;
    return {
      urls: files.map((f) => `${base}/uploads/${f.filename}`),
    };
  }
}
