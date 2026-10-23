'use client';

import { Extension, type Editor } from '@tiptap/core';
import { TextAlign } from '@tiptap/extension-text-align';
import { FontFamily, TextStyle } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { clsx } from 'clsx';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { letterFontCss, type LetterFontName } from '@tailorit/shared/letters';
import { fontNameOfStack, paperFontStack, storedHtmlOf, toEditorHtml } from './html';
import styles from './letterEditor.module.css';
import { LinkDialog } from './LinkDialog';
import { Toolbar } from './Toolbar';
import { VariableHoverHint } from './VariableHoverHint';
import { VariableNode } from './VariableNode';

/*
 * The shared TipTap editor of cover letters and templates: Simplify's toolbar over a US Letter paper on the #f8f8f8
 * canvas, `{{VARIABLE}}` chips, and the bundled letter fonts (served by the API, the same files the PDF embeds).
 * The page owns the data: it gets the editor through `onReady` and hears every edit through `onChange`.
 */

const FONT_STYLESHEET_ID = 'tailorit-letter-fonts';

/** Ctrl+K opens the link dialog; Ctrl+Shift+9 toggles a quote (as Simplify's tooltips list). */
const LetterKeys = Extension.create<{ onLink: () => void }>({
  name: 'letterKeys',
  addOptions() {
    return { onLink: () => undefined };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        this.options.onLink();
        return true;
      },
      'Mod-Shift-9': () => this.editor.commands.toggleBlockquote(),
    };
  },
});

export interface LetterEditorProps {
  /** The stored HTML the editor starts from (later changes go through the editor instance). */
  initialHtml: string;
  documentFont: LetterFontName;
  onDocumentFontChange: (font: LetterFontName) => void;
  /** Every edit by the person (not content the page sets itself). */
  onChange?: (html: string) => void;
  editable?: boolean;
  /** The empty paper's hint ("Dear Hiring Manager..."). */
  placeholder: string;
  /** The editing area's accessible name. */
  label: string;
  /** Shows ✨ Generate in the toolbar. */
  onGenerate?: () => void;
  /** Between the toolbar and the paper (the placeholder banner; "Insert variable..." and "Base from template..."). */
  belowToolbar?: ReactNode;
  onReady?: (editor: Editor | null) => void;
}

export function LetterEditor({
  initialHtml,
  documentFont,
  onDocumentFontChange,
  onChange,
  editable = true,
  placeholder,
  label,
  onGenerate,
  belowToolbar,
  onReady,
}: LetterEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [paper, setPaper] = useState<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onChangeRef.current = onChange;
    onReadyRef.current = onReady;
  });

  // The editor's web fonts (the PDF carries the same files inline): one stylesheet for the whole visit.
  useEffect(() => {
    if (document.getElementById(FONT_STYLESHEET_ID)) return;
    const link = document.createElement('link');
    link.id = FONT_STYLESHEET_ID;
    link.rel = 'stylesheet';
    link.href = '/api/cover-letters/fonts.css';
    document.head.append(link);
  }, []);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          code: false,
          codeBlock: false,
          horizontalRule: false,
          strike: false,
          heading: { levels: [1, 2, 3] },
          link: {
            openOnClick: false,
            autolink: true,
            defaultProtocol: 'https',
            protocols: ['mailto', 'tel'],
          },
        }),
        TextStyle,
        FontFamily,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        Placeholder.configure({ placeholder }),
        VariableNode,
        LetterKeys.configure({ onLink: () => setLinkOpen(true) }),
      ],
      content: toEditorHtml(initialHtml),
      editable,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          'aria-label': label,
          'aria-multiline': 'true',
          role: 'textbox',
          spellcheck: 'true',
          'data-letter-editor': '',
        },
      },
      onUpdate: ({ editor: current }) => onChangeRef.current?.(storedHtmlOf(current)),
    },
    [],
  );

  useEffect(() => {
    onReadyRef.current?.(editor);
    return () => onReadyRef.current?.(null);
  }, [editor]);

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  /**
   * The font select: with text selected it sets that text's font; at a cursor inside a run of another font, that
   * run; otherwise (or with everything selected) the letter's own font.
   */
  const changeFont = (font: LetterFontName) => {
    if (!editor || !editable) return;
    const { selection, doc } = editor.state;
    const everything = !selection.empty && selection.from <= 1 && selection.to >= doc.content.size - 1;
    const markFont = fontNameOfStack(editor.getAttributes('textStyle').fontFamily as string | undefined);
    if (everything) {
      editor.chain().focus().unsetFontFamily().run();
      onDocumentFontChange(font);
      return;
    }
    if (selection.empty && !markFont) {
      onDocumentFontChange(font);
      editor.commands.focus();
      return;
    }
    const chain = editor.chain().focus();
    if (selection.empty) chain.extendMarkRange('textStyle');
    if (font === documentFont) chain.unsetFontFamily();
    else chain.setFontFamily(letterFontCss(font));
    chain.run();
  };

  const focusFromMargin = (event: MouseEvent<HTMLDivElement>) => {
    if (!editor || event.target !== event.currentTarget) return;
    event.preventDefault();
    editor.commands.focus('end');
  };

  return (
    <>
      <Toolbar
        // useEditorState keeps its first (editor-less) snapshot until a transaction: start it again once the
        // editor exists.
        key={editor ? 'ready' : 'starting'}
        editor={editor}
        documentFont={documentFont}
        onFontChange={changeFont}
        onLink={() => setLinkOpen(true)}
        onGenerate={onGenerate}
        disabled={!editable}
      />
      <div className="flex-1 bg-surface-low px-3 pt-5 pb-20 sm:px-6">
        {belowToolbar && <div className="mx-auto mb-4 w-full max-w-[896px]">{belowToolbar}</div>}
        <div
          ref={setPaper}
          data-letter-paper=""
          className={clsx(styles.paper, !editable && styles.readOnly)}
          style={{ fontFamily: paperFontStack(documentFont) }}
          onMouseDown={focusFromMargin}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
      <LinkDialog editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
      <VariableHoverHint root={paper} />
    </>
  );
}
