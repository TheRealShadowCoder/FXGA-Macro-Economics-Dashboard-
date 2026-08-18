import { useEffect, useMemo, useState } from 'react';
import { genericExplanation, resolveExplanation, type Explanation } from '../lib/explainability';
import { resolveMacroExplanation } from '../lib/macro-explainability';
import { resolveDecisionExplanation } from '../lib/decision-explainability';
import './ExplainabilityLayer.css';

type PopoverState = {
  explanation: Explanation;
  x: number;
  y: number;
  context: string;
} | null;

type ContextCandidate = { node: HTMLElement; text: string; key: string | null };

const INFO_SELECTOR = 'article,section,div,span,strong,b,small,p,h1,h2,h3,h4,td,th,li,time,label';
const INTERACTIVE_SELECTOR = 'a,input,textarea,select,option,[contenteditable="true"]';

function cleanText(node: HTMLElement) {
  return (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
}

function contextCandidates(target: HTMLElement): ContextCandidate[] {
  const output: ContextCandidate[] = [];
  const seen = new Set<HTMLElement>();
  const explicit = target.closest<HTMLElement>('[data-explain-key]');
  if (explicit) {
    output.push({ node: explicit, text: cleanText(explicit), key: explicit.dataset.explainKey || null });
    seen.add(explicit);
  }
  let node: HTMLElement | null = target.closest<HTMLElement>(INFO_SELECTOR);
  let depth = 0;
  while (node && depth < 6) {
    if (!seen.has(node)) {
      const text = cleanText(node);
      if (text.length >= 1 && text.length <= 700) output.push({ node, text, key: node.dataset.explainKey || null });
      seen.add(node);
    }
    node = node.parentElement;
    depth += 1;
  }
  return output;
}

function chooseExplanation(target: HTMLElement) {
  const candidates = contextCandidates(target);
  for (const candidate of candidates) {
    const explanation = resolveExplanation(candidate.key, candidate.text) ?? resolveMacroExplanation(candidate.text) ?? resolveDecisionExplanation(candidate.text);
    if (explanation) return { explanation, context: candidate.text };
  }
  const fallback = candidates.find((candidate) => /[a-zA-Z]{3}/.test(candidate.text) && candidate.text.length >= 6) ?? candidates[0];
  const text = fallback?.text || cleanText(target);
  return { explanation: genericExplanation(text), context: text };
}

export function ExplainabilityLayer() {
  const [popover, setPopover] = useState<PopoverState>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;
      if (target.closest('.fxga-explain-popover')) return;
      const explicitNode = target.closest<HTMLElement>('[data-explain-key]');
      if (target.closest(INTERACTIVE_SELECTOR) && !explicitNode) return;
      if (target.closest('button') && !explicitNode) return;

      const resolved = chooseExplanation(target);
      const x = Math.min(window.innerWidth - 18, Math.max(18, event.clientX));
      const y = Math.min(window.innerHeight - 18, Math.max(18, event.clientY));
      setPopover({ explanation: resolved.explanation, x, y, context: resolved.context.slice(0, 180) });
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPopover(null); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const style = useMemo(() => {
    if (!popover) return undefined;
    const preferLeft = popover.x > window.innerWidth * 0.58;
    const preferUp = popover.y > window.innerHeight * 0.58;
    return {
      left: preferLeft ? undefined : Math.max(12, Math.min(popover.x + 12, window.innerWidth - 440)),
      right: preferLeft ? Math.max(12, window.innerWidth - popover.x + 12) : undefined,
      top: preferUp ? undefined : Math.max(12, Math.min(popover.y + 12, window.innerHeight - 520)),
      bottom: preferUp ? Math.max(12, window.innerHeight - popover.y + 12) : undefined,
    };
  }, [popover]);

  if (!popover) return <div className="fxga-explain-hint" aria-hidden="true">Left click information to explain it</div>;
  const item = popover.explanation;

  return <div className="fxga-explain-popover" style={style} role="dialog" aria-label={`Explanation: ${item.title}`}>
    <div className="fxga-explain-head">
      <div><span>FXGA Plain Language Guide</span><h3>{item.title}</h3></div>
      <button type="button" onClick={() => setPopover(null)} aria-label="Close explanation">×</button>
    </div>
    <div className="fxga-explain-body">
      <section><small>What it means</small><p>{item.meaning}</p></section>
      <section><small>What to look at</small><p>{item.lookFor}</p></section>
      <section><small>How to think about it</small><p>{item.think}</p></section>
      {item.good && <section className="good"><small>Healthy sign</small><p>{item.good}</p></section>}
      {item.warning && <section className="warn"><small>Be careful when</small><p>{item.warning}</p></section>}
      {item.formula && <section><small>Simple formula idea</small><p>{item.formula}</p></section>}
    </div>
    <div className="fxga-explain-foot"><span>Context</span><p>{popover.context || 'Current dashboard item'}</p><small>Esc closes this guide</small></div>
  </div>;
}
