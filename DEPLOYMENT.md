# Storm Gate - AWS Lambda Deployment Guide

## Prerequisites

1. AWS CLI installed and configured ✅
2. Docker installed ✅
3. AWS account with appropriate permissions ✅

## Quick Deployment

Simply run the complete deployment script:

```bash
./deploy-lambda-complete.sh
```

## Required Environment Variables

Your application requires the following environment variables (automatically loaded from `.env` file):

### Database
- `MONGODB_URL` - MongoDB connection string (e.g., from MongoDB Atlas)

### Azure AD Authentication
- `CLIENT_ID` - Azure AD Application (client) ID
- `CLIENT_SECRET` - Azure AD Client secret
- `TENANT_ID` - Azure AD Directory (tenant) ID
- `API_IDENTIFIER` - (Optional) API identifier for audience validation

### JWT Configuration
- `ACCESS_TOKEN_SECRET` - Secret for access tokens (generate with: `openssl rand -base64 64`)
- `REFRESH_TOKEN_SECRET` - Secret for refresh tokens (generate with: `openssl rand -base64 64`)
- `JWT_SECRET` - General JWT secret (generate with: `openssl rand -base64 64`)

### Email Configuration
- `EMAIL_HOST` - Email server host (default: smtp.gmail.com)
- `EMAIL_PORT` - Email server port (default: 465)
- `EMAIL_USER` - Email username
- `EMAIL_PASS` - Email password or app password
- `ADMIN_EMAIL` - Admin email address

### Cloudinary Configuration
- `CLOUND_NAME` - Cloudinary cloud name
- `CLOUD_API_KEY` - Cloudinary API key
- `CLOUD_API_SECRET` - Cloudinary API secret

### Application URLs
- `BASE_URL` - Your Lambda function URL or API Gateway URL
- `REDIRECT_URI` - OAuth redirect URI for your Lambda deployment

## Setup Instructions

### Automated Deployment (Recommended)
```bash
# Ensure your .env file has all required variables
./deploy-lambda-complete.sh
```

### Manual Steps (if needed)

1. Configure AWS credentials:
```bash
aws configure
```

2. Set environment variables in `.env` file:
```bash
MONGODB_URL="your_mongodb_connection_string"
CLIENT_ID="your_azure_client_id"
CLIENT_SECRET="your_azure_client_secret"
TENANT_ID="your_azure_tenant_id"
ACCESS_TOKEN_SECRET="your_generated_secret"
REFRESH_TOKEN_SECRET="your_generated_secret"
EMAIL_USER="info@ambitiousconcept.com"
EMAIL_PASS="your_email_password"
ADMIN_EMAIL="admin@yourdomain.com"
CLOUDINARY_CLOUD_NAME="your_cloudinary_cloud_name"
CLOUDINARY_API_KEY="your_cloudinary_api_key"
CLOUDINARY_API_SECRET="your_cloudinary_api_secret"
NODE_ENV="production"
```

3. Deploy to Lambda:
```bash
./deploy-lambda-complete.sh
```

## Post-Deployment Steps

1. **Update Azure AD App Registration:**
   - Go to your Azure AD app registration
   - Add your Lambda function URL or API Gateway URL to the redirect URIs

2. **Test your Lambda function:**
   ```bash
   # Health check
   aws lambda invoke --function-name storm-gate --payload '{"httpMethod":"GET","path":"/health"}' response.json
   
   # API docs
   aws lambda invoke --function-name storm-gate --payload '{"httpMethod":"GET","path":"/api-docs"}' response.json
   ```

3. **Monitor your application:**
   ```bash
   # View logs
   aws logs tail /aws/lambda/storm-gate --follow --region us-east-1
   
   # Check function status
   aws lambda get-function --function-name storm-gate --region us-east-1
   ```

## Useful Commands

- View function configuration: `aws lambda get-function-configuration --function-name storm-gate`
- View environment variables: `aws lambda get-function-configuration --function-name storm-gate --query 'Environment.Variables'`
- View logs: `aws logs tail /aws/lambda/storm-gate --follow --region us-east-1`
- Update function: `./deploy-lambda-complete.sh`
- Test function: `aws lambda invoke --function-name storm-gate --payload '{"httpMethod":"GET","path":"/health"}' response.json`

## Troubleshooting

If deployment fails:
1. Check CloudWatch logs: `aws logs tail /aws/lambda/storm-gate --region us-east-1`
2. Verify environment variables are set: `aws lambda get-function-configuration --function-name storm-gate --query 'Environment.Variables'`
3. Test locally first: `npm run start:lambda`
4. Check the health endpoint after deployment

## MongoDB Setup

If you don't have MongoDB Atlas set up:

1. Go to [MongoDB Atlas](https://cloud.mongodb.com)
2. Create a free cluster
3. Create a database user
4. Whitelist all IPs (0.0.0.0/0) for AWS Lambda deployment
5. Get your connection string and set it as `MONGODB_URL`
