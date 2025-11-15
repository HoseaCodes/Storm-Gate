#!/bin/bash

# Storm Gate Fly.io Deployment Setup Script

echo "🚀 Setting up Storm Gate for Fly.io deployment..."
echo "This script will guide you through setting up all necessary environment variables."
echo ""

# MongoDB URL
echo "📁 DATABASE CONFIGURATION"
echo "You'll need a MongoDB connection string. You can use:"
echo "1. MongoDB Atlas (recommended for production)"
echo "2. A self-hosted MongoDB instance"
echo "3. Railway, PlanetScale, or another cloud MongoDB provider"
echo ""
read -p "Enter your MongoDB connection string (MONGODB_URL): " MONGODB_URL

# Azure AD Configuration
echo ""
echo "🔐 AZURE AD CONFIGURATION"
echo "You'll need these values from your Azure AD app registration:"
read -p "Enter your Azure AD Client ID (CLIENT_ID): " CLIENT_ID
read -p "Enter your Azure AD Client Secret (CLIENT_SECRET): " CLIENT_SECRET
read -p "Enter your Azure AD Tenant ID (TENANT_ID): " TENANT_ID
read -p "Enter your API Identifier (API_IDENTIFIER) [optional]: " API_IDENTIFIER

# JWT Secrets
echo ""
echo "🔑 JWT CONFIGURATION"
echo "You'll need to create secure random strings for JWT tokens."
echo "You can generate them with: openssl rand -base64 64"
read -p "Enter your Access Token Secret (ACCESS_TOKEN_SECRET): " ACCESS_TOKEN_SECRET
read -p "Enter your Refresh Token Secret (REFRESH_TOKEN_SECRET): " REFRESH_TOKEN_SECRET
read -p "Enter your JWT Secret (JWT_SECRET): " JWT_SECRET

# Email Configuration
echo ""
echo "📧 EMAIL CONFIGURATION"
read -p "Enter your Email Host (EMAIL_HOST) [default: smtp.gmail.com]: " EMAIL_HOST
EMAIL_HOST=${EMAIL_HOST:-smtp.gmail.com}
read -p "Enter your Email Port (EMAIL_PORT) [default: 465]: " EMAIL_PORT
EMAIL_PORT=${EMAIL_PORT:-465}
read -p "Enter your Email User (EMAIL_USER): " EMAIL_USER
read -p "Enter your Email Password (EMAIL_PASS): " EMAIL_PASS
read -p "Enter Admin Email (ADMIN_EMAIL): " ADMIN_EMAIL

# Cloudinary Configuration
echo ""
echo "☁️ CLOUDINARY CONFIGURATION"
read -p "Enter your Cloudinary Cloud Name (CLOUND_NAME): " CLOUND_NAME
read -p "Enter your Cloudinary API Key (CLOUD_API_KEY): " CLOUD_API_KEY
read -p "Enter your Cloudinary API Secret (CLOUD_API_SECRET): " CLOUD_API_SECRET

# App Configuration
echo ""
echo "🌐 APP CONFIGURATION"
read -p "Enter your Base URL (BASE_URL) [will be set to https://storm-gate.fly.dev]: " BASE_URL
BASE_URL=${BASE_URL:-https://storm-gate.fly.dev}
read -p "Enter your Redirect URI (REDIRECT_URI) [will be set to https://storm-gate.fly.dev/auth/callback]: " REDIRECT_URI
REDIRECT_URI=${REDIRECT_URI:-https://storm-gate.fly.dev/auth/callback}

# Set Node Environment
NODE_ENV=production

echo ""
echo "🎯 Setting Fly.io secrets..."

# Set all the secrets
flyctl secrets set \
  MONGODB_URL="$MONGODB_URL" \
  CLIENT_ID="$CLIENT_ID" \
  CLIENT_SECRET="$CLIENT_SECRET" \
  TENANT_ID="$TENANT_ID" \
  ACCESS_TOKEN_SECRET="$ACCESS_TOKEN_SECRET" \
  REFRESH_TOKEN_SECRET="$REFRESH_TOKEN_SECRET" \
  JWT_SECRET="$JWT_SECRET" \
  EMAIL_HOST="$EMAIL_HOST" \
  EMAIL_PORT="$EMAIL_PORT" \
  EMAIL_USER="$EMAIL_USER" \
  EMAIL_PASS="$EMAIL_PASS" \
  ADMIN_EMAIL="$ADMIN_EMAIL" \
  CLOUND_NAME="$CLOUND_NAME" \
  CLOUD_API_KEY="$CLOUD_API_KEY" \
  CLOUD_API_SECRET="$CLOUD_API_SECRET" \
  BASE_URL="$BASE_URL" \
  REDIRECT_URI="$REDIRECT_URI" \
  NODE_ENV="$NODE_ENV"

if [ ! -z "$API_IDENTIFIER" ]; then
  flyctl secrets set API_IDENTIFIER="$API_IDENTIFIER"
fi

echo ""
echo "✅ Environment variables set successfully!"
echo ""
echo "🚢 Now deploying your application..."
flyctl deploy

echo ""
echo "🎉 Deployment complete!"
echo "Your app should be available at: https://storm-gate.fly.dev"
echo ""
echo "📋 Next steps:"
echo "1. Update your Azure AD app registration redirect URLs to include: $REDIRECT_URI"
echo "2. Test your application at: https://storm-gate.fly.dev/health"
echo "3. Check the logs with: flyctl logs"
