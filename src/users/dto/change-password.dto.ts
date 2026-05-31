import { IsEmail, IsString, Length } from 'class-validator';

export class ChangePasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(1, 128)
  currentPassword: string;

  @IsString()
  @Length(8, 128)
  newPassword: string;
}
