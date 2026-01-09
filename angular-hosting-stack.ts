import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { 
  CloudFrontWebDistribution, 
  OriginAccessIdentity,
  ViewerCertificate,
  SecurityPolicyProtocol,
  SSLMethod
} from 'aws-cdk-lib/aws-cloudfront';
import { BucketDeployment, Source, CacheControl } from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { EnvironmentConfig } from './config/environment';

export interface AngularHostingStackProps extends cdk.StackProps {
  readonly environment: EnvironmentConfig;
  readonly angularBuildPath: string;
}

export class AngularHostingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AngularHostingStackProps) {
    super(scope, id, props);

    const { environment, angularBuildPath } = props;

    // S3 bucket for static site
    const siteBucket = new Bucket(this, 'SiteBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront OAI
    const oai = new OriginAccessIdentity(this, 'OAI');
    siteBucket.grantRead(oai);

    // CloudFront distribution configuration
    const distributionConfig: any = {
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: siteBucket,
            originAccessIdentity: oai,
          },
          behaviors: [{ isDefaultBehavior: true }],
        },
      ],
      defaultRootObject: 'index.html',
      errorConfigurations: [
        {
          errorCode: 404,
          responseCode: 200,
          responsePagePath: '/index.html',
        },
      ],
    };

    // Add custom domain configuration for production
    if (environment.domainNames && environment.certificateArn) {
      const certificate = Certificate.fromCertificateArn(
        this,
        'Certificate',
        environment.certificateArn
      );

      distributionConfig.viewerCertificate = ViewerCertificate.fromAcmCertificate(certificate, {
        aliases: environment.domainNames,
        securityPolicy: SecurityPolicyProtocol.TLS_V1_2_2021,
        sslMethod: SSLMethod.SNI,
      });

    }

    // Create CloudFront distribution
    const distribution = new CloudFrontWebDistribution(
      this,
      'SiteDistribution',
      distributionConfig
    );

    // Deploy Angular build to S3
    new BucketDeployment(this, 'DeployWebsite', {
      sources: [Source.asset(angularBuildPath)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      // Increase memory and ephemeral storage for the deployment Lambda to speed up large uploads
      memoryLimit: 1024, // MiB
      ephemeralStorageSize: cdk.Size.gibibytes(1),
    });

    // Seed performance/current.json into the site bucket as an asset with no-store
    new BucketDeployment(this, 'DeployPerformanceSeed', {
      sources: [Source.asset('assets/performance')],
      destinationBucket: siteBucket,
      destinationKeyPrefix: 'performance',
      cacheControl: [CacheControl.noStore()],
      memoryLimit: 1024,
      ephemeralStorageSize: cdk.Size.gibibytes(1),
    });

    // Minimal Lambda + API Gateway for /performance (Phase 1)
    const choirFn = new NodejsFunction(this, 'ChoirFn', {
      entry: 'lambda/choir/index.ts',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      environment: {
        BUCKET: siteBucket.bucketName,
        KEY: 'performance/current.json',
      },
      // Keep this Lambda lightweight; deployment lambdas will get increased resources instead.
    });

    // Restrict IAM to the single object
    choirFn.addToRolePolicy(new PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resources: [siteBucket.arnForObjects('performance/*')],
    }));

    // Allow listing the bucket (restricted to performance/ prefix) so the Lambda can
    // perform bucket-level operations that require ListBucket.
    choirFn.addToRolePolicy(new PolicyStatement({
      actions: ['s3:ListBucket'],
      resources: [siteBucket.bucketArn],
      conditions: {
        StringLike: { 's3:prefix': 'performance/*' },
      },
    }));

    // API Gateway (very small surface for Phase 1)
    const api = new apigateway.RestApi(this, 'ChoirApi', {
      restApiName: 'Choir Service',
      deployOptions: { stageName: process.env.CDK_STAGE || 'dev' },
    });

    const perf = api.root.addResource('performance');
    perf.addMethod('GET', new apigateway.LambdaIntegration(choirFn, { proxy: true }));
    const corsOptions = {
      allowOrigins: ['*'],
      allowMethods: ['POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
      exposeHeaders: ['Cache-Control', 'Content-Type'],
      maxAge: cdk.Duration.seconds(3600),
    } as const;

    const subresources = ['claim', 'join', 'start', 'reset'];
    for (const name of subresources) {
      const r = perf.addResource(name);
      r.addCorsPreflight(corsOptions as any);
      r.addMethod('POST', new apigateway.LambdaIntegration(choirFn, { proxy: true }));
    }
    perf.addCorsPreflight({
      allowOrigins: ['*'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
      exposeHeaders: ['Cache-Control', 'Content-Type'],
      maxAge: cdk.Duration.seconds(3600),
    });

    // Stack outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: siteBucket.bucketName,
    });
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: distribution.distributionDomainName,
    });
    if (environment.domainNames) {
      new cdk.CfnOutput(this, 'DomainName', {
        value: environment.domainNames[0],
      });
    }
  }
}
