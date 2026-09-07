// Same policy as the legacy Streamlit project's db/database.py
// (NICKNAME_MIN_LENGTH/MAX_LENGTH/_NICKNAME_RE, enforced in
// set_initial_nickname()): trim whitespace, 2-20 chars, Korean/English/
// digits only. Pure and unit-testable -- shape validation only. Shared by
// onboarding's initial set (onboarding/actions.ts, once while nickname is
// still NULL) and the later change flow (me/actions.ts, any number of
// times) -- neither one enforces uniqueness anymore: Phase H-7 allows
// duplicate nicknames by design and dropped User.nickname's old @unique
// constraint, since public identity is now `User.publicId` instead.

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 20;

// Phase I section 7: how long a user must wait between nickname changes
// from /me (never applies to onboarding's own one-time initial set, which
// isn't a "change" -- see me/actions.ts's own comment). 7 days: a
// once-a-week cadence, the middle of this phase's own suggested 1/3/7/30
// range -- frequent enough that a genuine rebrand/typo-fix never feels
// blocked for long, infrequent enough to meaningfully discourage using
// nickname changes as a way to dodge being recognized right after
// something like a comment/report dispute.
export const NICKNAME_CHANGE_COOLDOWN_DAYS = 7;

const NICKNAME_PATTERN = /^[가-힣a-zA-Z0-9]+$/;

export type NicknameValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateNickname(raw: string): NicknameValidation {
  const value = (raw ?? "").trim();

  if (value.length < NICKNAME_MIN_LENGTH || value.length > NICKNAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `닉네임은 ${NICKNAME_MIN_LENGTH}~${NICKNAME_MAX_LENGTH}자여야 합니다.`,
    };
  }
  if (!NICKNAME_PATTERN.test(value)) {
    return { ok: false, error: "닉네임은 한글/영문/숫자만 사용할 수 있습니다." };
  }
  return { ok: true, value };
}
