import { RentAdjustmentStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class ReviewRentAdjustmentDto {
  @IsEnum(RentAdjustmentStatus)
  status: RentAdjustmentStatus;

  @IsOptional()
  @IsString()
  @Length(3, 5000)
  reviewNotes?: string;
}
