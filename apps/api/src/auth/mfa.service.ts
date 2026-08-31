import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import type { AppConfig } from '../config/configuration';

@Injectable()
export class MfaService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  async generateQrCodeDataUrl(email: string, secret: string): Promise<string> {
    const issuer = this.config.get('mfaIssuer', { infer: true });
    const otpauthUrl = authenticator.keyuri(email, issuer, secret);
    return QRCode.toDataURL(otpauthUrl);
  }

  verifyToken(token: string, secret: string): boolean {
    try {
      return authenticator.verify({ token, secret });
    } catch {
      return false;
    }
  }
}
