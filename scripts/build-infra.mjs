import {readFile, mkdir, writeFile} from 'node:fs/promises';
const ref = name => ({Ref: name});
const sub = value => ({'Fn::Sub': value});
const arn = name => ({'Fn::GetAtt': [name, 'Arn']});
const template = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Standalone URL/IP checker with atomic quotas; disabled by default.',
  Parameters: {
    AllowedOrigins: {Type: 'CommaDelimitedList', Default: 'https://example.com'},
    Enabled: {Type: 'String', Default: 'false', AllowedValues: ['true', 'false']},
  },
  Resources: {
    RateTable: {Type: 'AWS::DynamoDB::Table', DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: {
      BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{AttributeName: 'id', AttributeType: 'S'}],
      KeySchema: [{AttributeName: 'id', KeyType: 'HASH'}],
      TimeToLiveSpecification: {AttributeName: 'expires', Enabled: true}, SSESpecification: {SSEEnabled: true},
    }},
    Role: {Type: 'AWS::IAM::Role', Properties: {
      AssumeRolePolicyDocument: {Version: '2012-10-17', Statement: [{Effect: 'Allow', Principal: {Service: 'lambda.amazonaws.com'}, Action: 'sts:AssumeRole'}]},
      Policies: [{PolicyName: 'CheckerQuotaOnly', PolicyDocument: {Version: '2012-10-17', Statement: [{Effect: 'Allow', Action: 'dynamodb:UpdateItem', Resource: arn('RateTable'), Condition: {'ForAllValues:StringLike': {'dynamodb:LeadingKeys': ['checker:*']}}}]}}],
    }},
    Checker: {Type: 'AWS::Lambda::Function', Properties: {
      Runtime: 'nodejs24.x', Handler: 'index.handler', MemorySize: 128, Timeout: 12, Role: arn('Role'),
      Code: {ZipFile: await readFile('backend/checker.cjs', 'utf8')},
      Environment: {Variables: {RATE_TABLE: ref('RateTable'), CHECKER_ENABLED: ref('Enabled'), ALLOWED_ORIGINS: {'Fn::Join': [',', ref('AllowedOrigins')]}}},
    }},
    Api: {Type: 'AWS::ApiGatewayV2::Api', Properties: {ProtocolType: 'HTTP', CorsConfiguration: {AllowOrigins: ref('AllowedOrigins'), AllowMethods: ['POST'], AllowHeaders: ['content-type'], ExposeHeaders: ['retry-after']}}},
    Integration: {Type: 'AWS::ApiGatewayV2::Integration', Properties: {ApiId: ref('Api'), IntegrationType: 'AWS_PROXY', IntegrationUri: arn('Checker'), PayloadFormatVersion: '2.0', TimeoutInMillis: 13000}},
    Route: {Type: 'AWS::ApiGatewayV2::Route', Properties: {ApiId: ref('Api'), RouteKey: 'POST /check', Target: sub('integrations/${Integration}')}},
    Stage: {Type: 'AWS::ApiGatewayV2::Stage', DependsOn: ['Route'], Properties: {ApiId: ref('Api'), StageName: '$default', AutoDeploy: true, DefaultRouteSettings: {ThrottlingBurstLimit: 2, ThrottlingRateLimit: 1}}},
    Permission: {Type: 'AWS::Lambda::Permission', Properties: {Action: 'lambda:InvokeFunction', FunctionName: ref('Checker'), Principal: 'apigateway.amazonaws.com', SourceArn: sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/*/POST/check')}},
  },
  Outputs: {Endpoint: {Value: sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/check')}},
};
await mkdir('infra', {recursive: true});
await writeFile('infra/checker-cloudformation.json', JSON.stringify(template, null, 2) + '\n');
console.log('Generated disabled-by-default template; no AWS calls were made.');
