import { PaymentMethod } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class ConfirmRentPaymentDto {
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  @Length(3, 120)
  reference?: string;
}
