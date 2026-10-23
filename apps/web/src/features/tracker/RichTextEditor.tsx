'use client';

import { TextBIcon } from '@phosphor-icons/react/TextB';
import { TextItalicIcon } from '@phosphor-icons/react/TextItalic';
import { TextUnderlineIcon } from '@phosphor-icons/react/TextUnderline';
import { ListNumbersIcon } from '@phosphor-icons/react/ListNumbers';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ListBulletsIcon } from '@/components/ui/icons';

/**
 * Typography for stored rich text (job descriptions, notes): Tailwind's reset removes list bullets and heading sizes,
 * so they are put back here.
 */
export const PROSE =
  'text-sm leading-6 text-foreground break-words ' +
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 ' +
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_li>p]:my-0 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold ' +
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold ' +
  '[&_h4]:font-semibold [&_a]:text-primary-ink [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border ' +
  '[&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_strong]:font-semibold [&_b]:font-semibold [&_code]:rounded ' +
  '[&_code]:bg-surface-low [&_code]:px-1 [&_hr]:my-4';

const PLACEHOLDER =
  '[&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left ' +
  '[&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-subtle-foreground ' +
  '[&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]';

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={clsx(
        'inline-flex size-7 items-center justify-center rounded-md transition-colors duration-150',
        active ? 'bg-primary-container text-primary-ink' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      bullet: current.isActive('bulletList'),
      ordered: current.isActive('orderedList'),
    }),
  });
  return (
    <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1" role="toolbar" aria-label="Formatting">
      <ToolButton label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <TextBIcon size={16} weight="bold" />
      </ToolButton>
      <ToolButton label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <TextItalicIcon size={16} />
      </ToolButton>
      <ToolButton label="Underline" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <TextUnderlineIcon size={16} />
      </ToolButton>
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
      <ToolButton label="Bullet list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <ListBulletsIcon size={16} />
      </ToolButton>
      <ToolButton label="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListNumbersIcon size={16} />
      </ToolButton>
    </div>
  );
}

/**
 * A small rich-text field (TipTap StarterKit): bold, italic, underline and lists, a placeholder, and `onChange`
 * with the HTML ('' when empty). The initial `value` is read once; remount (key) to load another document.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  label,
  minHeight = 160,
  toolbar = true,
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder: string;
  /** The accessible name of the editing area. */
  label: string;
  minHeight?: number;
  toolbar?: boolean;
  className?: string;
}) {
  // The latest onChange, for the editor's update callback (set once, at creation).
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  });
  const extensions = useMemo(
    () => [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder }),
    ],
    [placeholder],
  );
  const editorProps = useMemo(
    () => ({
      attributes: {
        'aria-label': label,
        'aria-multiline': 'true',
        role: 'textbox',
        class: clsx(PROSE, PLACEHOLDER, 'px-3 py-2.5 outline-none'),
        style: `min-height: ${minHeight}px`,
      },
    }),
    [label, minHeight],
  );
  // The document is loaded once (remount with a key for another one); later `value`s are the editor's own echo.
  const [initial] = useState(value);
  const editor = useEditor({
    extensions,
    content: initial,
    immediatelyRender: false,
    editorProps,
    onUpdate: ({ editor: current }) => changed.current(current.isEmpty ? '' : current.getHTML()),
  });

  return (
    <div
      className={clsx(
        'overflow-hidden rounded-control border border-control bg-surface shadow-soft transition-[border-color] duration-150',
        'focus-within:border-control-focus hover:border-control-hover',
        className,
      )}
    >
      {toolbar && editor && <Toolbar editor={editor} />}
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div aria-hidden="true" className="px-3 py-2.5 text-sm text-subtle-foreground" style={{ minHeight }}>
          {placeholder}
        </div>
      )}
    </div>
  );
}
