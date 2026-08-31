export interface AppConfig {
  port: number;
  nodeEnv: string;
  tenantResolutionMode: 'header' | 'subdomain';
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  mfaIssuer: string;
  db: {
    tenantUrl: string;
    platformUrl: string;
  };
  s3: {
    endpoint: string;
    region: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    forcePathStyle: boolean;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  tenantResolutionMode: (process.env.TENANT_RESOLUTION_MODE as 'header' | 'subdomain') ?? 'header',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-only-access-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-only-refresh-secret-change-me',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },
  mfaIssuer: process.env.MFA_ISSUER ?? 'HRMS Platform',
  db: {
    tenantUrl: process.env.TENANT_DATABASE_URL as string,
    platformUrl: process.env.PLATFORM_DATABASE_URL as string,
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKey: process.env.S3_ACCESS_KEY ?? '',
    secretKey: process.env.S3_SECRET_KEY ?? '',
    bucket: process.env.S3_BUCKET ?? 'hrms-documents',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  },
});
