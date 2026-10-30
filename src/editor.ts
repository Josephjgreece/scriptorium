import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { openSearchPanel, searchKeymap } from "@codemirror/search";
import { EditorState, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, drawSelection, EditorView, keymap, MatchDecorator, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { GLUE_JOIN, GLUE_MARK } from "./meta";
import { smartReplace } from "./typography";

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
  // font, size, spacing and width come from the appearance settings (see appearance.ts)
  ".cm-scroller": { fontFamily: "var(--font-write)", lineHeight: "var(--ed-line, 2)", overflow: "auto" },
  ".cm-content": {
    maxWidth: "var(--ed-width, 50rem)",
    margin: "0 auto",
    padding: "3rem 2rem 30vh",
    fontSize: "var(--ed-size, 1.3rem)",
    caretColor: "var(--accent)",
    // no ligatures: "-->" and "<!--" must look like what they are
    fontVariantLigatures: "none",
    fontFeatureSettings: '"liga" 0, "calt" 0',

  },
  ".cm-comment": { color: "var(--muted)", fontStyle: "italic", backgroundColor: "var(--comment-bg)", borderRadius: "3px" },
  ".cm-fnref": { color: "var(--accent)", verticalAlign: "super", fontSize: "0.75em" },
  ".cm-fndef": { color: "var(--accent)", fontWeight: "600" },
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
  /** curly quotes, en/em dashes and ellipses as you type */
  smartTypography(): boolean;
  /** the selection moved or changed (for the statistics) */
  onSelection(): void;
}

// ---- smart typing

const CODE_NODES = /^(InlineCode|FencedCode|CodeBlock|CodeText|CodeMark|CodeInfo|HTMLTag|URL|Comment|CommentBlock)$/;

function inCode(state: EditorState, pos: number): boolean {
  type Node = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;
  for (let n: Node | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (CODE_NODES.test(n.name)) return true;
  return false;
}

const smartTyping = (hooks: EditorHooks): Extension =>
  EditorView.inputHandler.of((view, from, to, text) => {
    if (text.length !== 1 || !hooks.smartTypography() || view.composing) return false;
    const line = view.state.doc.lineAt(from);
    const before = view.state.doc.sliceString(line.from, from);
    const r = smartReplace(before, text);
    if (!r || inCode(view.state, from)) return false;
    // a fenced code line, or a line inside a code block, is left alone
    if (/^\s{0,3}(```|~~~)/.test(line.text)) return false;
    const start = from - r.deleteBefore;
    view.dispatch({ changes: { from: start, to, insert: r.insert }, selection: { anchor: start + r.insert.length }, userEvent: "input.type", scrollIntoView: true });
    return true;
  });

// ---- comments and footnotes

/** `<!-- ... -->` annotations, shown muted. They stay out of counts and exports. The joins of glued sheets are not comments. */
const commentDecos = StateField.define<DecorationSet>({
  create: (state) => findComments(state),
  update: (value, tr) => (tr.docChanged ? findComments(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f),
});
function findComments(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const marks: Range<Decoration>[] = [];
  const re = /<!--[\s\S]*?-->/g;
  for (let m = re.exec(text); m; m = re.exec(text)) if (m[0] !== GLUE_MARK) marks.push(Decoration.mark({ class: "cm-comment" }).range(m.index, m.index + m[0].length));
  return Decoration.set(marks);
}

const footnoteMatcher = new MatchDecorator({
  regexp: /^\[\^[^\]\s]+\]:|\[\^[^\]\s]+\]/g,
  decoration: (m) => Decoration.mark({ class: m[0].endsWith(":") ? "cm-fndef" : "cm-fnref" }),
});
const footnoteDecos = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = footnoteMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = footnoteMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Wrap the selection in a comment, or start an empty one and leave the cursor inside it. */
export function addComment(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  const insert = text ? `<!-- ${text} -->` : "<!--  -->";
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: text ? from + insert.length : from + 5 }, userEvent: "input", scrollIntoView: true });
  view.focus();
  return true;
}

/** Put [^n] at the cursor and the matching "[^n]: " definition at the end, with the cursor ready to write it. */
export function insertFootnote(view: EditorView): boolean {
  const doc = view.state.doc.toString();
  const used = new Set([...doc.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1])));
  let n = 1;
  while (used.has(n)) n++;
  const at = view.state.selection.main;
  const ref = `[^${n}]`;
  const tail = `${doc.endsWith("\n\n") ? "" : doc.endsWith("\n") ? "\n" : "\n\n"}[^${n}]: `;
  const refEnd = at.from + ref.length;
  const end = doc.length - (at.to - at.from) + ref.length + tail.length;
  view.dispatch({
    changes: [
      { from: at.from, to: at.to, insert: ref },
      { from: doc.length, insert: tail },
    ],
    selection: { anchor: Math.max(refEnd, end) },
    userEvent: "input",
    scrollIntoView: true,
  });
  view.focus();
  return true;
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
    ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [smartTyping(hooks)]),
    commentDecos,
    footnoteDecos,
    ...(glued ? [joinDecos, protectJoins, EditorView.atomicRanges.of((v) => v.state.field(joinDecos))] : []),
    EditorView.contentAttributes.of({ spellcheck: "true", autocapitalize: "sentences", "aria-label": "Sheet text" }),
    keymap.of([
      { key: "Mod-Shift-m", run: addComment },
      { key: "Mod-Shift-y", run: insertFootnote },
      { key: "Mod-h", run: openSearchPanel },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) hooks.onChange();
      if (u.docChanged || u.selectionSet) hooks.onSelection();
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

/** Move the cursor to `pos` and bring that line to the top of the view. */
export function jumpTo(view: EditorView, pos: number): void {
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 32 }) });
  view.focus();
}
