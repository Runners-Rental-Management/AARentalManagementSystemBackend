import { Type } from 'class-transformer';
import { IsNumber, IsString, Length, Max, Min } from 'class-validator';

export class CreateRentAdjustmentDto {
  @IsString()
  agreementId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1000)
  @Max(10_000_000)
  proposedRent: number;

  @IsString()
  @Length(10, 5000)
  reason: string;
}
