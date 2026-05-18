import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { authUserRoles, type AuthUserRole } from './auth-user-role';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsIn(authUserRoles)
  role: AuthUserRole;
}
