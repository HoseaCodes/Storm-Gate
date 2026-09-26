// Registration fields a client must never choose for itself.
//
// `role` used to be copied from the request body, and the User schema accepts
// "admin" and "superAdmin", so POST /register {"role":"admin"} minted an admin
// that requireAdmin (and every consumer reading /me's role) trusted. `status`
// was also client-chosen: approval only applied when the client asked for it,
// so a caller could skip the approval gate by leaving the field out.
//
// Both are now decided here. Admins are made by an existing admin, not by
// signing up.

export const REGISTRATION_ROLE = 'basic';

// Fields a profile update must never write from a request body. Changing any of
// them is a privilege, identity or credential change with its own flow.
export const PROTECTED_USER_FIELDS = [
  '_id',
  'kind',
  'role',
  'status',
  'application',
  'authProvider',
  'email',
  'password',
  'resetPasswordToken',
  'resetPasswordExpires',
];

/** A copy of `body` without PROTECTED_USER_FIELDS, plus the names removed. */
export function stripProtectedUserFields(body = {}) {
  const allowed = { ...body };
  const removed = PROTECTED_USER_FIELDS.filter((field) => field in allowed);
  removed.forEach((field) => delete allowed[field]);
  return { allowed, removed };
}

// Applications whose sign-ups always wait for admin approval, regardless of
// what the client sends. Override with a comma-separated list.
const DEFAULT_APPROVAL_REQUIRED_APPLICATIONS = ['blog'];

export function approvalRequiredApplications() {
  const configured = process.env.APPROVAL_REQUIRED_APPLICATIONS;
  if (configured === undefined) return DEFAULT_APPROVAL_REQUIRED_APPLICATIONS;
  return configured
    .split(',')
    .map((app) => app.trim())
    .filter(Boolean);
}

/**
 * Status for a new account. A client may ask for PENDING (a stricter outcome),
 * but can never make itself APPROVED or DENIED.
 */
export function resolveRegistrationStatus({ application, requestedStatus }) {
  if (requestedStatus === 'PENDING') return 'PENDING';
  if (approvalRequiredApplications().includes(application)) return 'PENDING';
  return 'APPROVED';
}
