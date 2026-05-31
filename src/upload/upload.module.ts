import { Module } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';
import { UploadController } from './upload.controller';

@Module({
  providers: [CloudinaryService],
  controllers: [UploadController],
  exports: [CloudinaryService],
})
export class UploadModule {}
