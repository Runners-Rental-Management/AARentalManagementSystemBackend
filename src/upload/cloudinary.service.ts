import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

export type CloudinaryUploadType = 'photos' | 'ownership';

export type UploadedFileResult = {
  url: string;
  storageKey: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

type MulterMemoryFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

@Injectable()
export class CloudinaryService {
  private readonly baseFolder: string;

  constructor(private readonly config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      api_secret: this.config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
    this.baseFolder = this.config.get<string>('CLOUDINARY_FOLDER', 'house');
  }

  private folderFor(type: CloudinaryUploadType): string {
    return type === 'ownership'
      ? `${this.baseFolder}/ownership`
      : `${this.baseFolder}/photos`;
  }

  async uploadFile(
    file: MulterMemoryFile,
    type: CloudinaryUploadType,
  ): Promise<UploadedFileResult> {
    const isPdf = file.mimetype === 'application/pdf';
    const resourceType = isPdf ? 'raw' : 'auto';

    let result: UploadApiResponse;
    try {
      result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: this.folderFor(type),
            resource_type: resourceType,
            use_filename: true,
            unique_filename: true,
            overwrite: false,
          },
          (error, uploadResult) => {
            if (error || !uploadResult) {
              reject(error ?? new Error('Cloudinary upload returned no result'));
              return;
            }
            resolve(uploadResult);
          },
        );
        stream.end(file.buffer);
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Cloudinary upload failed';
      throw new InternalServerErrorException(message);
    }

    return {
      url: result.secure_url,
      storageKey: result.public_id,
      fileName: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size,
    };
  }

  async uploadFiles(
    files: MulterMemoryFile[],
    type: CloudinaryUploadType,
  ): Promise<UploadedFileResult[]> {
    return Promise.all(files.map((file) => this.uploadFile(file, type)));
  }
}
