import { IsString, Length, Matches } from 'class-validator';

export class VerifyFaydaDto {
  @IsString()
  @Matches(/^\d{16}$/, { message: 'faydaNumber must be a 16-digit FAN' })
  faydaNumber: string;

  @IsString()
  @Length(2, 80)
  firstName: string;

  @IsString()
  @Length(2, 80)
  fatherName: string;

  @IsString()
  @Length(2, 80)
  grandfatherName: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'otpCode must be a 6-digit code' })
  otpCode: string;
}
