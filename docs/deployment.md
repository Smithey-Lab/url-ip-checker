# Deploy your own instance

Use your own AWS account and review the template, costs and IAM permissions before deployment. GitHub Actions never deploys this project.

1. Run `npm ci` and `npm run build:infra` to generate `infra/checker-cloudformation.json`.
2. Review and deploy that template using a CloudFormation change set. Supply your HTTPS frontend origins in `AllowedOrigins`. The `Enabled` parameter defaults to `false`; set it to `true` when ready. Acknowledge the IAM capability required by the template.
3. Set `src/checker-config.json` to `{ "endpoint": "YOUR_STACK_ENDPOINT" }` using the Endpoint output, then run `npm run build` and host `dist/` over HTTPS.
4. Allow your API endpoint and `https://api.globalping.io` in your host's Content Security Policy `connect-src`. Review Globalping's service terms. The UI reports Northern Virginia for direct checks, so use `us-east-1` or update the label for your chosen region.

The stack contains an HTTP API, short-lived Lambda and on-demand quota table. It has no always-running VM. DynamoDB records expire asynchronously and the table is retained on stack deletion. Quotas and API throttles reduce usage but do not guarantee a maximum bill. Configure independent billing alerts and review your account regularly.
