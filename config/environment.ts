export interface EnvironmentConfig {
  readonly stackNamePrefix: string;
  readonly domainNames?: string[];
  readonly certificateArn?: string;
}

export const environments: Record<string, EnvironmentConfig> = {
  dev: {
    stackNamePrefix: 'KoorsMusicDev',
  },
  prod: {
    stackNamePrefix: 'KoorsMusicProd',
    domainNames: ['kokozami.net', 'www.kokozami.net'],
    certificateArn: 'arn:aws:acm:us-east-1:211125448427:certificate/d4c9f3fa-9816-419e-a407-e2cebd638808',
  },
};
