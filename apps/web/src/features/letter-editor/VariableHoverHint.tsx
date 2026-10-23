'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { variableDefinition } from '@tailorit/shared/letters';

interface Hint {
  name: string;
  left: number;
  top: number;
}

/** What a chip means: the registry's label and description, or a word about unknown names. */
export function variableHint(name: string): { title: string; text: string } {
  const definition = variableDefinition(name);
  if (definition) return { title: definition.label, text: definition.description };
  return { title: `{{${name}}}`, text: 'A placeholder of your own. Replace it with your text before you send the letter.' };
}

/**
 * The dark hover hint over a `{{VARIABLE}}` chip (Simplify shows the variable's description). Chips are plain DOM
 * node views, so this listens on the editor's root instead of wrapping each chip.
 */
export function VariableHoverHint({ root }: { root: HTMLElement | null }) {
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    if (!root) return;
    const chipOf = (target: EventTarget | null) =>
      target instanceof Element ? (target.closest('[data-variable]') as HTMLElement | null) : null;
    const over = (event: MouseEvent) => {
      const chip = chipOf(event.target);
      if (!chip || !root.contains(chip)) return;
      const rect = chip.getBoundingClientRect();
      setHint({ name: chip.dataset.variable ?? '', left: rect.left + rect.width / 2, top: rect.top });
    };
    const out = (event: MouseEvent) => {
      const chip = chipOf(event.target);
      if (chip && chip !== chipOf(event.relatedTarget)) setHint(null);
    };
    const hide = () => setHint(null);
    root.addEventListener('mouseover', over);
    root.addEventListener('mouseout', out);
    root.addEventListener('mousedown', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      root.removeEventListener('mouseover', over);
      root.removeEventListener('mouseout', out);
      root.removeEventListener('mousedown', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [root]);

  if (!hint || typeof document === 'undefined') return null;
  const { title, text } = variableHint(hint.name);
  return createPortal(
    <div
      role="tooltip"
      data-variable-hint=""
      className="pointer-events-none fixed z-[70] max-w-xs -translate-x-1/2 -translate-y-full rounded-[8px] bg-foreground px-2.5 py-1.5 text-xs leading-4 font-medium text-white shadow-popover"
      style={{ left: hint.left, top: hint.top - 8 }}
    >
      <span className="block font-semibold">{title}</span>
      <span className="block font-normal text-white/85">{text}</span>
    </div>,
    document.body,
  );
}
