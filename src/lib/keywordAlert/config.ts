// Shared, server-only limits for the 키워드 알림 (keyword alert) feature --
// mirrors src/lib/images/config.ts's own "plain constants module, no
// Prisma import" shape so a client component can import the length caps
// directly for its own maxLength props without pulling in the DB layer.
// All of these are re-checked server-side in keywordAlert/service.ts
// regardless of what the client sends (same "never trust the client's own
// request shape alone" rule that module's own comment states).

// A generous-but-bounded cap, same order of magnitude as this app's other
// per-user list caps (e.g. MY_FEEDBACK_CAP) -- this is a personal
// notification-rule list, not something a user would realistically need
// dozens of for a campus lost-and-found app.
export const MAX_KEYWORD_ALERTS_PER_USER = 20;

// Matches aiService.ts's own queryTokens() minimum (>=2 characters) --
// below that, a keyword would match almost any title/description and stop
// being a useful "대표 키워드" filter at all.
export const KEYWORD_MIN_LENGTH = 2;
export const KEYWORD_MAX_LENGTH = 50;

export const MAX_EXCLUDE_KEYWORDS_PER_ALERT = 10;
// Same min/max as the keyword itself -- an exclude keyword is compared the
// exact same way (case-insensitive substring match), so the same length
// floor/ceiling applies for the same reason.
export const EXCLUDE_KEYWORD_MIN_LENGTH = KEYWORD_MIN_LENGTH;
export const EXCLUDE_KEYWORD_MAX_LENGTH = KEYWORD_MAX_LENGTH;
