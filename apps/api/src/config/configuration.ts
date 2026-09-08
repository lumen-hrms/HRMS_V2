export interface AppConfig {
  port: number;
  nodeEnv: string;
  tenantResolutionMode: 'header' | 'subdomain';
  firebase: {
    projectId: string;
    serviceAccountJson?: string;
    /**
     * Firebase Web API key — used server-side ONLY to call the Identity
     * Toolkit REST endpoint that sends a hosted password-reset email
     * (admin-triggered reset for another user; module 01 §4.4). Not a
     * secret (it ships in the web client too). Against the Auth emulator
     * any non-empty value works.
     */
    webApiKey?: string;
  };
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
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID ?? 'hrms-platform-dev',
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    webApiKey: process.env.FIREBASE_WEB_API_KEY,
  },
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
