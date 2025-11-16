// Lambda handler entry point
// This file serves as the entry point for AWS Lambda container runtime

import { handler as appHandler } from './src/lambda-app.js';

// Export the handler for Lambda runtime
export const handler = appHandler;
