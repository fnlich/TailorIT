import { InputRule, Node, PasteRule } from '@tiptap/core';
import styles from './letterEditor.module.css';

/*
 * A `{{VARIABLE}}` placeholder as an atomic, draggable inline chip. Stored HTML keeps the literal text `{{NAME}}`:
 * the node serialises as `<span data-variable="NAME">{{NAME}}</span>`, which `fromEditorHtml` turns back into the
 * text (and the API's sanitizer would too), and `toEditorHtml` wraps stored text as that span before the editor
 * parses it. Typing or pasting `{{UPPER_SNAKE}}` makes a chip.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    variable: {
      /** Inserts a `{{NAME}}` chip at the selection. */
      insertVariable: (name: string) => ReturnType;
    };
  }
}

const TYPED = /\{\{[A-Z][A-Z0-9_]*\}\}$/;
const PASTED = /\{\{[A-Z][A-Z0-9_]*\}\}/g;

const nameOf = (match: string) => match.slice(2, -2);

export const VariableNode = Node.create({
  name: 'variable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-variable') ?? '',
        // The text form carries the name; no attributes are written.
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-variable]' }];
  },

  renderHTML({ node }) {
    const name = node.attrs.name as string;
    return ['span', { 'data-variable': name }, `{{${name}}}`];
  },

  renderText({ node }) {
    return `{{${node.attrs.name as string}}}`;
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      const name = node.attrs.name as string;
      dom.className = styles.variable ?? '';
      dom.dataset.variable = name;
      dom.textContent = `{{${name}}}`;
      return { dom };
    };
  },

  addCommands() {
    return {
      insertVariable:
        (name) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { name } }),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: TYPED,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ name: nameOf(match[0]) }));
        },
      }),
    ];
  },

  addPasteRules() {
    return [
      new PasteRule({
        find: PASTED,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ name: nameOf(match[0]) }));
        },
      }),
    ];
  },
});
