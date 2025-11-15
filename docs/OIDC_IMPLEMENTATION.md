# Storm Gate - OIDC Implementation Complete

## Overview

The OIDC (OpenID Connect) authorization code flow has been fully implemented in Storm Gate. This provides enterprise-grade authentication through Azure Entra ID while maintaining the flexibility of your multi-application architecture.

## 🔄 Authentication Flow

### 1. **Authorization Code Grant Flow** (Recommended)
```
Client App → /auth/login → Azure AD → /auth/callback → Your App (with tokens)
```

### 2. **Direct Token Validation** (Legacy)
```
Client App → Azure AD (direct) → Your App (token validation only)
```

## 🚀 Quick Start

### 1. Configure Environment Variables
```bash
# Copy the example file
cp .env.example .env

# Configure your Azure AD application
TENANT_ID=your-azure-tenant-id
CLIENT_ID=your-azure-client-id  
CLIENT_SECRET=your-azure-client-secret
REDIRECT_URI=http://localhost:3001/auth/callback
```

### 2. Azure AD App Registration Setup
1. Go to Azure Portal → Azure Active Directory → App registrations
2. Create new registration with these settings:
   - **Redirect URI**: `http://localhost:3001/auth/callback`
   - **Supported account types**: Choose based on your needs
   - **Platform**: Web application

3. Configure API permissions:
   - Add `openid`, `profile`, `email`, `offline_access` scopes

4. Generate client secret and add to `.env`

### 3. Start the Server
```bash
npm run dev
```

## 📋 Available Endpoints

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/auth/login?application=blog` | Initiate OIDC login |
| `GET` | `/auth/callback` | OAuth callback handler |
| `POST` | `/auth/refresh` | Refresh access token |
| `POST` | `/auth/logout` | Logout and invalidate tokens |
| `GET` | `/auth/me` | Get current user info |

### API Endpoints (Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/user` | User operations |
| `POST` | `/api/upload` | File upload |

## 💻 Client Integration Examples

### Web Application (JavaScript)
```javascript
// Initiate login
window.location.href = '/auth/login?application=blog&return_url=/dashboard';

// Handle tokens after callback
const response = await fetch('/auth/me', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});
const user = await response.json();
```

### React Application
```jsx
import { useEffect, useState } from 'react';

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const login = () => {
    window.location.href = '/auth/login?application=blog';
  };

  const logout = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    setUser(null);
  };

  useEffect(() => {
    fetch('/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => setUser(data?.user))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
```

### Mobile/Native Applications
```javascript
// Using PKCE flow (recommended for mobile)
const authUrl = `${BASE_URL}/auth/login?application=mobile&return_url=${encodeURIComponent(redirectUrl)}`;

// Open browser or webview
await WebBrowser.openBrowserAsync(authUrl);

// Handle redirect and extract token
const token = extractTokenFromUrl(redirectUrl);
```

## 🛡️ Security Features

### ✅ Implemented
- **CSRF Protection**: State parameter validation
- **Token Security**: Short-lived access tokens (15min), secure refresh tokens (7 days)
- **Audience Validation**: Proper JWT audience and issuer verification
- **Session Management**: Secure cookie handling with httpOnly flags
- **Multi-tenant Support**: Works with any Azure AD tenant

### 🔄 Token Flow
1. **Access Token**: 15 minutes (for API calls)
2. **Refresh Token**: 7 days (stored in httpOnly cookie)
3. **ID Token**: User identity claims from Azure AD

## 🧪 Testing

### Test the OIDC Flow
1. Navigate to: `http://localhost:3001/auth/login?application=blog`
2. Login with Azure AD credentials
3. Should redirect back with success response
4. Test API access: `curl -H "Authorization: Bearer <token>" http://localhost:3001/auth/me`

### Using Swagger UI
- Visit: `http://localhost:3001/api-docs`
- Test all endpoints with interactive documentation

## 🔧 Troubleshooting

### Common Issues

1. **"Invalid audience" errors**
   - Check `CLIENT_ID` matches your Azure app registration
   - Verify audience configuration in Azure AD

2. **"Signing key not found"**
   - Check `TENANT_ID` is correct
   - Ensure Azure AD app is properly configured

3. **"User not found in system"**
   - User needs to login through `/auth/login` first to be created in your database
   - Or manually create user with `azureUserId` field

## 🎯 Next Steps

1. **Add Role-Based Access Control (RBAC)**
   - Use Azure AD group claims
   - Map to your application roles

2. **Implement Session Persistence**
   - Add Redis for distributed sessions
   - Store refresh tokens securely

3. **Add Admin Dashboard**
   - User management interface
   - Token introspection tools

4. **Create SDK**
   - JavaScript/TypeScript SDK for easy client integration
   - React hooks for authentication state

## 📈 Production Considerations

- Use Redis for session/token storage in production
- Implement proper logging and monitoring
- Set up Azure Key Vault for secrets management
- Configure proper CORS policies for your domains
- Use HTTPS everywhere
- Implement rate limiting per user/IP
