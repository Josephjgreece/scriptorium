import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { EditorState, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, drawSelection, EditorView, keymap, WidgetType } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { GLUE_JOIN } from "./meta";

// Markdown marks (#, **, >, ...) are dimmed so the text reads as prose, not as code.
const prose = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.55em", fontWeight: "700", color: "var(--head)" },
  { tag: t.heading2, fontSize: "1.35em", fontWeight: "700", color: "var(--head)" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "700", color: "var(--head)" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700", color: "var(--head)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--muted)" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.88em", backgroundColor: "var(--code-bg)" },
  { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.contentSeparator], color: "var(--mark)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-write)", lineHeight: "2", overflow: "auto" },
  ".cm-content": {
    maxWidth: "50rem",
    margin: "0 auto",
    padding: "3rem 2rem 30vh",
    fontSize: "1.3rem",
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

// ---- glued sheets: several files edited as one text, joined by a divider you can't edit

class JoinWidget extends WidgetType {
  toDOM(): HTMLElement {
    const d = document.createElement("div");
    d.className = "glue-join";
    return d;
  }
  eq(): boolean {
    return true;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

function joinRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (let i = text.indexOf(GLUE_JOIN); i >= 0; i = text.indexOf(GLUE_JOIN, i + GLUE_JOIN.length)) out.push([i, i + GLUE_JOIN.length]);
  return out;
}

const joinDecos = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f),
});
function build(state: EditorState): DecorationSet {
  const marks: Range<Decoration>[] = joinRanges(state.doc.toString()).map(([a, b]) =>
    Decoration.replace({ widget: new JoinWidget(), block: true }).range(a, b),
  );
  return Decoration.set(marks);
}

const protectJoins = EditorState.changeFilter.of((tr) => (tr.startState.field(joinDecos, false) ? joinRanges(tr.startState.doc.toString()).flat() : true));

export interface EditorHooks {
  onChange(): void;
  isTypewriter(): boolean;
}

/** A fresh state per sheet, so undo history never leaks from one sheet into the next. */
export function makeState(doc: string, hooks: EditorHooks, glued = false, readOnly = false): EditorState {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(prose),
    theme,
    ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    ...(glued ? [joinDecos, protectJoins, EditorView.atomicRanges.of((v) => v.state.field(joinDecos))] : []),
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
