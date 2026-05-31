import { IsString, Length } from 'class-validator';

export class TerminateAgreementDto {
  @IsString()
  @Length(10, 2000)
  reason: string;
}
