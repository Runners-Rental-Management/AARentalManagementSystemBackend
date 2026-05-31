import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  CloudinaryService,
  type CloudinaryUploadType,
} from './cloudinary.service';

const ALLOWED_MIME: Record<string, true> = {
  'image/jpeg': true,
  'image/jpg': true,
  'image/png': true,
  'image/webp': true,
  'image/gif': true,
  'application/pdf': true,
};

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

@Controller('upload')
export class UploadController {
  constructor(private readonly cloudinary: CloudinaryService) {}

  @Post('files')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME[file.mimetype]) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(`Unsupported file type: ${file.mimetype}`),
            false,
          );
        }
      },
    }),
  )
  async uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Query('type') type?: string,
  ) {
    if (!files?.length) {
      throw new BadRequestException('No files received');
    }

    const uploadType: CloudinaryUploadType =
      type === 'ownership' ? 'ownership' : 'photos';

    const uploaded = await this.cloudinary.uploadFiles(files, uploadType);
    return { files: uploaded };
  }
}
