import { AgreementStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class ReviewAgreementDto {
  @IsEnum(AgreementStatus)
  status: AgreementStatus;

  @IsOptional()
  @IsString()
  @Length(3, 2000)
  reason?: string;
}
