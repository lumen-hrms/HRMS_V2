import { IsString, MinLength } from 'class-validator';

export class SessionDto {
  @IsString()
  @MinLength(1)
  idToken!: string;
}
