import { PaymentMethod } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class ConfirmAgreementPaymentDto {
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  /** External payment reference — populated when a real gateway is integrated. */
  @IsOptional()
  @IsString()
  @Length(3, 120)
  reference?: string;
}
