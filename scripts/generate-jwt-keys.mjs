#!/usr/bin/env node
// Generate an RSA keypair for RS256 access-token signing.
//
//   node scripts/generate-jwt-keys.mjs            # print env-ready values
//   node scripts/generate-jwt-keys.mjs --base64   # single-line, for secret stores
//
// The private key is printed to stdout and never written to disk -- pipe it
// straight into your secret manager. Losing it is not a crisis: rotate by
// generating a new pair, moving the old public key into
// JWT_PREVIOUS_PUBLIC_KEYS, and letting outstanding tokens expire.
import crypto from 'crypto';

const useBase64 = process.argv.includes('--base64');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// RFC 7638 thumbprint -- must match the kid computed in src/utils/signingKeys.js.
const jwk = crypto.createPublicKey(publicKey).export({ format: 'jwk' });
const kid = crypto
  .createHash('sha256')
  .update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n }))
  .digest('base64url');

const enc = (pem) => (useBase64 ? Buffer.from(pem).toString('base64') : pem.trim());

console.log(`# Key ID (kid): ${kid}`);
console.log('# Add these to your secret store, then set JWT_SIGNING_ALG=RS256 to cut over.\n');
console.log(`JWT_PRIVATE_KEY=${useBase64 ? enc(privateKey) : `"${privateKey.trim()}"`}\n`);
console.log(`JWT_PUBLIC_KEY=${useBase64 ? enc(publicKey) : `"${publicKey.trim()}"`}\n`);
console.log('# Leave JWT_SIGNING_ALG unset (or HS256) to keep signing HS256 while');
console.log('# still publishing this key at /.well-known/jwks.json.');
