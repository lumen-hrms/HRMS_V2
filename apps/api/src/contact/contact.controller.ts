import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ContactService } from './contact.service';
import { CreateContactSubmissionDto } from './dto/contact.dto';

/**
 * `POST /api/contact` — the landing page's "Contact us" form. Unauthenticated
 * by construction (no `@UseGuards` here at all, same as `HealthController`)
 * and excluded from `TenantResolutionMiddleware` in `app.module.ts` — it has
 * no tenant concept, same as `health` and `platform-admin/*`.
 */
@Controller('contact')
export class ContactController {
  constructor(private readonly service: ContactService) {}

  @Post()
  @HttpCode(202)
  async submit(@Body() dto: CreateContactSubmissionDto, @Req() req: Request) {
    await this.service.submit(dto, req.ip);
    return { status: 'ok' };
  }
}
