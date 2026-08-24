export type FriendlyFxgaError = {
  schema?: 'fxga.error.v1';
  code: string;
  category: string;
  title: string;
  explanation: string;
  whatToDo: string;
  retryable: boolean;
  retryAfterSeconds?: number | null;
  technical?: { httpStatus?: number | null; providerCode?: string | null };
};

const STATUS: Record<number, Omit<FriendlyFxgaError, 'code'>> = {
  400: { category: 'input', title: 'I could not use that request', explanation: 'Some information sent to FXGA or Gemini is missing or not in the expected format.', whatToDo: 'Try the question again. If it repeats, choose a more specific task.', retryable: false },
  401: { category: 'access', title: 'Gemini authentication needs attention', explanation: 'The server-side Gemini key was not accepted.', whatToDo: 'Check the Gemini key stored in Google Secret Manager. Do not put the key in the browser.', retryable: false },
  403: { category: 'access', title: 'Google refused permission', explanation: 'The project, key, model, or service account does not have the required access.', whatToDo: 'Check Google project access, API-key restrictions, model access and IAM.', retryable: false },
  404: { category: 'data', title: 'FXGA could not find that item', explanation: 'The requested signal, model, resource or stored record is not available.', whatToDo: 'Refresh the page or select another stored item.', retryable: false },
  408: { category: 'network', title: 'The request took too long', explanation: 'The request did not complete within the allowed time.', whatToDo: 'Try again. If it repeats, use a narrower question.', retryable: true },
  409: { category: 'conflict', title: 'Another update happened at the same time', explanation: 'The operation conflicted with a concurrent update and stopped safely.', whatToDo: 'Try again.', retryable: true },
  413: { category: 'input', title: 'Too much information was sent at once', explanation: 'The request is larger than the safe FXGA input size.', whatToDo: 'Ask a narrower question or analyze one setup at a time.', retryable: false },
  422: { category: 'input', title: 'The data format is not valid for this task', explanation: 'A structured payload or integration does not match the expected FXGA schema.', whatToDo: 'Check the sending integration and required fields.', retryable: false },
  429: { category: 'quota', title: 'Google Gemini has reached a current limit', explanation: 'This can be a short-term request/token rate limit or a longer quota limit. FXGA is not adding its own hourly or daily cap.', whatToDo: 'Follow the retry guidance shown below. If it is a daily quota, wait for Google to reset it.', retryable: true },
  499: { category: 'network', title: 'The request was cancelled', explanation: 'The browser or connection ended the request before it completed.', whatToDo: 'Try again if you still need the answer.', retryable: true },
  500: { category: 'service', title: 'The service had an unexpected error', explanation: 'The server could not complete the request normally.', whatToDo: 'Try again. Check system health if the problem repeats.', retryable: true },
  501: { category: 'service', title: 'That feature is not supported', explanation: 'The selected API or model does not implement the requested feature.', whatToDo: 'Use a supported FXGA task or model.', retryable: false },
  502: { category: 'service', title: 'Gemini did not return a usable answer', explanation: 'FXGA reached the model, but the upstream response was empty or invalid.', whatToDo: 'Try again. FXGA may use the fallback model when appropriate.', retryable: true },
  503: { category: 'service', title: 'The intelligence service is temporarily unavailable', explanation: 'Google Gemini, Cloud Run, Firestore, or the FXGA intelligence configuration is temporarily unavailable.', whatToDo: 'Try again shortly and check intelligence health if it continues.', retryable: true },
  504: { category: 'service', title: 'Gemini did not finish in time', explanation: 'The model request exceeded its deadline.', whatToDo: 'Try again or ask a narrower question.', retryable: true },
};

export class FxgaRequestError extends Error {
  friendly: FriendlyFxgaError;
  status: number;
  constructor(friendly: FriendlyFxgaError, status = 500) {
    super(friendly.title);
    this.name = 'FxgaRequestError';
    this.friendly = friendly;
    this.status = status;
  }
}

export function friendlyErrorFromResponse(status: number, body: any): FriendlyFxgaError {
  if (body?.friendlyError && typeof body.friendlyError === 'object') return body.friendlyError as FriendlyFxgaError;
  const base = STATUS[status] || { category: 'unknown', title: 'Something unexpected happened', explanation: 'FXGA received an error that is not in the known catalog yet.', whatToDo: 'Try again and check system health if the problem continues.', retryable: true };
  const raw = String(body?.error || body?.message || '').toLowerCase();
  if (status === 429 && /daily|quota|rpd/.test(raw)) return { code: 'quota_exceeded', ...base, title: 'The current Gemini quota has been used', explanation: 'Google reports a longer-period quota has been reached. This is not an FXGA application cap.', retryable: false };
  return { code: `http_${status}`, ...base, technical: { httpStatus: status, providerCode: null } };
}

export function friendlyErrorFromThrown(error: unknown): FriendlyFxgaError {
  if (error instanceof FxgaRequestError) return error.friendly;
  if (error instanceof DOMException && error.name === 'AbortError') return { code: 'cancelled', category: 'network', title: 'The request was cancelled', explanation: 'The browser stopped the request before it finished.', whatToDo: 'Run it again if you still need the answer.', retryable: true };
  const message = error instanceof Error ? error.message : String(error || '');
  if (/fetch|network|failed to fetch|load failed/i.test(message)) return { code: 'network_error', category: 'network', title: 'The browser cannot reach FXGA', explanation: 'No normal server response was received.', whatToDo: 'Check your connection and the Google Cloud service, then try again.', retryable: true };
  return { code: 'unknown_error', category: 'unknown', title: 'Something unexpected happened', explanation: message || 'FXGA encountered an unknown error.', whatToDo: 'Try again and check system health if it continues.', retryable: true };
}
