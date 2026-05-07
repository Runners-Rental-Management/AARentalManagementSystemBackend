import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

const allowedRoles = [
  'tenant',
  'landlord',
  'admin',
  'dara_agent',
  'system_admin',
] as const;
export type RegisterUserRole = (typeof allowedRoles)[number];

export class RegisterDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  phone: string;

  @IsIn(allowedRoles)
  @IsOptional()
  role?: RegisterUserRole;
}
