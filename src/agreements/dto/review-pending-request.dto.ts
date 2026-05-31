import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class ReviewPendingRequestDto {
  @IsBoolean()
  approved: boolean;

  @IsOptional()
  @IsString()
  @Length(3, 2000)
  reason?: string;
}
