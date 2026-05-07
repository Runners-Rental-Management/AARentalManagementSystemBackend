import { HomeCondition, PropertyType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreatePropertyDto {
  @IsString()
  @Length(3, 180)
  title: string;

  @IsString()
  @Length(5, 255)
  address: string;

  @IsString()
  @Length(2, 120)
  subCity: string;

  @IsString()
  @Length(1, 40)
  woreda: string;

  @IsEnum(PropertyType)
  propertyType: PropertyType;

  @IsInt()
  @Min(0)
  @Max(20)
  bedrooms: number;

  @IsInt()
  @Min(1)
  @Max(20)
  bathrooms: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(10)
  @Max(3000)
  area: number;

  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  amenities: string[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1000)
  @Max(10_000_000)
  monthlyRent: number;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  images: string[];

  @IsString()
  @Length(20, 6000)
  description: string;

  @IsOptional()
  @IsEnum(HomeCondition)
  homeCondition?: HomeCondition;
}
