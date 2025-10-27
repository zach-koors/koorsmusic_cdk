#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AngularHostingStack } from '../angular-hosting-stack';
import { environments } from '../config/environment';
import * as path from 'path';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environmentName = app.node.tryGetContext('env') || 'dev';
const environment = environments[environmentName];

if (!environment) {
  throw new Error(`Environment ${environmentName} not found in config`);
}

// Stack names will be prefixed with the environment
const stackName = `${environment.stackNamePrefix}-AngularHosting`;

// Angular build path pointing to the Angular app build output
const angularBuildPath = path.join(__dirname, '../../koorsmusic_v2/dist/koorsmusic_v2/browser');

new AngularHostingStack(app, stackName, {
  environment,
  angularBuildPath,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});

app.synth();
