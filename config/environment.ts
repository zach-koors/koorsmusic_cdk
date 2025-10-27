export interface EnvironmentConfig {
  readonly stackNamePrefix: string;
  readonly domainName?: string;
  readonly certificateArn?: string;
}

export const environments: Record<string, EnvironmentConfig> = {
  dev: {
    stackNamePrefix: 'KoorsMusicDev',
  },
  prod: {
    stackNamePrefix: 'KoorsMusicProd',
    // TODO: Replace these with your actual values
    domainName: 'your-domain.com',
    certificateArn: 'arn:aws:acm:us-east-1:YOUR_ACCOUNT:certificate/YOUR_CERT_ID',
  },
};
