import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTaxCalculationDto {
  @IsString()
  @IsNotEmpty()
  landlordId: string;

  @IsNumber()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  taxYear: number;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class TaxBreakdownDto {
  actualIncome: number;
  vacancyIncome: number;
  percentageFromVacancy: number;
}

export class TaxCalculationResponseDto {
  landlordId: string;
  taxYear: number;
  grossAnnualIncome: number;
  occupiedMonths: number;
  vacancyMonths: number;
  potentialVacancyIncome: number;
  totalTaxableIncome: number;
  calculatedTaxAmount: number;
  calculationDate: Date;
  breakdown: TaxBreakdownDto;
  notificationSent: boolean;
  notificationDate?: Date;
}

export class PropertyVacancyDto {
  propertyId: string;
  address?: string;
  vacancyStartDate: Date;
  daysVacant: number;
  monthlyRent: number;
  estimatedMonthlyTax: number;
  isLongTermVacancy: boolean;
}

export class ComplianceReportItemDto {
  landlordId: string;
  landlordName: string;
  landlordEmail: string;
  taxYear: number;
  grossIncome: number;
  vacancyIncome: number;
  totalTaxOwed: number;
  propertiesManaged: number;
  vacantProperties: number;
  notificationSent: boolean;
  lastCalculationDate: Date;
}

export class ComplianceReportQueryDto {
  @IsOptional()
  @IsString()
  sortBy?: 'income' | 'tax' | 'name' | 'vacancies';

  @IsOptional()
  @IsString()
  status?: 'paid' | 'pending' | 'notified';
}

export class BulkTaxResponseDto {
  success: boolean;
  processed: number;
  timestamp: Date;
}

export class ResendNotificationResponseDto {
  success: boolean;
  emailSent: Date;
}

export class VacancyStatusResponseDto {
  propertyId: string;
  vacancyStartDate: Date | null;
  daysVacant: number;
  isLongTermVacancy: boolean;
}

export class VacancyAlertItemDto {
  propertyId: string;
  address: string;
  landlordName: string;
  vacancyStart: Date;
  daysSinceVacant: number;
  estimatedTax: number;
}
