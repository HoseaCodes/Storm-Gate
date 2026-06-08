export function extractToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^\s*bearer\s+(.+)$/i);
  if (match) return match[1].trim() || null;
  const trimmed = authHeader.trim();
  if (!trimmed) return null;
  if (/^bearer\s*$/i.test(trimmed)) return null;
  return trimmed;
}
