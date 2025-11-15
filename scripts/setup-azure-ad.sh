#!/bin/bash

# Azure AD Setup Script for Storm Gate
# This script helps you configure Azure AD for testing

echo "🌩️  Storm Gate - Azure AD Setup Helper"
echo "======================================"
echo ""

echo "📋 Steps to configure Azure AD:"
echo ""
echo "1. Go to Azure Portal: https://portal.azure.com"
echo "2. Navigate to: Azure Active Directory > App registrations"
echo "3. Click 'New registration'"
echo ""
echo "4. Configure your app registration:"
echo "   - Name: Storm Gate Dev"
echo "   - Supported account types: Accounts in any organizational directory (Multitenant)"
echo "   - Redirect URI: Web - http://localhost:3001/auth/callback"
echo ""
echo "5. After creation, note down:"
echo "   - Application (client) ID"
echo "   - Directory (tenant) ID" 
echo ""
echo "6. Go to 'Certificates & secrets' > 'New client secret'"
echo "   - Description: Storm Gate Dev Secret"
echo "   - Expires: 24 months"
echo "   - Copy the secret VALUE (not ID)"
echo ""
echo "7. Go to 'API permissions'"
echo "   - Ensure these permissions are granted:"
echo "     • Microsoft Graph - openid (Delegated)"
echo "     • Microsoft Graph - profile (Delegated)"
echo "     • Microsoft Graph - email (Delegated)"
echo "     • Microsoft Graph - offline_access (Delegated)"
echo ""
echo "8. Click 'Grant admin consent' for your tenant"
echo ""

# Check if .env exists
if [ -f .env ]; then
    echo "✅ Found existing .env file"
    echo ""
    echo "Current configuration:"
    grep -E "^(TENANT_ID|CLIENT_ID|CLIENT_SECRET|REDIRECT_URI)=" .env 2>/dev/null || echo "   No Azure AD configuration found"
else
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ Created .env file"
fi

echo ""
echo "🔧 Next steps:"
echo "1. Update your .env file with the values from Azure AD"
echo "2. Run: npm run test:azure-config"
echo "3. Test the flow: npm run dev && open http://localhost:3001/auth/login"
echo ""
echo "Need help? Check: docs/OIDC_IMPLEMENTATION.md"
