import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
} from 'class-validator';

export class RequestExtensionDto {
  @IsDateString()
  newEndDate: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  newMonthlyRent?: number;

  @IsOptional()
  @IsString()
  @Length(3, 120)
  reference?: string;
}
