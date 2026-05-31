import { HomeCondition, PropertyType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class PredictPriceDto {
  @IsString()
  subCity: string;

  @IsEnum(PropertyType)
  propertyType: PropertyType;

  @IsInt()
  @Min(1)
  @Max(25)
  bedrooms: number;

  @IsInt()
  @Min(1)
  @Max(12)
  bathrooms: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(10)
  @Max(5000)
  area: number;

  @IsOptional()
  @IsEnum(HomeCondition)
  homeCondition?: HomeCondition;

  @IsOptional()
  @IsString()
  furnishing?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  amenities?: string[];
}
