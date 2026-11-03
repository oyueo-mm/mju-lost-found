"use client";

import { useId, useState } from "react";
import { CUSTODY_PLACES, CUSTODY_STATES, type CustodyInput } from "@/lib/posts/custodySchema";
import { getLocationSuggestions } from "@/lib/posts/campusLocations";

const field = "rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm text-foreground";

// One question, everyday wording: where is the item now? Only the input the
// chosen answer needs appears. "맡길 예정" and "맡겼어요" are separate answers
// so a plan is never read as a hand-over; an unknown or undecided place is
// left empty instead of a guessed one. UNKNOWN (보관 위치 모름) is no longer
// offered, only kept for posts that already have it.
const OPTIONS = [
  { state: "SELF", label: "제가 보관하고 있어요", hint: "돌려줄 방법은 채팅으로 정해요. 보관 위치는 공개되지 않아요." },
  { state: "PLANNED", label: "기관에 맡길 예정이에요", hint: "아직 맡기기 전이에요." },
  { state: "REPORTED", label: "기관에 맡겼어요", hint: "경비실 등 관리 기관에 이미 전달했어요." },
  { state: "UNHELD", label: "가져오지 않았어요", hint: "발견한 자리에 그대로 두었어요." },
] as const;

export function CustodyFields({
  value,
  onChange,
  campus,
  required = false,
  disabled,
}: {
  // null: not answered yet (a new post, or an older post without this info)
  value: CustodyInput | null;
  onChange: (v: CustodyInput) => void;
  campus: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  // 맡겼어요: does the finder know where it is kept? (an empty place = no)
  const [placeKnown, setPlaceKnown] = useState(value?.state !== "REPORTED" || value.place !== "");
  const options = value?.state === "UNKNOWN" ? [...OPTIONS, { state: "UNKNOWN" as const, label: CUSTODY_STATES.UNKNOWN, hint: "이전에 등록한 상태예요." }] : OPTIONS;
  const suggestions = [...CUSTODY_PLACES, ...getLocationSuggestions(campus)];
  const listId = `${id}-places`;
  const hintId = `${id}-hint`;
  const choose = (state: CustodyInput["state"]) => {
    if (state === "REPORTED") setPlaceKnown(true);
    onChange({ state, place: state === value?.state ? value.place : "" });
  };
  const toggle = (active: boolean) =>
    `min-h-9 rounded-md px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
      active ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
    }`;

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-medium">
        지금 물건은 어디에 있나요?
        {required && (
          <span className="text-destructive" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const checked = value?.state === o.state;
          return (
            <label
              key={o.state}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40 ${
                checked ? "border-primary bg-primary-muted" : "border-border hover:border-primary/40"
              }`}
            >
              <input
                type="radio"
                name={`${id}-custody`}
                value={o.state}
                checked={checked}
                required={required}
                onChange={() => choose(o.state)}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          );
        })}
      </div>

      {value?.state === "PLANNED" && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span>
            맡길 곳 <span className="font-normal text-muted-foreground">(정했다면)</span>
          </span>
          <input
            className={field}
            list={listId}
            maxLength={200}
            value={value.place}
            onChange={(e) => onChange({ ...value, place: e.target.value })}
            placeholder="아직 안 정했다면 비워 두세요"
            aria-describedby={hintId}
          />
        </label>
      )}

      {value?.state === "REPORTED" && (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span id={`${id}-known`}>맡긴 곳을 알고 있나요?</span>
            <div role="group" aria-labelledby={`${id}-known`} className="inline-flex rounded-lg border border-border p-0.5">
              <button type="button" aria-pressed={placeKnown} className={toggle(placeKnown)} onClick={() => setPlaceKnown(true)}>
                알아요
              </button>
              <button
                type="button"
                aria-pressed={!placeKnown}
                className={toggle(!placeKnown)}
                onClick={() => {
                  setPlaceKnown(false);
                  onChange({ ...value, place: "" });
                }}
              >
                잘 모르겠어요
              </button>
            </div>
          </div>
          {placeKnown ? (
            <label className="flex flex-col gap-1.5">
              맡긴 곳
              <input
                className={field}
                list={listId}
                maxLength={200}
                required
                value={value.place}
                onChange={(e) => onChange({ ...value, place: e.target.value })}
                placeholder="예: 국제관 1층 경비실"
                aria-describedby={hintId}
              />
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">장소는 비워 둘게요. 나중에 알게 되면 게시글을 수정해 추가할 수 있어요.</p>
          )}
        </div>
      )}

      {(value?.state === "PLANNED" || value?.state === "REPORTED") && (
        <>
          <datalist id={listId}>
            {suggestions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <p id={hintId} className="text-xs text-muted-foreground">
            목록은 입력 예시예요. 목록에 없는 곳도 직접 쓸 수 있어요. 기관의 실제 접수 여부는 담당자가 확인한 뒤 표시됩니다.
          </p>
        </>
      )}
      {(value?.state === "SELF" || value?.state === "PLANNED") && (
        <p className="text-xs text-muted-foreground">가까운 교내 경비실 등 관리 기관에 맡기면 주인이 더 쉽게 찾을 수 있어요. 방문 전 수령 가능 여부를 확인해주세요.</p>
      )}
    </fieldset>
  );
}
