import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PlatformJwtStrategy } from './strategies/platform-jwt.strategy';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, MfaService, JwtStrategy, PlatformJwtStrategy],
  exports: [AuthService, MfaService],
})
export class AuthModule {}
