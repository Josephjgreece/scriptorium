// The two project dialogs: starting a project from a template, and editing its settings.

import type { SectionRole } from "./meta";
import { TEMPLATES } from "./projects";
import { h, modal } from "./ui";

export const ROLE_LABEL: Record<SectionRole, string> = {
  manuscript: "Manuscript",
  matter: "Front / back matter",
  material: "Material",
};
const ROLE_HINT: Record<SectionRole, string> = {
  manuscript: "counts toward the goal, exported",
  matter: "exported, not counted",
  material: "not counted, not exported",
};

export interface NewProject {
  name: string;
  template: string;
}

export async function askNewProject(): Promise<NewProject | null> {
  let template = TEMPLATES[0].id;
  const r = await modal((close) => {
    const name = h("input", { type: "text", placeholder: "Project name", spellcheck: "false", "aria-label": "Project name" });
    const cards = TEMPLATES.map((t) =>
      h(
        "button",
        { class: "tpl", "data-id": t.id, type: "button" },
        h("span", { class: "tpl-name" }, t.name),
        h("span", { class: "tpl-desc" }, t.description),
        t.sections.length ? h("span", { class: "tpl-secs" }, t.sections.map((s) => s.name).join(" · ")) : null,
      ),
    );
    const paint = () => cards.forEach((c) => c.classList.toggle("on", c.dataset.id === template));
    cards.forEach((c) => c.addEventListener("click", () => ((template = c.dataset.id!), paint())));
    paint();
    const ok = () => {
      const n = name.value.trim();
      if (!n) {
        name.focus();
        return;
      }
      close(JSON.stringify({ name: n, template }));
    };
    name.addEventListener("keydown", (e) => e.key === "Enter" && ok());
    queueMicrotask(() => name.focus());
    return h(
      "div",
      { class: "modal wide" },
      h("h3", {}, "New project"),
      name,
      h("div", { class: "tpl-grid" }, ...cards),
      h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: ok }, "Create")),
    );
  });
  return r ? (JSON.parse(r) as NewProject) : null;
}

export interface ProjectSettingsInput {
  name: string;
  goal: number;
  deadline: string;
  sections: { path: string; name: string; role: SectionRole }[];
}
export interface ProjectSettingsResult {
  name: string;
  goal: number;
  deadline: string;
  roles: Record<string, SectionRole>;
}

export async function askProjectSettings(input: ProjectSettingsInput): Promise<ProjectSettingsResult | null> {
  const r = await modal((close) => {
    const name = h("input", { type: "text", value: input.name, spellcheck: "false", "aria-label": "Project name" });
    const goal = h("input", { type: "number", min: "0", step: "100", value: input.goal ? String(input.goal) : "", placeholder: "No goal", "aria-label": "Word goal" });
    const deadline = h("input", { type: "date", value: input.deadline, "aria-label": "Deadline" });
    const selects = input.sections.map((s) => {
      const sel = h("select", { "aria-label": `${s.name} section type` }, ...(Object.keys(ROLE_LABEL) as SectionRole[]).map((role) => h("option", { value: role }, ROLE_LABEL[role])));
      sel.value = s.role;
      return sel;
    });
    const hint = h("p", { class: "hint" }, "");
    const paintHint = () => (hint.textContent = (Object.keys(ROLE_LABEL) as SectionRole[]).map((r) => `${ROLE_LABEL[r]}: ${ROLE_HINT[r]}`).join(". ") + ".");
    paintHint();
    const ok = () => {
      const n = name.value.trim();
      if (!n) {
        name.focus();
        return;
      }
      const roles: Record<string, SectionRole> = {};
      input.sections.forEach((s, i) => (roles[s.path] = selects[i].value as SectionRole));
      close(JSON.stringify({ name: n, goal: Math.max(0, Math.floor(Number(goal.value) || 0)), deadline: deadline.value, roles }));
    };
    name.addEventListener("keydown", (e) => e.key === "Enter" && ok());
    queueMicrotask(() => name.focus());
    return h(
      "div",
      { class: "modal wide" },
      h("h3", {}, "Project settings"),
      h("label", { class: "field" }, h("span", {}, "Name"), name),
      h("div", { class: "field-row" }, h("label", { class: "field" }, h("span", {}, "Word goal"), goal), h("label", { class: "field" }, h("span", {}, "Deadline"), deadline)),
      input.sections.length
        ? h("div", { class: "sections" }, h("h4", {}, "Sections"), ...input.sections.map((s, i) => h("label", { class: "sec-row" }, h("span", { class: "sec-name" }, s.name), selects[i])), hint)
        : h("p", { class: "hint" }, "Add groups inside the project to use them as sections (chapters, notes, and so on)."),
      h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: ok }, "Save")),
    );
  });
  return r ? (JSON.parse(r) as ProjectSettingsResult) : null;
}
