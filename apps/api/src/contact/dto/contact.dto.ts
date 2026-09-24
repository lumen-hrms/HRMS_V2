import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** POST /api/contact — the public landing-page "Contact us" form. */
export class CreateContactSubmissionDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  company!: string;

  @Transform(trim)
  @IsString()
  @MinLength(6)
  @MaxLength(40)
  phone!: string;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  message!: string;
}
