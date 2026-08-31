import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { AuthService } from './auth.service';
import { LoginDto, MfaVerifyDto } from './dto/login.dto';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    path: '/api/auth',
  };
}

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto.email, dto.password);
    if (result.status === 'ok' && result.refreshToken) {
      res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions());
      return { status: 'ok', accessToken: result.accessToken };
    }
    return result;
  }

  @Public()
  @Post('mfa/verify')
  async verifyMfa(@Body() dto: MfaVerifyDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.verifyMfaAndIssueTokens(dto.mfaChallengeToken, dto.code);
    res.cookie(REFRESH_COOKIE, result.refreshToken!, cookieOptions());
    return { status: 'ok', accessToken: result.accessToken };
  }

  @Public()
  @Post('mfa/enroll/verify')
  async completeEnrollment(@Body() dto: MfaVerifyDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.completeMfaEnrollment(dto.mfaChallengeToken, dto.code);
    res.cookie(REFRESH_COOKIE, result.refreshToken!, cookieOptions());
    return { status: 'ok', accessToken: result.accessToken };
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('No refresh token cookie present');
    const tokens = await this.authService.refresh(token);
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOptions());
    return { accessToken: tokens.accessToken };
  }

  @Post('logout')
  async logout(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(user.sub);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { status: 'ok' };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
