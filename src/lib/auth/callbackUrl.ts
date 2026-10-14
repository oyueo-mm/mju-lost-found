// /login reads a caller-supplied `callbackUrl` back out of its own query
// string (see session.ts's loginRedirectUrl, and DirectChatButton's
// login-prompt link on /post/[id]) to send the user back where they came
// from after signing in; the 실명·학과 form does the same. That value crosses
// a client-visible URL, so it's untrusted regardless of who normally sets
// it -- only a same-origin relative path is accepted: it must start with
// exactly one "/", never "//..." (protocol-relative to an *external* host),
// never contain "://", and never contain a backslash or control character
// (browsers read "/\evil.example" as "//evil.example"). So this can never
// become an open redirect to another site. Returns undefined for anything
// else, which callers treat as "no callback url" rather than an error.
//
// Kept in its own module (re-exported by session.ts) so code that only
// needs this check doesn't pull in Auth.js.
export function sanitizeCallbackUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("://")) return undefined;
  if (/[\\\u0000-\u001f\u007f]/.test(url)) return undefined;
  return url;
}
