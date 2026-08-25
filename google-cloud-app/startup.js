// Startup is deliberately sequential. The Gemini credential bootstrap must finish
// before the intelligence modules read process.env.GEMINI_API_KEY at module load.
await import('./gemini-bootstrap.js');
// Load this before gemini-hook.js so its request wrapper sits outside the legacy
// JSON gateway and converts legacy analyze calls to the resilient stream route.
await import('./gemini-legacy-resilience.js');
await import('./gemini-hook.js');
await import('./fxga-intelligence-extension.js');
await import('./fxga-gemini-streaming-extension.js');
await import('./server.js');
