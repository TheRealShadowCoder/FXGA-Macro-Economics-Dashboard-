const base = String(process.env.FXGA_API_BASE || '').replace(/\/$/, '');
if (!base) throw new Error('FXGA_API_BASE is required');

const tests = [
  { name: 'market', task: 'cross-asset', question: 'Summarize the current FXGA cross-asset evidence and the most important conflicts. Use only stored evidence.' },
  { name: 'macro', task: 'macro-analysis', question: 'Explain the current FXGA macro regime using stored evidence only. Separate growth, inflation, labour and rates.' },
  { name: 'event-research', task: 'event-study', question: 'Explain the current FXGA event-study validation, sample maturity and what remains unproven.' },
  { name: 'action-report', task: 'program-chat', question: 'Produce the current FXGA WAIT WATCH PREPARE action report using stored evidence only.' },
  { name: 'scalp-buy', task: 'scalp-buy-entry', question: 'Assess whether current stored evidence supports a scalp BUY setup. Give entry logic, invalidation, stop and targets only when evidence supports them.' },
  { name: 'day-management', task: 'day-trade-management-live', question: 'Explain how the strongest current day-trade setup should be managed using stored evidence only. If no valid setup exists, say so.' },
  { name: 'long-term-buy', task: 'long-term-buy-entry', question: 'Assess current long-term BUY evidence, invalidation, stop logic and target logic without inventing a trade.' },
  { name: 'session-targets', task: 'session-target-zones', question: 'Identify current session evidence-backed target zones and invalidation without claiming any target is guaranteed.' },
  { name: 'session-management', task: 'session-trade-management-live', question: 'Manage the strongest current session setup using stored evidence only, including expiry, invalidation, stop and targets if a valid setup exists.' },
];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseFrames(text, onFrame) {
  let buffer = text;
  for (;;) {
    const match = buffer.match(/\r?\n\r?\n/);
    if (!match || match.index == null) break;
    const frame = buffer.slice(0, match.index);
    buffer = buffer.slice(match.index + match[0].length);
    onFrame(frame);
  }
  return buffer;
}

async function runOnce(test) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${base}/api/gemini/chat-stream`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({ task: test.task, question: test.question }),
    });
    if (!response.ok || !response.body) throw new Error(`${test.name}: HTTP ${response.status}, streaming=${Boolean(response.body)}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const phases = [];
    let deltas = 0;
    let streamedText = '';
    let done = null;
    let streamError = null;

    const consume = frame => {
      let event = 'message';
      const data = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      if (!data.length) return;
      let payload;
      try { payload = JSON.parse(data.join('\n')); } catch { return; }
      if (event === 'status') phases.push(String(payload.phase || 'unknown'));
      if (event === 'delta') { deltas += 1; streamedText += String(payload.text || ''); }
      if (event === 'done') done = payload.result || null;
      if (event === 'error') streamError = payload;
    };

    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseFrames(buffer, consume);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);

    if (streamError) {
      const err = new Error(`${test.name}: ${streamError.friendlyError?.code || 'stream_error'} ${streamError.friendlyError?.title || ''}`);
      err.retryAfterSeconds = Number(streamError.friendlyError?.retryAfterSeconds || 0);
      err.retryable = Boolean(streamError.friendlyError?.retryable);
      throw err;
    }
    if (!done) throw new Error(`${test.name}: stream ended without done event`);
    if (phases.length < 2) throw new Error(`${test.name}: expected >=2 status events, saw ${phases.join(',')}`);
    if (deltas < 1) throw new Error(`${test.name}: expected streamed text deltas`);
    if (streamedText.trim().length < 40) throw new Error(`${test.name}: streamed answer too short (${streamedText.trim().length})`);
    if (!String(done.answer || '').trim()) throw new Error(`${test.name}: done result has no answer`);
    if (!String(done.model || '').trim()) throw new Error(`${test.name}: done result has no model`);
    const progressVisible = phases.some(phase => ['preparing','evidence','routing','model','connected','thinking','typing','failover','cooldown','cache','stale-cache'].includes(phase));
    if (!progressVisible) throw new Error(`${test.name}: no visible progress phase was emitted`);

    return { name: test.name, task: test.task, model: done.model, cached: Boolean(done.cached), stale: Boolean(done.stale), phases: [...new Set(phases)], deltas, chars: streamedText.trim().length };
  } finally { clearTimeout(timeout); }
}

async function runWithRetry(test) {
  try { return await runOnce(test); }
  catch (error) {
    if (!error.retryable) throw error;
    const wait = Math.max(5, Math.min(60, Number(error.retryAfterSeconds || 20)));
    console.warn(`${test.name}: retryable provider response; waiting ${wait}s before one retry`);
    await delay(wait * 1000);
    return runOnce(test);
  }
}

const results = [];
for (let index = 0; index < tests.length; index += 1) {
  const test = tests[index];
  console.log(`\n[${index + 1}/${tests.length}] ${test.name} (${test.task})`);
  const result = await runWithRetry(test);
  results.push(result);
  console.log(JSON.stringify(result));
  if (index < tests.length - 1) await delay(4_000);
}

console.log('\nAll FXGA Gemini streaming smoke tests passed.');
console.table(results.map(result => ({ name: result.name, model: result.model, cached: result.cached, phases: result.phases.join('>'), deltas: result.deltas, chars: result.chars })));
