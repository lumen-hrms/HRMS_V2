import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Guards every /api/platform-admin/* route. Entirely separate token type
 * from tenant users — see PlatformJwtStrategy. */
@Injectable()
export class PlatformJwtAuthGuard extends AuthGuard('platform-jwt') {}
