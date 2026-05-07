import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateAgreementDto {
  @IsString()
  propertyId: string;

  @IsString()
  tenantId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1000)
  @Max(10_000_000)
  monthlyRent: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(50_000_000)
  advancePayment: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  utilities: string[];

  @IsOptional()
  @IsString()
  terminationReason?: string;
}
