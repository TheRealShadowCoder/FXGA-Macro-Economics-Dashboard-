import { useEffect, useMemo, useState } from 'react';
import { genericExplanation, resolveExplanation, type Explanation } from '../lib/explainability';
import './ExplainabilityLayer.css';

type PopoverState = {
  explanation: Explanation;
  x: number;
  y: number;
  context: string;
} | null;

const INFO_SELECTOR = 'article,section,div,span,strong,b,small,p,h1,h2,h3,h4,td,th,li,time,label';
const INTERACTIVE_SELECTOR = 'a,input,textarea,select,option,[contenteditable="true"]';

function contextText(target: HTMLElement) {
  const explicit = target.closest<HTMLElement>('[data-explain-key]');
  if (explicit) return { node: explicit, text: explicit.innerText || explicit.textContent || '' };
  let node: HTMLElement | null = target.closest<HTMLElement>(INFO_SELECTOR);
  let depth = 0;
  while (node && depth < 4) {
    const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length >= 2 && text.length <= 420) return { node, text };
    node = node.parentElement;
    depth += 1;
  }
  return { node: target, text: (target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim() };
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

      const context = contextText(target);
      const key = context.node?.dataset.explainKey || explicitNode?.dataset.explainKey || null;
      const explanation = resolveExplanation(key, context.text) ?? genericExplanation(context.text);
      const x = Math.min(window.innerWidth - 18, Math.max(18, event.clientX));
      const y = Math.min(window.innerHeight - 18, Math.max(18, event.clientY));
      setPopover({ explanation, x, y, context: context.text.slice(0, 180) });
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
      left: preferLeft ? undefined : Math.min(popover.x + 12, window.innerWidth - 440),
      right: preferLeft ? Math.max(12, window.innerWidth - popover.x + 12) : undefined,
      top: preferUp ? undefined : Math.min(popover.y + 12, window.innerHeight - 520),
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
