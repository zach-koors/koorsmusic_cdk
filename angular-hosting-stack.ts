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
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { ARecord, RecordTarget, HostedZone } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
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
    if (environment.domainName && environment.certificateArn) {
      const certificate = Certificate.fromCertificateArn(
        this,
        'Certificate',
        environment.certificateArn
      );

      distributionConfig.viewerCertificate = ViewerCertificate.fromAcmCertificate(certificate, {
        aliases: [environment.domainName],
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

    // Create Route 53 record for production
    if (environment.domainName && environment.certificateArn) {
      const zone = HostedZone.fromLookup(this, 'Zone', {
        domainName: environment.domainName,
      });

      new ARecord(this, 'SiteAliasRecord', {
        recordName: environment.domainName,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        zone,
      });
    }

    // Deploy Angular build to S3
    new BucketDeployment(this, 'DeployWebsite', {
      sources: [Source.asset(angularBuildPath)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // Stack outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: siteBucket.bucketName,
    });
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: distribution.distributionDomainName,
    });
    if (environment.domainName) {
      new cdk.CfnOutput(this, 'DomainName', {
        value: environment.domainName,
      });
    }
  }
}
