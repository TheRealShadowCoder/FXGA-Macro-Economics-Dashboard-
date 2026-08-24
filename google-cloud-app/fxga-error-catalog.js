export const FXGA_ERROR_CATALOG = {
  invalid_request: { status: 400, title: 'The request is not valid', explanation: 'FXGA sent Gemini information in a format it could not use.', action: 'Check the selected task and input fields, then try again.', retryable: false },
  failed_precondition: { status: 400, title: 'A required Google setting is not ready', explanation: 'The request needs a project, billing, region, account, or API prerequisite that is not currently satisfied.', action: 'Check the Google AI project setup and required services.', retryable: false },
  parameter_unknown: { status: 400, title: 'Gemini received an unsupported setting', explanation: 'A request option is not recognized by the current Gemini API.', action: 'Update the request to use supported Gemini parameters.', retryable: false },
  authentication: { status: 401, title: 'Gemini could not authenticate', explanation: 'The server-side Gemini API key is missing, invalid, expired, or no longer accepted.', action: 'Verify or rotate the Gemini key in Google Secret Manager. The key must never be placed in the browser.', retryable: false },
  permission_denied: { status: 403, title: 'Google blocked this request', explanation: 'The project or API key does not have permission to use the requested model or resource.', action: 'Check the project, model access, API key restrictions, and IAM permissions.', retryable: false },
  not_found: { status: 404, title: 'The requested information was not found', explanation: 'FXGA asked for a stored resource that does not exist or is no longer available.', action: 'Refresh the data or choose another stored item.', retryable: false },
  model_not_found: { status: 404, title: 'The selected Gemini model is unavailable', explanation: 'Google could not find or use the configured model name.', action: 'FXGA can use the configured fallback model. If both fail, verify the model IDs in the deployment.', retryable: false },
  already_exists: { status: 409, title: 'That item already exists', explanation: 'The operation tried to create something that has already been created.', action: 'Use the existing item instead of creating a duplicate.', retryable: false },
  aborted: { status: 409, title: 'The operation conflicted with another update', explanation: 'A concurrent update caused this operation to be cancelled safely.', action: 'Try the request again. FXGA should not duplicate the underlying work.', retryable: true },
  request_timeout: { status: 408, title: 'The request took too long', explanation: 'The connection did not complete within the allowed time.', action: 'Try again. If it repeats, reduce the requested data scope or check Google Cloud health.', retryable: true },
  payload_too_large: { status: 413, title: 'Too much information was sent at once', explanation: 'The request exceeded the safe FXGA payload size.', action: 'Ask a narrower question or let FXGA select only the relevant evidence.', retryable: false },
  out_of_range: { status: 416, title: 'A requested value is outside the allowed range', explanation: 'One of the request values is larger, smaller, or otherwise outside the supported limits.', action: 'Use a supported value or let FXGA choose the default.', retryable: false },
  invalid_schema: { status: 422, title: 'The incoming data does not match the expected FXGA format', explanation: 'A webhook or structured payload is missing required fields or uses the wrong schema.', action: 'Check the sending indicator or integration version and its required fields.', retryable: false },
  rate_limit_exceeded: { status: 429, title: 'Gemini is receiving requests too quickly', explanation: 'Google has reached a short-term request or token rate limit for this project/model.', action: 'FXGA will respect Google retry guidance. Wait briefly and try again; this is not an FXGA hourly cap.', retryable: true },
  quota_exceeded: { status: 429, title: 'The current Gemini quota has been used', explanation: 'Google reports that the project/model has reached a longer-period quota such as the daily allowance.', action: 'Wait for Google to reset the quota or change the Google usage tier. FXGA does not add another daily cap.', retryable: false },
  cancelled: { status: 499, title: 'The request was cancelled', explanation: 'The browser, network, or caller ended the request before Gemini finished.', action: 'Run the request again if you still need the answer.', retryable: true },
  api_error: { status: 500, title: 'Gemini had an internal error', explanation: 'Google returned an unexpected server-side failure.', action: 'Try again. FXGA will use transient-error retry logic and the fallback model where appropriate.', retryable: true },
  unimplemented: { status: 501, title: 'That Gemini feature is not supported', explanation: 'The requested operation is not implemented for this API or model.', action: 'Use a supported task/model combination.', retryable: false },
  bad_gateway: { status: 502, title: 'FXGA could not get a usable answer from Gemini', explanation: 'The upstream model returned an invalid, empty, or otherwise unusable response.', action: 'Try again. If it repeats, check model availability and the server logs.', retryable: true },
  service_unavailable: { status: 503, title: 'Gemini is temporarily unavailable', explanation: 'Google is overloaded, unavailable, or the FXGA Gemini service is not configured yet.', action: 'Try again shortly. Check the FXGA intelligence health page if the problem continues.', retryable: true },
  deadline_exceeded: { status: 504, title: 'Gemini did not finish in time', explanation: 'The model request exceeded its deadline.', action: 'Try again. A narrower task may complete faster.', retryable: true },
  network_error: { status: 0, title: 'The browser cannot reach FXGA', explanation: 'The request failed before a normal HTTP response was received.', action: 'Check your connection and the Google Cloud service health, then try again.', retryable: true },
  firestore_permission_denied: { status: 503, title: 'FXGA cannot read its stored evidence', explanation: 'Google Firestore rejected the service account permission for the requested data.', action: 'Check the Cloud Run runtime service account and Firestore IAM roles.', retryable: false },
  firestore_resource_exhausted: { status: 503, title: 'Firestore is temporarily at a usage limit', explanation: 'The database reached a quota, throughput, or resource limit.', action: 'Reduce unnecessary reads and retry after the limit clears.', retryable: true },
  firestore_unavailable: { status: 503, title: 'Stored FXGA evidence is temporarily unavailable', explanation: 'Firestore could not serve the requested data.', action: 'Try again. FXGA should not invent missing evidence while the database is unavailable.', retryable: true },
  content_blocked: { status: 422, title: 'Gemini did not generate an answer', explanation: 'The model stopped because the requested generation was blocked or could not be completed safely.', action: 'Rephrase the question or use a narrower analytical task.', retryable: false },
  unknown_error: { status: 500, title: 'Something unexpected happened', explanation: 'FXGA received an error that does not match a known category yet.', action: 'Try again. The technical code is preserved for diagnostics without exposing secrets.', retryable: true },
};

const STATUS_TO_CODE = { 400: 'invalid_request', 401: 'authentication', 403: 'permission_denied', 404: 'not_found', 408: 'request_timeout', 409: 'aborted', 413: 'payload_too_large', 416: 'out_of_range', 422: 'invalid_schema', 429: 'rate_limit_exceeded', 499: 'cancelled', 500: 'api_error', 501: 'unimplemented', 502: 'bad_gateway', 503: 'service_unavailable', 504: 'deadline_exceeded' };

export function classifyFxgaError(error = {}, fallbackStatus = 500) {
  const status = Number(error.statusCode || error.status || fallbackStatus || 500);
  const providerCode = String(error.providerCode || error.code || '').toLowerCase();
  const message = String(error.message || error.details || '').toLowerCase();
  let code = providerCode && FXGA_ERROR_CATALOG[providerCode] ? providerCode : STATUS_TO_CODE[status] || 'unknown_error';
  if (status === 429 && /daily|quota_exceeded|requests per day|rpd/.test(`${providerCode} ${message}`)) code = 'quota_exceeded';
  else if (status === 429) code = 'rate_limit_exceeded';
  if (/firestore|grpc/.test(message) && /permission[_ -]?denied/.test(message)) code = 'firestore_permission_denied';
  if (/firestore|grpc/.test(message) && /resource[_ -]?exhausted/.test(message)) code = 'firestore_resource_exhausted';
  if (/firestore|grpc/.test(message) && /unavailable/.test(message)) code = 'firestore_unavailable';
  if (/aborterror|fetch failed|network/.test(message) && !status) code = 'network_error';
  if (/blocked|safety|content.*filter/.test(`${providerCode} ${message}`)) code = 'content_blocked';
  const base = FXGA_ERROR_CATALOG[code] || FXGA_ERROR_CATALOG.unknown_error;
  return {
    schema: 'fxga.error.v1',
    code,
    category: code.startsWith('firestore_') ? 'data' : ['authentication','permission_denied'].includes(code) ? 'access' : ['rate_limit_exceeded','quota_exceeded'].includes(code) ? 'quota' : 'service',
    title: base.title,
    explanation: base.explanation,
    whatToDo: base.action,
    retryable: base.retryable,
    retryAfterSeconds: Number.isFinite(Number(error.retryAfterSeconds)) ? Number(error.retryAfterSeconds) : null,
    technical: { httpStatus: Number.isFinite(status) ? status : null, providerCode: providerCode || null },
  };
}

export function publicErrorCatalog() {
  return Object.fromEntries(Object.entries(FXGA_ERROR_CATALOG).map(([code, value]) => [code, { code, ...value }]));
}
