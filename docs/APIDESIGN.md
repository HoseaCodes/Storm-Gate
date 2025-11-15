# **Storm Gate API Design Document**

## 🎯 Objective

Provide a centralized, stateless authentication gateway using Azure Entra ID and JWTs, consumable across frontend and backend services via API.

| Feature                    | Status                                          |
| -------------------------- | ----------------------------------------------- |
| **Core Features**          |                                                 |
| Multi-Tenant Isolation     | ✅ via `X-Tenant-ID` header                      |
| Rate Limit per Tenant/User | ✅ Scoped + Tunable                              |
| JWT Validation (Entra ID)  | ✅ with JWKS                                     |
| Soft Delete for Users      | ✅ `isDeleted`, `deletedAt`, `deletedBy`         |
| Audit Logging              | ✅ Action-based JSON logs + future Kafka support for sensitive actions |
| Upload Management Restored | ✅ Cloudinary with delete/update hooks           |
| OpenAPI/Swagger Support    | 🔜 Ready for export                             |
| Testing / Postman Suite    | 🔜 Ready to generate                            |
| **Authentication & Security** |                                              |
| JWT Access Tokens          | ✅ RS256 + refresh token in secure httpOnly cookie |
| JWKS Caching & Validation  | ✅ Implemented                                   |
| RBAC Middleware            | ✅ via authRole() middleware;  Role-based access control (`admin`, `supervisor`, `basic`)                    |
| Rate Limiting & Abuse Throttling | ✅ On sensitive routes                     |
| Security Headers           | ✅ CSP, helmet, secure headers                   |
| **System Architecture**    |                                                  |
| Structured Logging         | ✅ with context                                  |
| Redis Session & Profile Caching | ✅ Optional but recommended                 |
| Pagination & Search Support | ✅ Implemented                                  |
| Input Validation           | ✅ Planned with zod or joi                       |
| Audit Logging for Admin Actions | ✅ Profile and user admin actions; logs for sensitive endpoints           |

---

## 🌐 Base URL

```
https://auth.epicstart.io
```

---

## 🔑 Authentication

* All protected endpoints require a valid `Authorization: Bearer <access_token>` header
* Tokens are issued by Azure Entra ID and verified against JWKS cache in the gateway

```yml
auth_methods:
  primary:
    type: "azure_ad_jwt"
    use_case: "Web applications, server-to-server"
    token_validation: "JWKS from Azure AD"
    
  mobile:
    type: "firebase_bridge"
    use_case: "iOS/Android native apps"
    flow: "Firebase ID token → Storm Gate JWT"
    
  fallback:
    type: "local_password"
    use_case: "Development, emergency access"
    deprecated: true
```

---

## **Global Requirements**

* All requests must include a tenant context header:

  ```
  x-tenant-id: <TENANT_UUID>
  ```

* Sensitive actions (create/update/delete) are logged via the audit service.

* Soft deletes are used instead of hard deletes for users and uploads:

  * Field: `deleted: boolean`
  * Field: `deletedAt: ISODate`

* Rate limiting is scoped by both IP and `x-tenant-id`.

* Auth: JWT-based (RS256), refresh tokens via secure httpOnly cookie

---

## 🔑 Multi-Tenant Support

All authenticated requests must include:

```http
X-Tenant-ID: org-123
```

This:

Enables tenant isolation in a shared DB or multi-DB model

Applies tenant-level scoping for caching, logging, and rate limiting

Ensures token claims are verified for allowed tenant access

---

## 🧠 Rate Scoping Strategy

| Endpoint Group | Scope Key | Limit |
|---|---|---|
| /auth/* | X-Tenant-ID + IP | 50 reqs / hour |
| /user/profile* | X-Tenant-ID + User ID | 200 reqs / hour |
| /users (admin) | X-Tenant-ID + Admin ID | 100 reqs / hour |
| /uploads/* | X-Tenant-ID + User ID | 100 reqs / hour |

Rate-limiting middleware should support dynamic tokens and tenant-aware keys.

---

## 🧾 Audit Logging

### Events Logged

| Action               | Metadata Captured                       |
| -------------------- | --------------------------------------- |
| `login`, `logout`    | IP, user-agent, userId, success/failure |
| `user:create`        | Admin ID, tenantId, payload             |
| `user:update/delete` | Admin ID, field diff, target userId     |
| `profile:change`     | User ID, operation type, merged payload |


### Emission Strategy
- Log JSON to /logs/audit.log
- Emit async Kafka-style event (audit:user.deleted, etc.)
- TTL-enabled DB table (e.g., audit_logs with 30-day retention)

---

## 🧹 Soft Delete Strategy

User Schema Additions:

```ts
{
  deletedAt?: ISODate,
  deletedBy?: userId,
  isDeleted: boolean
}
```

### Endpoint Behavior:
- All GET endpoints automatically exclude isDeleted: true
- All DELETE routes update deletedAt, isDeleted = true, and deletedBy
- Admin dashboard may query with ?includeDeleted=true

---

## 🧾 Data Contracts

`User` Object

```json
{
  "id": "string",
  "email": "string",
  "username": "string",
  "name": "string",
  "status": "registered | unregistered | invited | suspended",
  "registrationSource": "azure_ad | firebase | direct | invitation",
  "role": "user | admin | supervisor",
  "applications": [{
    "name": "blog | ecommerce | social",
    "role": "user | admin | supervisor",
    "joinedAt": "Date"
  }],
  "deletedAt": "ISODate",
  "deletedBy": "userId",
  "isDeleted": "boolean",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

---

## JWKS Caching Strategy Analysis

### **Multi-Layer JWKS Caching Architecture**

The solution implements a **four-tier caching hierarchy** that provides resilience and performance at enterprise level scale. The first layer uses **in-memory caching** with a 15-minute TTL for sub-millisecond access times, automatically falling back to **Redis** (1-hour TTL) when memory cache misses occur. The third layer leverages a **persistent database store** (24-hour TTL) that survives Redis failures and service restarts, while the final layer fetches fresh keys from **Azure AD** only when all caches are exhausted.

**Fallback mechanism** is solved through this cascading approach - if Azure AD becomes unavailable, the system gracefully degrades by serving progressively staler cached data, with circuit breaker protection preventing cascading failures. The circuit breaker opens after 50% error rate over 30 seconds, immediately serving cached data instead of attempting doomed Azure AD calls. **Cache stampede prevention** uses distributed Redis locks with 30-second timeouts, ensuring only one service instance fetches from Azure AD during cache misses, while other instances wait for the fresh data to populate through the cache layers.

**Background refresh** starts proactively when cached data reaches 80% of its TTL, using separate goroutines to refresh keys without blocking user requests. This eliminates the latency users experience during cache expiration, as fresh keys are always pre-populated before the old ones expire. The refresh process maintains a map of in-flight refresh promises to prevent duplicate background fetches, and includes jitter to avoid thundering herd problems across multiple service instances.

**Persistence across restarts** is guaranteed through the database layer, which stores JWKS keys with metadata including fetch timestamps, Azure AD response headers, and cache generation identifiers. On service startup, the system pre-warms all cache layers from the database, ensuring zero-downtime deployments. Redis provides additional persistence with configurable durability settings, while the memory layer rebuilds automatically from Redis during normal operations.

**Error recovery** includes exponential backoff with jitter for Azure AD calls, automatic retry logic with different strategies per error type (network vs. HTTP vs. malformed response), and graceful degradation that serves stale keys up to 24 hours old during extended outages. The system logs detailed error context including correlation IDs, tenant information, and performance metrics to enable rapid debugging. Failed Azure AD responses trigger intelligent cache extension, temporarily increasing TTLs to reduce upstream pressure during incidents.

**Comprehensive metrics** track cache hit rates across all layers, Azure AD call frequency and latency, circuit breaker state changes, background refresh success rates, and error distributions. The metrics integrate with Prometheus for alerting on cache performance degradation, unusual error rates, or Azure AD connectivity issues. Additional observability includes structured logging with correlation IDs, distributed tracing integration, and real-time dashboards showing cache efficiency and system health across the entire JWKS pipeline.

This architecture supports **millions of token validations per second** while maintaining 99.9% uptime even during Azure AD outages, with typical token validation latency under 1ms for cached keys and graceful degradation that never blocks authentication flows. The system automatically scales with traffic, requires minimal operational overhead, and provides the reliability needed for critical authentication infrastructure at enterprise scale.

Performance Targets:
  - 99.9% cache hit rate
  - <1ms token validation time
  - Zero downtime during Azure AD outages

### **Production Requirements:**
- **Multi-layer caching:** Memory → Redis → Database → Azure AD
- **Circuit breaker pattern:** Fail gracefully when Azure AD is unavailable
- **Background refresh:** Update cache before expiration
- **Stale cache fallback:** Use expired cache during outages
- **Monitoring & alerting:** Track cache hit rates and failures

---

## **Authentication Endpoints**

### `POST /auth/register`

Description: Register a new user with application context
* **Headers:** `x-tenant-id`
* **Body:**

```json
{
  "name": "string",
  "email": "string",
  "username": "string",
  "password": "string",
  "role": "user | admin | supervisor",
  "application": "blog | ecommerce | social"
}
```

Responses:

- 201 Created { accessToken: string }
- 409 Conflict — Email or username exists
- 422 Unprocessable Entity — Validation error


---

### `POST /auth/login`

* Login and receive tokens
* **Headers:** `x-tenant-id`
* **Body:**

```json
{
  "email": "string",
  "password": "string",
  "rememberMe": true
}
```

* **Success:** `200 OK` with cookies + tokens

---

### `POST /auth/logout`

Description: Logs user out and clears refresh token
* **Headers:** `x-tenant-id`
* **Security**: Authenticated

Response: 200 OK `{ message: "Logged out" }`

---

### `POST /auth/token`

**Description:** Exchange authorization code for access + ID + refresh tokens

* **Headers:** `x-tenant-id`
* **Security**: Authenticated

**Body Parameters:** (x-www-form-urlencoded)

* `client_id`
* `client_secret`
* `grant_type=authorization_code`
* `code`
* `redirect_uri`
* `scope`

**Response:**

```json
{
  "access_token": "...",
  "id_token": "...",
  "expires_in": 3600,
  "refresh_token": "...",
  "token_type": "Bearer"
}
```

---

### `GET /auth/refresh`

Description: Get new access token from refresh cookie

* **Headers:** `x-tenant-id`
* **Security**: Cookie-based auth
**Body Parameters:**

* `grant_type=refresh_token`
* `client_id`
* `client_secret`
* `refresh_token`

* **Success:** `200 OK` with new token

---


### `GET /auth/me`

Description: Get current logged-in user’s profile

* **Headers:** `x-tenant-id`
* **Security**: Access token

Response: 200 OK with user profile

---

### `GET /auth/jwks`

**Description:** Returns cached JWKS keys used for verifying tokens

* **Headers:** `x-tenant-id`
* **Security**: Authenticated

**Response:**

```json
{
  "keys": [ ... ]
}
```

---

### ✅ **Proposed Endpoint Design: `POST /auth/token/firebase-bridge`**

The `POST /auth/token/firebase-bridge` endpoint is meant to **bridge authentication from Firebase to your system**, i.e., verify a Firebase ID token and issue a local Storm Gate access/refresh token pair. This allows your multi-app ecosystem to use Firebase Auth **as a federated identity provider**, while unifying auth under your centralized Storm Gate system.


#### **Purpose:**

Verify Firebase-issued ID token, map or create user in your database, and issue a local Storm Gate access/refresh token.

#### **Headers**

* `Content-Type: application/json`
* `x-tenant-id: <TENANT_UUID>`

#### **Request Body**

```json
{
  "firebaseIdToken": "string"
}
```


#### **Authentication Logic (Server-side)**

1. **Verify Firebase Token**

   * Use Firebase Admin SDK to validate the token.
2. **Extract UID / Email**

   * Pull `uid`, `email`, `name`, `picture`, etc.
3. **Map or Create User in Storm Gate DB**

   * If user exists → proceed
   * If not → create user (optionally in `UnregisteredUser`)
4. **Issue Storm Gate Tokens**

   * `accessToken` and `refreshToken` using your local JWT strategy
5. **Audit Log** the bridge event for traceability

#### **Response**

```json
{
  "accessToken": "string",
  "refreshToken": "string",
  "user": {
    "id": "string",
    "email": "string",
    "name": "string",
    "picture": "string"
  }
}
```

#### **Error Responses**

| Code | Meaning                                   |
| ---- | ----------------------------------------- |
| 401  | Invalid Firebase token                    |
| 403  | User is disabled or blocked               |
| 500  | Internal error (e.g., Firebase API error) |

#### 🔐 **Security Considerations**

* Rate limit this endpoint aggressively.
* Log any invalid token attempts with metadata (`ip`, `user-agent`, etc.).
* Do not issue local tokens for anonymous Firebase users.
* Optionally restrict to specific Firebase project IDs.


#### 🔁 **Firebase Bridge = Firebase Auth → Storm Gate Tokens**

| Step | Description                                                                   |
| ---- | ----------------------------------------------------------------------------- |
| 1.   | **User signs in via Firebase** (Google, Apple, email/password, etc.).         |
| 2.   | Client receives a **Firebase ID token** (`firebaseIdToken`).                  |
| 3.   | Client sends that token to `POST /auth/token/firebase-bridge`.                |
| 4.   | Your backend **verifies the token with Firebase** (using Firebase Admin SDK). |
| 5.   | Once valid, you either **look up or create the user** in your local DB.       |
| 6.   | You issue your own **Storm Gate JWTs** (access + refresh).                    |
| 7.   | Azure is **not involved** — this is an alternative identity path.             |

---

#### 🧠 Why Use Firebase as a Bridge?

* For **mobile-first apps** that already use Firebase Auth.
* To **centralize sessions in Storm Gate** even if identity originates from Firebase.
* To allow **multi-provider login** (Firebase, Azure AD, password, etc.) under a unified API.

#### 👇 Visual Diagram

```
[Mobile/Web Client]
      |
      | 1. Sign in via Firebase
      ↓
[Firebase Auth Provider]
      |
      | 2. Get firebaseIdToken
      ↓
[Client]
      |
      | 3. POST /auth/token/firebase-bridge
      ↓
[Storm Gate Backend]
    → Verify token w/ Firebase Admin SDK
    → Map or create user
    → Issue Storm Gate JWTs
```

---


## **Admin User Management Endpoints 🔐 Protected Routes**

### `GET /users`

Description: List all users (includes unregistered, paginated)
* **Headers:** `x-tenant-id`
* **Auth:** Admin Required
* **Rate limited**
* **Query**: ?page=1&limit=25

---

### `POST /users`

Description: Admin creates new user
* **Headers:** `x-tenant-id`
* **Auth:** Admin Required
* **Rate limited**
* **Security**: Admin
* **Body:**

```json
{
  "name": "string",
  "email": "string",
  "password": "string",
  "role": "admin"
}
```

---

### `GET /users/:id`

Description: Admin fetches user by ID

* **Headers:** `x-tenant-id`
* **Auth:** Admin Required
* **Rate limited**
**Security**: Admin

Response: 200 OK — user object

* **Headers:** `x-tenant-id`

---

### `PUT /users/:id`

Description: Admin updates a user profile (includes append logic for articles, notifications, etc.)
* **Headers:** `x-tenant-id`
* **Auth:** Admin Required
* **Rate limited**
* **Audit Logged**
* **Security**: Admin
* **Soft delete logic not applicable here**

---

### `DELETE /users/:id`

Description: Admin soft deletes a user

* **Logic:** `deleted: true`, `deletedAt: timestamp`
* **Headers:** `x-tenant-id`
* **Auth:** Admin Required
* **Rate limited**
* **Audit Logged**

* Response: `204 No Content`

---

## 🧾 Profile Management (for Authenticated Users) 🔐 Protected Routes

### `GET /user/profile`

Description: Fetch current authenticated user details Returns enriched profile (notifications, saved articles). Get profile claims from the verified token

Security: Authenticated
* **Auth:** Admin Required
* **Rate limited**
* **Headers:**
  * `Authorization: Bearer <access_token>`
  * `x-tenant-id`

**Response:**

```json
{
  "sub": "user-id",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "roles": ["user"]
}
```

---

### `PUT /user/profile`

Description: Update profile fields (e.g., notifications, savedArticles)

Security: Authenticated
* **Headers:** `x-tenant-id`
* **Auth:** Admin Required
* **Rate limited**
**Body**: Partial profile object

---

### `DELETE /user/profile`

Description: Delete own account

* **Headers:** `x-tenant-id`
* **Auth:** Admin Required
* **Rate limited**
**Security**: Authenticated

Response: `204 No Content`

---

### `GET /user/profile/validate`

**Description:** Quick token validation and scope check

* **Headers:** `x-tenant-id`
* **Auth:** Admin Required
* **Rate limited**

**Response:**

```json
{
  "valid": true,
  "scopes": ["access_as_user"]
}
```

---

## 🧪 Unregistered Profiles 🔐 Protected Routes

### `POST /user/profiles/unregistered`

Description: Create a profile for an unregistered user (e.g., onboarding form)

* **Headers:** `x-tenant-id`
* **Rate limited**
* **Security**: Public or CAPTCHA-protected

Body:


```json
{
  "images": ["img1.jpg"],
  "user": {
    "name": "string",
    "bio": "string"
  }
}
```

---

### `GET /user/profiles/unregistered`

Description: List unregistered user profiles

* **Headers:** `x-tenant-id`
* **Rate limited**
* **Security**: Admin only

---

## **Image Upload Endpoints 🔐 Protected Routes**

### `POST /uploads/upload`

Description: Upload image to Cloudinary

Auth: ✅ Authenticated

FormData: `{ image: <file> }`

Response: `{ url, public_id }`

---

### `POST /uploads/profile/images`

Description: Get all images uploaded by the current user

* **Headers:** `x-tenant-id`
* **Rate limited**
* **Security**: Authenticated


Response: `[Image]`

---

### `POST /uploads/tenant/images`

Description: Admin fetches all Cloudinary uploads for tenant

* **Headers:** `x-tenant-id`
* **Rate limited**
* **Security**: Authenticated

```json
{
  "folder": "string"
}
```

---

### `POST /uploads/image/:id`

Description: Delete image by DB ID; Soft delete by DB ID

* **Headers:** `x-tenant-id`
* **Rate limited**
* **Security**: Owner or Admin

Response: 204 No Content

**Audit Logged**

---

### `POST /uploads/destroy`

Description: Remove image from Cloudinary via public_id; Delete from Cloudinary by `public_id`

* **Headers:** `x-tenant-id`
* **Rate limited**
* **Security**: Owner or Admin
* **Audit Logged**

Body: `{ public_id: string }`

Response: 204 No Content

---

## **Admin / Utility**

### `GET /health`

Description: Health check

Response: 200 OK `{ status: "healthy" }`

### `GET /metrics`

Description: Prometheus-compatible metrics endpoint

Response: `text/plain` content


### `GET /api-docs`

* Swagger UI auto-generated docs

---

## **Future Enhancements**

* 🔒 OAuth/OpenID support via Azure Entra ID (already drafted)
* 🌍 Regional rate limiting via edge location headers
* 🧠 ML-based anomaly detection for brute force protection
* 🔁 Webhook support for upload deletion confirmation
* 💡 Granular scopes (e.g. `user:edit:profile`, `user:read:others`)
* A security threat model for your auth flow
* 📦 A CI/CD plan for testing, linting, and validating changes per PR
* 🧪 A Postman Collection ready to test every route
* 🧾 An OpenAPI 3.1 spec file for your full API
* 📝 A refactored controller file applying these improvements
* Diagrams of this system (auth flow, caching, tenant isolation)
* Deployment best practices
* // Missing: Circuit breakers for external dependencies
* // Missing: Proper retry logic with exponential backoff
* // Missing: Graceful degradation when JWKS endpoint is down
* // Missing: Input validation middleware (noted as "planned" but critical)
* // Current: Basic rate limiting
  * // Needed: Adaptive rate limiting based on user behavior
  * // Needed: Brute force protection with progressive delays
  * // Needed: Input sanitization and validation middleware
* Token rotation support
* ✅ HTTP-only secure cookies
* ✅ API cache layer (Redis or memory fallback)
* CSRF protection 
* Structured logs, tracing ID, metrics, audit trail
* CDN caching headers
* API observability - Attach Datadog, Sentry, or Honeycomb
* CSRF/Cookie flags - ⚠️ Add `secure`, `sameSite`, `domain`
  * * **Problem:** `accesstoken` and `refreshtoken` are stored in cookies without `secure`, `sameSite`, and `domain` settings.
  * **Fix:**

    ```js
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    domain: process.env.COOKIE_DOMAIN || "yourdomain.com",
    ```
  * **Why:** Reduces risk of CSRF and session hijacking.
* Input validation - ❌ Add Joi/Zod 
* **Circuit Breakers** - Add for all external services
* **Audit Logging** - Structured logs with correlation IDs
* **Rate Limiting** - Multi-dimensional, adaptive
* Authorization:
  * Granular scopes/permissions
  * Dynamic permission checking
* Monitoring:
  * Security event alerting
  * Anomaly detection
  * Distributed tracing
* ⚠️ Role checks are **manual and repeated** — this leads to drift and bugs.
* Add a `validateSchema(schema)` middleware using `zod` or `joi`.
* Move RBAC to `authMiddleware({ roles: ['admin'] })`.
* Use `helmet` + `rate-limit` + `cors` strict policies per environment.
* Normalize cookie and token security flags.
* ⚠️ `getAllUsers` does not paginate — this breaks at scale.
* ⚠️ Caching is done via cookies (`users-cache`) instead of a distributed caching layer.
* ⚠️ No `ETag`, `Last-Modified`, or conditional GETs.
* Implement pagination with `limit`, `skip`, `total`, and `hasNextPage`.
  * **Why:** Avoids memory overload and improves frontend performance.
* Add Redis-backed cache (optionally via `cache-manager`) for all user lookups.
* Add ETag headers for immutable responses (`GET /api/users`).
* Use durable audit logging for changes (Kafka-style or DB + TTL table).
* ✅ You’re using `Logger` — great.
* ⚠️ Missing structured metadata: no correlation ID, user ID, route path, etc.
* ⚠️ No Sentry/New Relic/Honeycomb instrumentation.
* ⚠️ No OpenAPI spec.
* Add Swagger/OpenAPI 3.1 spec.
* Publish via Redoc or Swagger-UI.
* Add Postman collection or Insomnia workspace for testing.
* Attach `req.id` (UUID per request) and include in logs.
* Use structured logging (`pino`, `winston`) with JSON outputs.
* Emit audit events to `audit.log` for mutations (create/update/delete).
* Add `GET /health` and `GET /metrics` endpoints for uptime monitors & Prometheus.
* Add `express-rate-limit` or similar to `login`, `register`, and `refreshToken`.
* Move all hardcoded settings like token expiry durations, role lists, and `maxAge` values to environment variables or a `config.js`.
* **Fix:** Consider using JWT in `Authorization` headers instead of cookies for SPA/mobile API-first apps unless browser sessions are explicitly needed.
* **Fix:** Add cache invalidation for `updateProfile`, `deleteProfile`, and `addUser`.
  * **Why:** Prevents stale reads after writes or deletes.
* **Recommended API Conventions:**
    ```yaml
    Route Patterns:
    - /auth/* - Authentication operations
    - /users/* - Admin user management  
    - /profile - Current user operations
    - /uploads - User upload operations
    - /admin/uploads - Admin upload operations
    ```

---

## Endpoint Overview 

POST    /api/auth/register          → Register new user

POST    /api/auth/login             → Login and return tokens

POST    /api/auth/logout            → Invalidate session + clear cookies

GET     /api/auth/refresh           → Issue new access token

GET     /api/auth/me                → Return current user profile

### Admin User Management

GET     /api/users                  → List users (paginated)

POST    /api/users                  → Admin creates user

GET     /api/users/:id              → Get user by ID

PUT     /api/users/:id              → Edit user

DELETE  /api/users/:id              → Delete user

### User Profile Management (self-managed or admin-reviewed)

GET     /api/user/profile           → Get enriched profile

PUT     /api/user/profile/:id       → Update user profile

DELETE  /api/user/profile/:id       → Delete profile

### Unregistered Profiles

POST    /api/user/profile           → Add unregistered user profile (public form)

GET     /api/user/unregistered      → List unregistered profiles (admin)

### DevOps

GET     /health                     → Basic health check

GET     /metrics                    → Prometheus metrics


---

## 📋 **Current Rate Limiter Analysis**

### **Current Implementation Review:**
```typescript
// Your current limiter: Basic IP-based with fixed rules
windowMs: 60 * 60 * 1000, // 1 hour
max: 100, // 100 requests per IP per hour
```

### **Documented Limitations:**
| Limitation | Business Impact | Solution Needed |
|------------|-----------------|-----------------|
| **IP-Only Scope** | No tenant isolation - one tenant can exhaust limits for others | Multi-dimensional scoping |
| **Fixed Rules** | Same limits for login vs profile vs admin operations | Endpoint-specific rules |
| **No User Context** | Can't differentiate between authenticated vs anonymous | User-aware limiting |
| **Basic Algorithm** | Fixed window allows burst attacks | Sliding window implementation |
| **No Abuse Detection** | No alerting for suspicious patterns | Advanced monitoring |

### **Recommended Rate Limiting Strategy:**

#### **Scoping Matrix:**
| Endpoint Category | Scope | Limit | Window | Rationale |
|-------------------|-------|--------|--------|-----------|
| `/auth/login` | `tenant + IP` | 10 requests | 15 minutes | Prevent brute force per tenant |
| `/auth/register` | `tenant + IP` | 5 requests | 1 hour | Prevent fake account creation |
| `/user/profile*` | `tenant + user` | 200 requests | 1 hour | Normal user operations |
| `/users*` (admin) | `tenant + user` | 100 requests | 1 hour | Admin operations monitoring |
| `/uploads*` | `tenant + user` | 100 requests | 1 hour | File upload abuse prevention |
| Global fallback | `IP` | 1000 requests | 1 hour | DDoS protection |

#### **Advanced Features Needed:**
- **Sliding window algorithm** for more accurate limiting
- **Adaptive limits** based on system load
- **Whitelist management** for trusted sources  
- **Abuse detection** with alerting
- **Redis-backed** for distributed systems

### **Rate Limiting Performance:**
```yaml
Challenge: "How does rate limiting perform under high load?"

Current Bottleneck:
  - Simple Redis INCR operations
  - Fixed window algorithm
  - No distributed coordination

High-Performance Solutions:
  - Sliding window with Redis sorted sets
  - Token bucket for memory efficiency
  - Local rate limiting with eventual consistency
  - Adaptive limits based on system metrics

Performance Targets:
  - <5ms rate limit check time
  - Support 100K+ requests/second
  - Graceful degradation under Redis failure
```

---

## 📋 **MongoDB Sharding Documentation**

### **Tenant-Based Sharding Strategy:**

#### **Shard Key Selection:**
```yaml
Primary Shard Key: tenant_id
Rationale: 
  - Natural isolation boundary
  - Even distribution across tenants
  - Queries always include tenant context
  - Supports tenant-specific scaling
```

#### **Shard Distribution:**
```yaml
Shard Architecture:
  - Shard 0: tenant_id hash % 4 = 0
  - Shard 1: tenant_id hash % 4 = 1  
  - Shard 2: tenant_id hash % 4 = 2
  - Shard 3: tenant_id hash % 4 = 3

Collection Strategy:
  - Each shard contains: users, uploads, audit_logs
  - Sharded by: { tenant_id: 1 }
  - Indexed by: { tenant_id: 1, [specific_field]: 1 }
```

#### **Query Patterns:**
| Query Type | Performance | Shard Targeting |
|------------|-------------|-----------------|
| **Single tenant operations** | ⚡ Excellent | Single shard |
| **User lookup by tenant** | ⚡ Excellent | Single shard |
| **Cross-tenant analytics** | 🐌 Expensive | All shards |
| **Global admin queries** | 🐌 Expensive | All shards |

#### **Operational Considerations:**
- **Tenant migration:** Requires resharding if tenant grows too large
- **Hot tenants:** May need dedicated shards for very large tenants
- **Backup strategy:** Per-shard backups with cross-shard consistency
- **Monitoring:** Track shard utilization and query distribution


```yaml
Challenge: "What's the strategy for database sharding across tenants?"

MongoDB Native Sharding:
  - Automatic shard balancing
  - Built-in chunk splitting
  - Query routing optimization
  - Online shard addition

Operational Strategy:
  - Start with 4 shards
  - Monitor shard utilization
  - Add shards when 70% capacity
  - Pre-split chunks for new tenants

Cross-Shard Considerations:
  - Global analytics via aggregation pipeline
  - Search service (Elasticsearch) for cross-tenant queries
  - Data warehouse for reporting
  - Admin dashboards with federation layer
```
---

