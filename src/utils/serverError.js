// 500 responses used to send `err.message` (and in two places the whole error
// object) to the client, exposing database errors, collection names and query
// shapes. The detail belongs in the log; the client gets a fixed message.

export const GENERIC_SERVER_ERROR = 'Something went wrong. Please try again.';

/**
 * Log `err` with its stack and answer 500 with a generic `msg`.
 * `logger` is optional so middleware without one still logs to the console.
 */
export function sendServerError(res, err, logger, context = 'Unhandled error') {
  // Error objects serialize to {} in JSON logs, so pass the fields explicitly.
  const detail = { message: err?.message, name: err?.name, stack: err?.stack };
  if (logger) logger.error(context, detail);
  else console.error(context, detail);
  return res.status(500).json({ msg: GENERIC_SERVER_ERROR });
}
