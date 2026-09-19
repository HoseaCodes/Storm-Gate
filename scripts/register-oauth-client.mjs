#!/usr/bin/env node
// Register (or update) a service client permitted to act on users' behalf.
//
//   node scripts/register-oauth-client.mjs \
//     --id workout-mcp \
//     --name "Workout Coach" \
//     --description "Generates your morning and evening sessions" \
//     --audience manifestathletics-api \
//     --redirect https://www.manifestathletics.com/connections/callback \
//     --scope training:read --scope workouts:read --scope workouts:write
//
//   --public          client cannot hold a secret; PKCE is its only proof
//   --rotate-secret   issue a new secret for an existing client
//   --disable         set status=disabled (stops it immediately)
//
// The client secret is generated here, printed once, and stored only as a
// bcrypt hash. There is no way to read it back -- losing it means rotating.
//
// A registration endpoint was deliberately not added: clients are registered
// rarely and by an operator, so a script avoids standing up an authenticated
// admin surface whose only job is to create credentials.
import crypto from 'crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import ServiceClient from '../src/models/serviceClient.js';
import { validateRegistration } from '../src/utils/clientRegistration.js';

function args() {
  const out = { redirect: [], scope: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (['public', 'rotate-secret', 'disable', 'help'].includes(key)) {
      out[key] = true;
      continue;
    }
    const value = argv[i + 1];
    i += 1;
    if (key === 'redirect' || key === 'scope') out[key].push(value);
    else out[key] = value;
  }
  return out;
}

const opts = args();

if (opts.help || !opts.id) {
  console.log('Usage: node scripts/register-oauth-client.mjs --id <clientId> [options]');
  console.log('       See the header of this file for the full option list.');
  process.exit(opts.help ? 0 : 1);
}

// Argument validation happens before the database connection, so a typo fails
// immediately instead of after a connection attempt.
const redirects = opts.redirect.filter(Boolean);
if (!opts.disable) {
  // `isNew` is assumed until proven otherwise; re-checked once the client is
  // loaded, so an update is not forced to re-supply everything.
  const errors = validateRegistration({
    clientId: opts.id,
    redirectUris: redirects,
    audience: opts.audience,
    scopes: opts.scope,
    isNew: false,
  });
  if (errors.length > 0) {
    console.error(`\nFailed:\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
  }
}

const uri = process.env.MONGODB_URL;
if (!uri) {
  console.error('MONGODB_URL is not set. Export it, or run via `make` with your env loaded.');
  process.exit(1);
}

await mongoose.connect(uri);

try {
  const existing = await ServiceClient.findOne({ clientId: opts.id });

  if (opts.disable) {
    if (!existing) throw new Error(`No client registered with id "${opts.id}"`);
    existing.status = 'disabled';
    await existing.save();
    console.log(`Disabled "${opts.id}". Existing grants remain but no new tokens will issue.`);
    process.exit(0);
  }

  const isConfidential = !opts.public;

  // Now that we know whether this is a create or an update, re-check the
  // fields that are only mandatory for a new client.
  const newClientErrors = validateRegistration({
    clientId: opts.id,
    redirectUris: redirects,
    audience: opts.audience,
    scopes: opts.scope,
    isNew: !existing,
  });
  if (newClientErrors.length > 0) {
    throw new Error(`\n  - ${newClientErrors.join('\n  - ')}`);
  }

  let plaintextSecret = null;
  const update = {};

  if (opts.name) update.name = opts.name;
  if (opts.description) update.description = opts.description;
  if (opts.audience) update.audience = opts.audience;
  if (redirects.length > 0) update.redirectUris = redirects;
  if (opts.scope.length > 0) update.allowedScopes = opts.scope;
  update.isConfidential = isConfidential;
  update.status = 'active';

  if (isConfidential && (!existing || opts['rotate-secret'])) {
    plaintextSecret = crypto.randomBytes(32).toString('base64url');
    update.clientSecretHash = await bcrypt.hash(plaintextSecret, 12);
  }

  if (!existing) {
    if (!update.name) update.name = opts.id;
    // A public client still needs the field populated; it is never compared.
    if (!update.clientSecretHash) update.clientSecretHash = 'public-client-no-secret';
    await ServiceClient.create({ clientId: opts.id, ...update });
    console.log(`Registered "${opts.id}".`);
  } else {
    Object.assign(existing, update);
    await existing.save();
    console.log(`Updated "${opts.id}".`);
  }

  const saved = await ServiceClient.findOne({ clientId: opts.id }).lean();
  console.log('');
  console.log(`  client_id     ${saved.clientId}`);
  console.log(`  name          ${saved.name}`);
  console.log(`  audience      ${saved.audience}`);
  console.log(`  scopes        ${saved.allowedScopes.join(' ')}`);
  console.log(`  redirect_uris ${saved.redirectUris.join('\n                ')}`);
  console.log(`  type          ${saved.isConfidential ? 'confidential' : 'public (PKCE only)'}`);

  if (plaintextSecret) {
    console.log('');
    console.log('  client_secret (shown once, not recoverable):');
    console.log(`  ${plaintextSecret}`);
    console.log('');
    console.log('  Store it in the client\'s secret manager now.');
  }
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
