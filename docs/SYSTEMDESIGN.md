## 🎯 Objective

Design a **centralized authentication and authorization system** using Azure Entra ID and Express.js to serve as a plug-and-play identity layer across multiple apps (web, mobile, API), offering secure token-based access with Firebase-style developer ergonomics.

---

## 🧱 High-Level Architecture

```
┌────────────┐      ┌────────────┐
│  Web App   │◄────►│            │
├────────────┤      │            │
│ Mobile App │◄────►│   Gateway  │─────► Entra ID (OIDC)
├────────────┤      │ (Express)  │        ┌─────────────┐
│   CLI/API  │◄────►│            │─────►  │ Token Issuer │
└────────────┘      └────────────┘        └─────────────┘
```

---

## 🌐 Components

### 1. **Azure Entra ID (OIDC Provider)**

* Acts as the identity authority.
* Provides access tokens, ID tokens, refresh tokens.
* Defines scopes (e.g., `access_as_user`) and multi-tenant consent models.

### 2. **Express.js Gateway (Authorization Server)**

* Built in Node.js with full ESM support.
* Responsible for:

  * Token verification (with JWKS discovery)
  * API protection via Bearer token middleware
  * CORS, rate-limiting, logging
  * Token introspection and RBAC enforcement

### 3. **Clients (Apps)**

* Mobile, Web, or CLI apps authenticate via Azure Entra ID and receive tokens.
* Tokens are sent in Authorization headers to access backend services.

### 4. **Protected Services (APIs)**

* Modular microservices or routes behind the Express Gateway.
* Each request is authorized against decoded JWT scopes and claims.

---

## 🔐 Authentication Flow (Authorization Code Grant)

1. App redirects user to Entra ID `/authorize` endpoint
2. User logs in and consents
3. Entra ID returns an **authorization code** to redirect URI
4. App exchanges code for tokens via `/token` endpoint
5. App stores `access_token` and uses it in future requests
6. Express Gateway validates token signature, issuer, audience
7. Protected API routes authorize or reject request

---

## ⚙️ Key Features

### ✅ Token Validation

* Uses `openid-client` with dynamic JWKS key rotation
* Enforces `aud` (audience) and `iss` (issuer) match

### ✅ Scalable Middleware

* Stateless `verifyJWT()` used across routes
* Logs decoded claims for observability

### ✅ Multi-Tenant Ready

* Supports any Azure AD tenant (`common`) or consumer Microsoft accounts

### ✅ Firebase-Like Developer Experience

* Easy token handoff
* Reusable SDK for frontends
* Optional custom token bridge to Firebase Auth (via Admin SDK)

---

## 📦 Deployment Architecture

* Express App: Dockerized and deployed to AWS ECS or Azure App Service
* Azure Entra: Configured in Azure Portal with exposed scopes and redirect URIs
* Logging: Winston + Morgan piped to CloudWatch or Azure Monitor
* Rate limiting: `express-rate-limit` with Redis (if horizontal scaling needed)

---

## 🧠 Engineering Notes 

### 1. **Performance Optimizations**

* JWKS keys cached with TTL
* Asynchronous token verification with prefetch warm-up

### 2. **Security Posture**

* CORS policies whitelisted per client app origin
* Rate limiting by IP + user fingerprinting
* Optional signed cookies (for web clients only)

### 3. **Extensibility**

* Add support for:

  * Webhooks for token lifecycle events
  * Consent logging + admin approval flows
  * Role-based access via Azure Group claims or appRoles

---

## 📈 Metrics & Observability

* Token validation latency
* Per-route authorization failures
* Rate-limit hit counts
* Issuer discovery health check

---

## 🧪 Testing Strategy

* Integration tests using Supertest + Mock JWKS server
* Postman collections for manual token exchange tests
* Load testing with K6 or Artillery for burst resilience

---

## 🧩 Future Add-Ons

* UI dashboard for token introspection
* CLI tool to debug tokens
* Integration with Firebase Auth via custom tokens
* Option to issue short-lived session tokens for edge cache use
