import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { AuthService } from './auth.service';
import { SessionDto } from './dto/session.dto';
import { RequestPasswordResetDto } from './dto/password-reset.dto';
import { PasswordResetService } from './password-reset.service';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  /**
   * Frontend calls Firebase directly (signInWithEmailAndPassword) and
   * hands the resulting ID token here to confirm the account exists,
   * belongs to this tenant, and is active — the token itself remains the
   * session; nothing new is minted server-side. Every outcome (this one
   * and each failure branch) is recorded in the login audit trail, with
   * the caller's IP + user-agent.
   */
  @Public()
  @Post('session')
  async session(@Body() dto: SessionDto, @Req() req: Request) {
    const user = await this.authService.session(dto.idToken, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    return { status: 'ok', user };
  }

  /**
   * "Forgot password?" — pre-auth, tenant resolved from the subdomain /
   * X-Tenant-Subdomain like /session. Always 202 with the same body so it
   * can't be used to probe which emails have accounts.
   */
  @Public()
  @Post('password-reset')
  @HttpCode(202)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto, @Req() req: Request) {
    await this.passwordReset.request(dto.email, req.ip);
    return { status: 'ok' };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
