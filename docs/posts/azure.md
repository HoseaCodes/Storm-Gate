## 🔐 Mastering Azure Entra ID OIDC: A Deep Dive for API-Only Auth Systems

### 🚀 Overview

This article provides a complete walkthrough of implementing OpenID Connect (OIDC) with Azure Entra ID for API-only applications using Express.js. This system uses access tokens, refresh tokens, scopes, and a high-performance JWKS key caching layer to deliver a secure, production-grade experience that would impress even a senior Netflix engineer.

---

## Part 1: Azure Entra ID OIDC — Concepts & Usage

### 🔑 What is OIDC?

OpenID Connect (OIDC) is a modern identity layer on top of OAuth 2.0. Azure Entra ID (formerly Azure AD) is an OIDC-compliant provider that issues:

* `access_token` — used to call protected APIs
* `id_token` — used to identify the user
* `refresh_token` — used to obtain new tokens without re-authentication

### 🧩 Scopes

Scopes control what your token can access. Azure Entra allows defining custom scopes like:

* `access_as_user` (custom API scope)
* `openid`, `email`, `profile` (standard OIDC scopes)

**Usage example in token request:**

```
scope=openid profile email api://<client-id>/access_as_user
```

### ⏱ Token Expiration

* `access_token`: \~1 hour (default)
* `id_token`: \~1 hour
* `refresh_token`: Can last days to weeks depending on conditional access policies

### 🔐 `client_secret`

* Required in Authorization Code Flow (confidential clients like backend services)
* Created in Azure → App Registration → Certificates & Secrets

### 💰 Cost

* Azure Entra ID Free: \$0/user/month
* Entra ID P1/P2 (Conditional Access, MFA): \$6–\$9/user/month

---

## Part 2: Step-by-Step: API-Only OIDC Implementation

### 🏗️ 1. Register App in Azure

* Go to Azure Portal → Azure Active Directory → App registrations → New registration
* Choose "Accounts in this organizational directory only" (single tenant) or "any directory" (multi-tenant)
* Note your `client_id` and `tenant_id`

### 🛡️ 2. Configure API Expose Scopes

* Go to "Expose an API" tab
* Set an Application ID URI (e.g., `api://<client_id>`)
* Add a scope: `access_as_user`

### ⚙️ 3. Backend: Express + JWT Verification Middleware

Use the `jsonwebtoken` and `crypto` modules with JWKS caching:

```js
const response = await fetch(`https://login.microsoftonline.com/${process.env.TENANT_ID}/discovery/v2.0/keys`);
```

* Cache the keys for performance
* Decode JWT to inspect `kid`
* Convert JWK to PEM and verify signature
* Validate `aud`, `iss`, and `exp`

### 🧪 4. Testing the Implementation

Use Postman or your frontend to:

* Hit the `/authorize` endpoint
* Receive an authorization `code`
* Exchange for tokens via `/token`
* Send token to your protected API:

```http
Authorization: Bearer <access_token>
```

API responds with 200 ✅ or 401 ❌ depending on token validity.

---

## Part 3: Single-Tenant vs. Multi-Tenant — What, Why, and When

### 🏢 Single-Tenant

* Only users from your **own Entra directory** can sign in
* Good for **internal apps** (e.g., enterprise tools)
* Offers tight control, simplified governance

**Pros:**

* Easier compliance and audit trail
* No risk of external user access
* Simpler token policies

**Cons:**

* Not extensible for partners or B2B users

### 🌍 Multi-Tenant

* Allows users from **any Azure Entra tenant** to sign in
* Use case: SaaS apps, platforms for external orgs

**Pros:**

* Broad adoption potential (B2B SaaS)
* Supports Azure AD B2B collaboration

**Cons:**

* Consent management is harder
* Must protect against rogue tenant access
* Complex token validation (`azp`, `appid`, `tid`, `iss`)

### 🎯 When to Choose:

| Use Case                            | Recommendation          |
| ----------------------------------- | ----------------------- |
| Internal tool for employees         | Single-tenant           |
| B2B SaaS for orgs w/ Azure AD       | Multi-tenant            |
| Consumer product with Outlook users | Multi-tenant + personal |

---

## 🔄 Token Refresh Flow (Optional)

If you requested `offline_access`:

* You’ll receive a `refresh_token`
* Exchange with grant type `refresh_token` to get a new `access_token`

---

## 🧠 Final Notes

* ✅ Use `express-rate-limit` to rate limit brute-force attempts
* ✅ Implement token caching with key rotation support
* ✅ Always validate `iss`, `aud`, and `exp`
* ✅ Consider adding logging for decoded token claims to help trace failures

With Azure Entra ID + Express + JWTs, you get enterprise-grade authentication with a clean, scalable developer experience.
