import { DisputeStatus, PriorityLevel } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class ReviewDisputeDto {
  @IsEnum(DisputeStatus)
  status: DisputeStatus;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsEnum(PriorityLevel)
  priority?: PriorityLevel;

  @IsOptional()
  @IsString()
  @Length(3, 5000)
  resolution?: string;
}
