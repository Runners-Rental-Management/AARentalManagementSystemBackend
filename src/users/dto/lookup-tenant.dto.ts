import { IsString, Length, Matches } from 'class-validator';

export class LookupTenantDto {
  @IsString()
  @Length(16, 16)
  @Matches(/^\d{16}$/)
  faydaNumber: string;
}
