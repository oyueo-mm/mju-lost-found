"use client";

import { useId, useMemo, useState, type Ref } from "react";

import {
  CUSTODY_NOTE_MAX,
  custodyChoiceOf,
  isLegacyCustodyState,
  type CustodyChoice,
  type CustodyInput,
  type CustodyInstitution,
} from "@/lib/posts/custodySchema";
import { getLocalizedLocationSuggestions } from "@/lib/posts/campusLocations";
import { useI18n } from "@/lib/i18n/client";

const FIELD = "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground";

// Generic kinds of office, offered as typing help only -- never presented as
// confirmed drop-off points (which offices actually keep lost items is not
// known). The value is the Korean wording the post keeps; the label follows
// the reader's language.
const PLACE_TYPES = [
  { value: "교내 경비실", key: "form.custody.type.guard" },
  { value: "학생지원팀", key: "form.custody.type.studentSupport" },
  { value: "도서관 관련 관리 기관", key: "form.custody.type.library" },
] as const;

export type { CustodyInstitution };

// What tapping an answer does: the chosen answer again -> not entered (null);
// another answer -> that answer, with what was typed for it before. 기타 with
// no text on an older post goes back to that post's own state.
export function custodyAfterChoice(
  next: CustodyChoice,
  current: CustodyInput | null,
  memory: { handedPlace: string; otherNote: string; legacy: CustodyInput | null },
): CustodyInput | null {
  if (next === custodyChoiceOf(current)) return null;
  if (next === "self") return { state: "SELF", place: "" };
  if (next === "handed") return { state: "REPORTED", place: memory.handedPlace };
  return memory.otherNote.trim() === "" && memory.legacy ? memory.legacy : { state: "OTHER", place: "", note: memory.otherNote };
}

type Suggestion = { value: string; label: string; group: "registered" | "types" | "buildings" };

const LEGACY_STATE_KEY = {
  PLANNED: "post.custody.state.planned",
  UNHELD: "post.custody.state.unheld",
  UNKNOWN: "post.custody.state.unknown",
} as const;

// 현재 물건의 보관 상태 (Phase 3-A): one optional question, three short
// answers -- 직접 보관 / 기관에 맡김 / 기타 -- in a compact toggle group. Nothing is
// chosen at first; tapping the chosen answer again (or 선택 해제) goes back to
// "not entered", which is saved as no custody at all.
// - 직접 보관: nothing more to fill in; no private address is ever asked for.
// - 기관에 맡김: already handed over. The office or place is optional, with
//   suggestions for the chosen campus (registered 관리 기관, kinds of office,
//   buildings) and free text for anything else.
// - 기타: the finder's own words (a plan, left where found, ...). An empty
//   기타 is not saved: the form asks for the text or the unselect.
// Each answer keeps what was typed for it, so switching back and forth loses
// nothing, but only the chosen answer's input is ever part of the value.
// An older post's PLANNED / UNHELD / UNKNOWN shows under 기타 with its meaning
// spelled out and is left exactly as it is unless the finder changes it.
export function CustodyFields({
  value,
  onChange,
  campus,
  institutions = [],
  disabled,
  error,
  noteRef,
}: {
  value: CustodyInput | null;
  onChange: (v: CustodyInput | null) => void;
  campus: string;
  institutions?: readonly CustodyInstitution[];
  disabled?: boolean;
  // shown under the 기타 text (an empty 기타 on submit)
  error?: string | null;
  noteRef?: Ref<HTMLTextAreaElement>;
}) {
  const { t } = useI18n();
  const id = useId();
  const choice = custodyChoiceOf(value);
  // An older post's PLANNED / UNHELD / UNKNOWN, as it was first shown -- what
  // 기타 goes back to if its new text is erased again.
  const [legacy] = useState<CustodyInput | null>(value && isLegacyCustodyState(value.state) ? value : null);
  const [handedPlace, setHandedPlace] = useState(value?.state === "REPORTED" ? value.place : "");
  const [otherNote, setOtherNote] = useState(value?.state === "OTHER" ? (value.note ?? "") : "");

  const choose = (next: CustodyChoice) => onChange(custodyAfterChoice(next, value, { handedPlace, otherNote, legacy }));

  const options: { choice: CustodyChoice; label: string }[] = [
    { choice: "self", label: t("form.custody.self") },
    { choice: "handed", label: t("form.custody.handed") },
    { choice: "other", label: t("form.custody.other") },
  ];
  const legendId = `${id}-legend`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const legacyShown = value && isLegacyCustodyState(value.state) ? (value.state as keyof typeof LEGACY_STATE_KEY) : null;

  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3" aria-describedby={helpId}>
      <legend id={legendId} className="contents">
        <span className="text-sm font-medium text-foreground">
          {t("form.custody.title")} <span className="font-normal text-muted-foreground">{t("form.custody.optional")}</span>
        </span>
      </legend>
      <p id={helpId} className="-mt-1.5 text-xs leading-relaxed break-keep [overflow-wrap:anywhere] text-muted-foreground">
        {t("form.custody.help")}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-labelledby={legendId} className="grid min-w-0 flex-1 grid-cols-3 gap-1 rounded-xl border border-border bg-muted/60 p-1 sm:max-w-md">
          {options.map((o) => {
            const active = choice === o.choice;
            return (
              <button
                key={o.choice}
                type="button"
                aria-pressed={active}
                onClick={() => choose(o.choice)}
                className={`min-h-10 min-w-0 rounded-lg px-1.5 text-[13px] leading-tight font-medium break-keep [overflow-wrap:anywhere] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-60 ${
                  active ? "bg-card text-primary shadow-sm ring-1 ring-primary/40" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        {choice && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="min-h-10 shrink-0 rounded-lg px-2 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {t("form.custody.clear")}
          </button>
        )}
      </div>

      {choice === "self" && (
        <p className="text-xs leading-relaxed break-keep [overflow-wrap:anywhere] text-muted-foreground">{t("form.custody.selfHelp")}</p>
      )}

      {choice === "handed" && value && (
        <PlaceCombobox
          value={value.place}
          onChange={(place) => {
            setHandedPlace(place);
            onChange({ state: "REPORTED", place });
          }}
          campus={campus}
          institutions={institutions}
        />
      )}

      {choice === "other" && (
        <div className="flex flex-col gap-1.5 text-sm">
          {legacyShown && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed break-keep [overflow-wrap:anywhere] text-foreground">
              {t("form.custody.legacy", {
                state: t(LEGACY_STATE_KEY[legacyShown]) + (value?.place ? ` · ${value.place}` : ""),
              })}{" "}
              <span className="text-muted-foreground">{t("form.custody.legacyKeep")}</span>
            </p>
          )}
          <label htmlFor={`${id}-note`} className="font-medium text-foreground">
            {t("form.custody.otherLabel")}
          </label>
          <textarea
            id={`${id}-note`}
            ref={noteRef}
            rows={2}
            maxLength={CUSTODY_NOTE_MAX}
            value={otherNote}
            onChange={(e) => {
              const note = e.target.value;
              setOtherNote(note);
              onChange(note.trim() === "" && legacy ? legacy : { state: "OTHER", place: "", note });
            }}
            placeholder={t("form.custody.otherPlaceholder")}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-examples${error ? ` ${errorId}` : ""}`}
            className={`${FIELD} resize-y ${error ? "border-destructive" : ""}`}
          />
          <p id={`${id}-examples`} className="text-xs leading-relaxed break-keep [overflow-wrap:anywhere] text-muted-foreground">
            {t("form.custody.otherExamples")}
          </p>
          {error && (
            <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

// 맡긴 기관 또는 보관 장소: free text with suggestions for the chosen campus
// (registered 관리 기관 first, then kinds of office, then buildings), filtered
// by what is typed. A suggestion only fills the input; anything else can be
// typed. ARIA 1.2 combobox: arrow keys move, Enter picks, Escape closes.
function PlaceCombobox({
  value,
  onChange,
  campus,
  institutions,
}: {
  value: string;
  onChange: (v: string) => void;
  campus: string;
  institutions: readonly CustodyInstitution[];
}) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const all = useMemo<Suggestion[]>(() => {
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    const add = (s: Suggestion) => {
      if (seen.has(s.value)) return;
      seen.add(s.value);
      out.push(s);
    };
    for (const i of institutions) if (i.campus === campus) add({ value: i.name, label: i.name, group: "registered" });
    for (const p of PLACE_TYPES) add({ value: p.value, label: t(p.key), group: "types" });
    for (const b of getLocalizedLocationSuggestions(campus, t.locale)) add({ value: b.value, label: b.label, group: "buildings" });
    return out;
  }, [institutions, campus, t]);

  const query = value.trim().toLowerCase();
  const shown = query ? all.filter((s) => s.label.toLowerCase().includes(query) || s.value.toLowerCase().includes(query)) : all;
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  // the input keeps focus: options are picked on mousedown (preventDefault)
  // or with Enter in the input itself
  const pick = (s: Suggestion) => {
    onChange(s.value);
    setOpen(false);
    setActive(-1);
  };
  const groupLabel = { registered: t("form.custody.suggest.registered"), types: t("form.custody.suggest.types"), buildings: t("form.custody.suggest.buildings") };

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={`${id}-input`} className="font-medium text-foreground">
        {t("form.custody.placeLabel")} <span className="font-normal text-muted-foreground">{t("form.custody.placeOptional")}</span>
      </label>
      <div className="relative">
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          aria-describedby={`${id}-help`}
          autoComplete="off"
          maxLength={200}
          value={value}
          placeholder={t("form.custody.placePlaceholder")}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && open && active >= 0 && shown[active]) {
              e.preventDefault();
              pick(shown[active]);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              setOpen(false);
            }
          }}
          className={FIELD}
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label={t("form.custody.placeLabel")}
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg"
          >
            {shown.length === 0 ? (
              <li role="presentation" className="px-3 py-2 text-xs text-muted-foreground">
                {t("form.custody.suggest.none")}
              </li>
            ) : (
              shown.map((s, i) => (
                <li
                  key={`${s.group}-${s.value}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  // mousedown, not click: picking must happen before the
                  // input's blur closes the list
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(s);
                  }}
                  className={`flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm [overflow-wrap:anywhere] ${
                    i === active ? "bg-primary-muted text-primary" : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="min-w-0">{s.label}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{groupLabel[s.group]}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <p id={`${id}-help`} className="text-xs leading-relaxed break-keep [overflow-wrap:anywhere] text-muted-foreground">
        {t("form.custody.placeHelp")}
      </p>
    </div>
  );
}
