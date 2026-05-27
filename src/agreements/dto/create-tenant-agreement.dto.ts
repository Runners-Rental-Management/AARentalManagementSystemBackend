import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateTenantAgreementDto {
  @IsString()
  propertyId: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  utilities?: string[];
}
