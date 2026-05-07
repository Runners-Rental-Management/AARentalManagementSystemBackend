import { PriorityLevel, ViolationType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class CreateDisputeDto {
  @IsString()
  agreementId: string;

  @IsEnum(ViolationType)
  violationType: ViolationType;

  @IsString()
  @Length(5, 200)
  title: string;

  @IsString()
  @Length(10, 5000)
  description: string;

  @IsOptional()
  @IsEnum(PriorityLevel)
  priority?: PriorityLevel;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  evidence: string[];
}
