import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { AuthService } from './auth.service';
import { SessionDto } from './dto/session.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Frontend calls Firebase directly (signInWithEmailAndPassword) and
   * hands the resulting ID token here to confirm the account exists,
   * belongs to this tenant, and is active — the token itself remains the
   * session; nothing new is minted server-side.
   */
  @Public()
  @Post('session')
  async session(@Body() dto: SessionDto) {
    const user = await this.authService.session(dto.idToken);
    return { status: 'ok', user };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
