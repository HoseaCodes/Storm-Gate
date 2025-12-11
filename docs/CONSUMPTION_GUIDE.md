# Storm Gate API Consumption Guide

This guide explains how to consume the Storm Gate API from common frontend and mobile stacks: **React, Next.js, Angular, React Native, and SwiftUI**.

---

## 1. Authentication Flow

### a. Web (React, Next.js, Angular)
- **OIDC Login:** Redirect users to Azure Entra ID login page.
- **Callback:** Receive authorization code at your app’s redirect URI.
- **Token Exchange:** Exchange the code for tokens via Storm Gate’s `/auth/token` endpoint.
- **Token Storage:** Store `access_token` in memory (not localStorage for security). Use `refresh_token` in httpOnly cookies if possible.

**Example:**
```js
// Redirect to login
window.location.href = `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?...`;

// After redirect, exchange code for tokens
const res = await fetch('https://auth.epicstart.io/auth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-tenant-id': TENANT_ID },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email'
  })
});
const tokens = await res.json();
```

- **Authenticated Requests:**
  ```js
  fetch('https://auth.epicstart.io/user/profile', {
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
      'x-tenant-id': TENANT_ID
    }
  });
  ```

### b. React Native
- Use a browser-based login (WebView or deep link) for OIDC.
- Store tokens securely (e.g., SecureStore, Keychain).
- Use the same `/auth/token` and `/user/profile` endpoints as above.

### c. SwiftUI (iOS)
- Use `ASWebAuthenticationSession` for OIDC login.
- On callback, exchange code for tokens via `/auth/token`.
- Store tokens in Keychain.
- Use `URLSession` for authenticated API calls.

**Example:**
```swift
var request = URLRequest(url: URL(string: "https://auth.epicstart.io/auth/token")!)
request.httpMethod = "POST"
request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
request.setValue(tenantId, forHTTPHeaderField: "x-tenant-id")
let body = "client_id=...&client_secret=...&grant_type=authorization_code&code=...&redirect_uri=...&scope=openid"
request.httpBody = body.data(using: .utf8)
```

---

## 2. Firebase Bridge (Mobile Apps)
- If using Firebase Auth, after sign-in, get the `firebaseIdToken`.
- Call `POST /auth/token/firebase-bridge` with the token and tenant header.
- Receive Storm Gate tokens for use in API calls.

**Example:**
```js
const res = await fetch('https://auth.epicstart.io/auth/token/firebase-bridge', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-tenant-id': TENANT_ID
  },
  body: JSON.stringify({ firebaseIdToken })
});
const { accessToken, refreshToken } = await res.json();
```

---

## 3. Token Refresh
- Use `/auth/refresh` endpoint with your refresh token (usually via httpOnly cookie).
- On 401 errors, attempt to refresh and retry the request.

---

## 4. Best Practices
- Always send `x-tenant-id` header.
- Use `Authorization: Bearer <access_token>` for protected endpoints.
- Never store tokens in localStorage (use memory or secure storage).
- Handle 401/403 errors by redirecting to login or refreshing tokens.
- For file uploads, use FormData and include auth headers.

---

## 5. API Docs & Testing
- Explore `/api-docs` (Swagger UI) for live API documentation.
- Use Postman/Insomnia for manual testing.

---

## 6. Example: Fetch User Profile (All Stacks)
```js
fetch('https://auth.epicstart.io/user/profile', {
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'x-tenant-id': TENANT_ID
  }
});
```
or in Swift:
```swift
var request = URLRequest(url: URL(string: "https://auth.epicstart.io/user/profile")!)
request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
request.setValue(tenantId, forHTTPHeaderField: "x-tenant-id")
```

---

## 7. Logout
- Call `/auth/logout` and clear tokens from storage.

---

**For more details, see your `/api-docs` endpoint or the full API design document.**
