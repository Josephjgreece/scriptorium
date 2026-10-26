import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// Markdown marks (#, **, >, ...) are dimmed so the text reads as prose, not as code.
const prose = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.65em", fontWeight: "700", lineHeight: "1.3" },
  { tag: t.heading2, fontSize: "1.4em", fontWeight: "700" },
  { tag: t.heading3, fontSize: "1.2em", fontWeight: "650" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "650" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--muted)" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.88em", backgroundColor: "var(--code-bg)" },
  { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.contentSeparator], color: "var(--mark)", fontWeight: "400" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-write)", lineHeight: "1.75", overflow: "auto" },
  ".cm-content": {
    maxWidth: "44rem",
    margin: "0 auto",
    padding: "2.5rem 1.5rem 30vh",
    fontSize: "1.15rem",
    caretColor: "var(--accent)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--sel)",
  },
  ".cm-panels": { backgroundColor: "var(--pane2)", color: "var(--text)", fontFamily: "var(--font-ui)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line)" },
  ".cm-panels input, .cm-panels button": { fontFamily: "var(--font-ui)", fontSize: "13px" },
  ".cm-searchMatch": { backgroundColor: "var(--active)", outline: "1px solid var(--accent)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--sel)" },
});

export interface EditorHooks {
  onChange(): void;
  isTypewriter(): boolean;
}

/** A fresh state per sheet, so undo history never leaks from one sheet into the next. */
export function makeState(doc: string, hooks: EditorHooks): EditorState {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(prose),
    theme,
    EditorView.contentAttributes.of({ spellcheck: "true", autocapitalize: "sentences", "aria-label": "Sheet text" }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) hooks.onChange();
      if (hooks.isTypewriter() && (u.docChanged || u.selectionSet) && u.view.hasFocus) {
        const head = u.state.selection.main.head;
        requestAnimationFrame(() => u.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "center" }) }));
      }
    }),
  ];
  return EditorState.create({ doc, extensions });
}

export function createEditor(parent: HTMLElement): EditorView {
  return new EditorView({ parent, state: EditorState.create({ doc: "" }) });
}
