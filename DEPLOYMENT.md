# Storm Gate - Fly.io Deployment Guide

## Prerequisites

1. Fly.io CLI installed ✅
2. Fly.io account and logged in ✅
3. App created: `storm-gate` ✅

## Required Environment Variables

Your application requires the following environment variables to be set as Fly.io secrets:

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
- `BASE_URL` - Your app's base URL (will be: https://storm-gate.fly.dev)
- `REDIRECT_URI` - OAuth redirect URI (will be: https://storm-gate.fly.dev/auth/callback)

## Setup Instructions

### Option 1: Use the automated script
```bash
./deploy-to-fly.sh
```

### Option 2: Manual setup

1. Set each secret individually:
```bash
flyctl secrets set MONGODB_URL="your_mongodb_connection_string"
flyctl secrets set CLIENT_ID="your_azure_client_id"
flyctl secrets set CLIENT_SECRET="your_azure_client_secret"
flyctl secrets set TENANT_ID="your_azure_tenant_id"
flyctl secrets set ACCESS_TOKEN_SECRET="your_generated_secret"
flyctl secrets set REFRESH_TOKEN_SECRET="your_generated_secret"
flyctl secrets set JWT_SECRET="your_generated_secret"
flyctl secrets set EMAIL_HOST="smtp.gmail.com"
flyctl secrets set EMAIL_PORT="465"
flyctl secrets set EMAIL_USER="your_email@gmail.com"
flyctl secrets set EMAIL_PASS="your_email_password"
flyctl secrets set ADMIN_EMAIL="admin@yourdomain.com"
flyctl secrets set CLOUND_NAME="your_cloudinary_cloud_name"
flyctl secrets set CLOUD_API_KEY="your_cloudinary_api_key"
flyctl secrets set CLOUD_API_SECRET="your_cloudinary_api_secret"
flyctl secrets set BASE_URL="https://storm-gate.fly.dev"
flyctl secrets set REDIRECT_URI="https://storm-gate.fly.dev/auth/callback"
flyctl secrets set NODE_ENV="production"
```

2. Deploy the application:
```bash
flyctl deploy
```

## Post-Deployment Steps

1. **Update Azure AD App Registration:**
   - Go to your Azure AD app registration
   - Add `https://storm-gate.fly.dev/auth/callback` to the redirect URIs

2. **Test your application:**
   - Health check: `https://storm-gate.fly.dev/health`
   - API docs: `https://storm-gate.fly.dev/api-docs`

3. **Monitor your application:**
   ```bash
   flyctl logs
   flyctl status
   ```

## Useful Commands

- View current secrets: `flyctl secrets list`
- View app info: `flyctl info`
- View logs: `flyctl logs`
- SSH into container: `flyctl ssh console`
- Scale app: `flyctl scale count 1`

## Troubleshooting

If deployment fails:
1. Check logs: `flyctl logs`
2. Verify all secrets are set: `flyctl secrets list`
3. Test locally first: `npm start`
4. Check the health endpoint after deployment

## MongoDB Setup

If you don't have MongoDB Atlas set up:

1. Go to [MongoDB Atlas](https://cloud.mongodb.com)
2. Create a free cluster
3. Create a database user
4. Whitelist all IPs (0.0.0.0/0) for Fly.io deployment
5. Get your connection string and set it as `MONGODB_URL`
