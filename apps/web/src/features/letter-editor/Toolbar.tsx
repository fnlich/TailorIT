'use client';

import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { clsx } from 'clsx';
import { forwardRef, useSyncExternalStore, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import type { LetterFontName } from '@tailorit/shared/letters';
import { Tooltip } from '@/components/ui/Tooltip';
import { FontSelect } from './FontSelect';
import { fontNameOfStack, shortcutLabel } from './html';
import {
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  LinkSimpleIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  QuotesIcon,
  SparkleIcon,
  TextAlignCenterIcon,
  TextAlignJustifyIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextBIcon,
  TextHOneIcon,
  TextHThreeIcon,
  TextHTwoIcon,
  TextItalicIcon,
  TextUnderlineIcon,
} from './icons';

/*
 * Simplify's formatting toolbar (screenshot 5), centred under the editor bar: font, B U I, link, H1-H3, four
 * alignments, quote, bullets, numbers, undo, redo, and (letters) ✨ Generate. Each button has a tooltip with its
 * shortcut and reflects the selection (aria-pressed).
 */

const isMacPlatform = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test((navigator as { platform?: string }).platform ?? navigator.userAgent);
const subscribeNothing = () => () => undefined;

function useIsMac(): boolean {
  return useSyncExternalStore(subscribeNothing, isMacPlatform, () => false);
}

interface ToolButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  label: string;
  shortcut?: string;
  isMac: boolean;
  active?: boolean;
  icon: ReactNode;
}

const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { label, shortcut, isMac, active, icon, disabled, className, ...rest },
  ref,
) {
  return (
    <Tooltip content={shortcut ? `${label} (${shortcutLabel(shortcut, isMac)})` : label}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        disabled={disabled}
        // Keep the editor's selection: the click must not move focus away first.
        onMouseDown={(event) => event.preventDefault()}
        className={clsx(
          'inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] transition-colors duration-150',
          'disabled:cursor-not-allowed disabled:text-[#c4c4c4]',
          active ? 'bg-[#ececec] text-foreground' : 'text-[#2b2b2b] hover:bg-hover',
          className,
        )}
        {...rest}
      >
        {icon}
      </button>
    </Tooltip>
  );
});

function Group({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

export interface ToolbarProps {
  editor: Editor | null;
  /** The letter's (document) font. */
  documentFont: LetterFontName;
  onFontChange: (font: LetterFontName) => void;
  onLink: () => void;
  onGenerate?: () => void;
  generateLabel?: string;
  disabled?: boolean;
}

export function Toolbar({ editor, documentFont, onFontChange, onLink, onGenerate, generateLabel = 'Generate', disabled }: ToolbarProps) {
  const isMac = useIsMac();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const align = (['center', 'right', 'justify'] as const).find((value) => current.isActive({ textAlign: value }));
      return {
        bold: current.isActive('bold'),
        italic: current.isActive('italic'),
        underline: current.isActive('underline'),
        link: current.isActive('link'),
        h1: current.isActive('heading', { level: 1 }),
        h2: current.isActive('heading', { level: 2 }),
        h3: current.isActive('heading', { level: 3 }),
        align: align ?? 'left',
        blockquote: current.isActive('blockquote'),
        bulletList: current.isActive('bulletList'),
        orderedList: current.isActive('orderedList'),
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
        markFont: fontNameOfStack(current.getAttributes('textStyle').fontFamily as string | undefined),
        editable: current.isEditable,
      };
    },
  });

  const off = disabled || !editor || !state?.editable;
  const run = (command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => {
    if (!editor) return;
    command(editor.chain().focus()).run();
  };

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      data-letter-toolbar=""
      className="sticky top-[63px] z-20 overflow-x-auto border-b border-border bg-surface"
    >
      <div className="mx-auto flex h-[63px] w-max items-center gap-3 px-4">
        <FontSelect value={state?.markFont ?? documentFont} onValueChange={onFontChange} disabled={off} />
        <Group>
          <ToolButton label="Bold" shortcut="Mod+B" isMac={isMac} active={state?.bold} disabled={off} icon={<TextBIcon size={20} weight="bold" />} onClick={() => run((c) => c.toggleBold())} />
          <ToolButton label="Underline" shortcut="Mod+U" isMac={isMac} active={state?.underline} disabled={off} icon={<TextUnderlineIcon size={20} weight="bold" />} onClick={() => run((c) => c.toggleUnderline())} />
          <ToolButton label="Italic" shortcut="Mod+I" isMac={isMac} active={state?.italic} disabled={off} icon={<TextItalicIcon size={20} weight="bold" />} onClick={() => run((c) => c.toggleItalic())} />
          <ToolButton label="Link" shortcut="Mod+K" isMac={isMac} active={state?.link} disabled={off} icon={<LinkSimpleIcon size={20} weight="bold" />} onClick={onLink} />
        </Group>
        <Group>
          <ToolButton label="Heading 1" shortcut="Mod+Alt+1" isMac={isMac} active={state?.h1} disabled={off} icon={<TextHOneIcon size={20} weight="bold" />} onClick={() => run((c) => c.toggleHeading({ level: 1 }))} />
          <ToolButton label="Heading 2" shortcut="Mod+Alt+2" isMac={isMac} active={state?.h2} disabled={off} icon={<TextHTwoIcon size={20} weight="bold" />} onClick={() => run((c) => c.toggleHeading({ level: 2 }))} />
          <ToolButton label="Heading 3" shortcut="Mod+Alt+3" isMac={isMac} active={state?.h3} disabled={off} icon={<TextHThreeIcon size={20} weight="bold" />} onClick={() => run((c) => c.toggleHeading({ level: 3 }))} />
        </Group>
        <Group>
          <ToolButton label="Align left" shortcut="Mod+Shift+L" isMac={isMac} active={state?.align === 'left'} disabled={off} icon={<TextAlignLeftIcon size={20} weight="bold" />} onClick={() => run((c) => c.setTextAlign('left'))} />
          <ToolButton label="Align center" shortcut="Mod+Shift+E" isMac={isMac} active={state?.align === 'center'} disabled={off} icon={<TextAlignCenterIcon size={20} weight="bold" />} onClick={() => run((c) => c.setTextAlign('center'))} />
          <ToolButton label="Align right" shortcut="Mod+Shift+R" isMac={isMac} active={state?.align === 'right'} disabled={off} icon={<TextAlignRightIcon size={20} weight="bold" />} onClick={() => run((c) => c.setTextAlign('right'))} />
          <ToolButton label="Justify" shortcut="Mod+Shift+J" isMac={isMac} active={state?.align === 'justify'} disabled={off} icon={<TextAlignJustifyIcon size={20} weight="bold" />} onClick={() => run((c) => c.setTextAlign('justify'))} />
        </Group>
        <Group>
          <ToolButton label="Quote" shortcut="Mod+Shift+9" isMac={isMac} active={state?.blockquote} disabled={off} icon={<QuotesIcon size={20} weight="fill" />} onClick={() => run((c) => c.toggleBlockquote())} />
          <ToolButton label="Bulleted list" shortcut="Mod+Shift+8" isMac={isMac} active={state?.bulletList} disabled={off} icon={<ListBulletsIcon size={20} weight="bold" />} onClick={() => run((c) => c.toggleBulletList())} />
          <ToolButton label="Numbered list" shortcut="Mod+Shift+7" isMac={isMac} active={state?.orderedList} disabled={off} icon={<ListNumbersIcon size={20} weight="bold" />} onClick={() => run((c) => c.toggleOrderedList())} />
        </Group>
        <Group>
          <ToolButton label="Undo" shortcut="Mod+Z" isMac={isMac} disabled={off || !state?.canUndo} icon={<ArrowUUpLeftIcon size={20} weight="bold" />} onClick={() => run((c) => c.undo())} />
          <ToolButton label="Redo" shortcut="Mod+Y" isMac={isMac} disabled={off || !state?.canRedo} icon={<ArrowUUpRightIcon size={20} weight="bold" />} onClick={() => run((c) => c.redo())} />
        </Group>
        {onGenerate && (
          <Tooltip content="Generate a tailored cover letter with AI">
            <button
              type="button"
              onClick={onGenerate}
              disabled={disabled}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-sm font-semibold text-primary-ink transition-colors hover:bg-primary-50 disabled:opacity-50"
            >
              <SparkleIcon size={18} weight="fill" />
              {generateLabel}
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
