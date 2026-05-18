import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class ReviewPropertyDto {
  @IsEnum(['available', 'rejected'])
  status: 'available' | 'rejected';

  @IsOptional()
  @IsString()
  @MinLength(3)
  rejectionReason?: string;
}
