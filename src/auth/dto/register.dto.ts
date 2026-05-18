import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { authUserRoles, type AuthUserRole } from './auth-user-role';

export type RegisterUserRole = AuthUserRole;

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

  @IsIn(authUserRoles)
  role: AuthUserRole;
}
