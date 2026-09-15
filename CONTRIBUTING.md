## Development
Use Node.js 24 and npm. Run `npm ci`, then `npm run ci`.

Open feature/fix branches from `dev` and submit pull requests to `dev`. Release changes go from `dev` to `main` through a pull request. Keep tests passing and explain behavior and security implications. Never test against the production service from CI. Never include credentials, logs, or personal data.
