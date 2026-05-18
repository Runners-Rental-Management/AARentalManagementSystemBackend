import { IsString, MinLength } from 'class-validator';

export class UpdateSystemParameterDto {
  @IsString()
  @MinLength(1)
  value: string;
}
