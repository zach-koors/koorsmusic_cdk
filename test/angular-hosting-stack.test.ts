import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AngularHostingStack } from '../angular-hosting-stack';
import { environments } from '../config/environment';

test('CloudFront Function exists and is associated with assets/config.json behavior', () => {
  const app = new cdk.App();

  const stack = new AngularHostingStack(app, 'TestStack', {
    environment: environments.prod,
    angularBuildPath: 'assets',
  });

  const template = Template.fromStack(stack);
  // (no-op) ensure template synthesized successfully

  // Ensure a CloudFront Function resource is created
  template.resourceCountIs('AWS::CloudFront::Function', 1);

  // Ensure Distribution has a cache behavior for assets/config.json with the function associated
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: {
      CacheBehaviors: [
        {
          PathPattern: 'assets/config.json',
          FunctionAssociations: [
            { EventType: 'viewer-request' },
          ],
        },
      ],
    },
  });

  // Ensure there is a bucket deployment that invalidates /assets/config.json
  template.hasResourceProperties('Custom::CDKBucketDeployment', {
    DistributionPaths: ['/assets/config.json'],
  });
});
