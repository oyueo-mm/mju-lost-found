// 명지대 Google 계정 실명·학과 조회 가능 여부 점검 (개발용, 앱과 무관).
//
// Signs in once with YOUR OWN Google account through a SEPARATE, test-only
// OAuth client (type "Desktop app", in its own Google Cloud project -- the
// app's Preview/Production OAuth clients are not used or changed), asks
// for "openid email profile" + user.organization.read, and reports only
// WHETHER the name and department fields exist and where they come from.
//
// It never prints or writes: names, departments, e-mail addresses, tokens,
// the authorization code, or raw API responses. The access token is
// revoked at the end. No admin scope, no domain-wide delegation.
//
//   $env:GOOGLE_PROBE_CLIENT_ID="...apps.googleusercontent.com"   (PowerShell)
//   $env:GOOGLE_PROBE_CLIENT_SECRET="..."
//   node scripts/probeGoogleIdentity.mjs            # real check
//   node scripts/probeGoogleIdentity.mjs --self-test # no network: checks the
//                                                     # report never leaks values
//   GOOGLE_PROBE_NO_BROWSER=1                         # print the URL, don't open it
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/user.organization.read"];
const EXPECTED_DOMAIN = "mju.ac.kr";
const ORG_TYPES = new Set(["work", "school"]);
// A department that names an academic unit (학과·학부·전공 …) rather than an
// office -- reported as a yes/no only.
const ACADEMIC_UNIT = /(학과|학부|전공|대학|과|department|major|school|faculty)\s*$/i;

// ---------- "이름/신분/소속" display-name format (shape only) ----------
// Same rules as src/lib/identity/googleHints.ts parseGoogleDisplayName and
// src/lib/identity/validation.ts (kept in step by googleHints.test.ts).
const MEMBER_TYPE_WORDS = ["학생", "교수", "직원", "조교", "연구원"];
const REAL_NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'·-]*$/u;
const DEPARTMENT = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'·&()/,-]*$/u;
const tidy = (v) => v.normalize("NFC").replace(/\s+/g, " ").trim();
const validName = (v) => [...tidy(v)].length >= 2 && [...tidy(v)].length <= 40 && REAL_NAME.test(tidy(v));
const validAffiliation = (v) => [...tidy(v)].length >= 2 && [...tidy(v)].length <= 50 && DEPARTMENT.test(tidy(v));

export function classifyDisplayName(raw) {
  if (typeof raw !== "string" || raw.length === 0) return { present: false };
  const parts = raw.normalize("NFC").split("/").map((p) => p.trim());
  const three = parts.length === 3 && parts.every((p) => p !== "");
  const middleIsMemberType = three && MEMBER_TYPE_WORDS.includes(parts[1]);
  const namePartValid = three ? validName(parts[0]) : null;
  const affiliationPartValid = three ? validAffiliation(parts[2]) : null;
  const affiliation = three ? tidy(parts[2]) : "";
  const affiliationLevel = !three
    ? null
    : /(학과|학부|전공)$/.test(affiliation)
      ? "department_like"
      : /(대학|대학원)$/.test(affiliation)
        ? "college_like"
        : "other";
  return {
    present: true,
    slashParts: parts.length,
    exactlyThreeParts: three,
    middleIsMemberType,
    namePartValid,
    affiliationPartValid,
    affiliationLevel,
    wouldSplit: Boolean(three && middleIsMemberType && namePartValid && affiliationPartValid),
    wholeNameUsableAsIs: !three && validName(raw),
  };
}

// ---------- report builders: only booleans, counts and fixed enums ----------

const sourceType = (field) => {
  const type = field?.metadata?.source?.type;
  return ["PROFILE", "DOMAIN_PROFILE", "ACCOUNT", "CONTACT", "DOMAIN_CONTACT", "OTHER_CONTACT"].includes(type) ? type : "UNKNOWN";
};

export function summarizeIdToken(claims) {
  const hd = typeof claims.hd === "string" ? (claims.hd === EXPECTED_DOMAIN ? EXPECTED_DOMAIN : "other-domain") : "absent";
  const email = typeof claims.email === "string" ? claims.email : "";
  return {
    hd,
    emailDomainIsMju: email.toLowerCase().endsWith(`@${EXPECTED_DOMAIN}`),
    emailVerified: claims.email_verified === true,
    hasName: typeof claims.name === "string" && claims.name.length > 0,
    hasGivenName: typeof claims.given_name === "string" && claims.given_name.length > 0,
    hasFamilyName: typeof claims.family_name === "string" && claims.family_name.length > 0,
    hasPicture: typeof claims.picture === "string",
    displayNameFormat: classifyDisplayName(claims.name),
  };
}

export function summarizePerson(person, idTokenName) {
  const sources = {};
  for (const s of person?.metadata?.sources ?? []) {
    const t = ["PROFILE", "DOMAIN_PROFILE", "ACCOUNT", "CONTACT"].includes(s?.type) ? s.type : "UNKNOWN";
    sources[t] = (sources[t] ?? 0) + 1;
  }
  const names = (person?.names ?? []).map((n) => ({
    source: sourceType(n),
    primary: n?.metadata?.primary === true,
    hasDisplayName: Boolean(n?.displayName),
    hasGivenName: Boolean(n?.givenName),
    hasFamilyName: Boolean(n?.familyName),
    sameAsLoginName: typeof idTokenName === "string" && n?.displayName ? n.displayName === idTokenName : null,
  }));
  const organizations = (person?.organizations ?? []).map((o) => ({
    source: sourceType(o),
    primary: o?.metadata?.primary === true,
    type: typeof o?.type === "string" ? (ORG_TYPES.has(o.type) ? o.type : "custom") : "absent",
    current: typeof o?.current === "boolean" ? o.current : null,
    hasOrganizationName: Boolean(o?.name),
    hasDepartment: Boolean(o?.department),
    departmentLooksLikeAcademicUnit: typeof o?.department === "string" ? ACADEMIC_UNIT.test(o.department.trim()) : null,
    hasTitle: Boolean(o?.title),
  }));
  return {
    personSources: sources,
    nameCount: names.length,
    names,
    organizationCount: organizations.length,
    organizations,
    departmentAvailable: organizations.some((o) => o.hasDepartment),
  };
}

// Google API errors: status and reason codes only (never the request).
function errorSummary(status, body) {
  const err = body?.error;
  const reason = err?.details?.find?.((d) => d?.reason)?.reason ?? err?.errors?.[0]?.reason ?? null;
  return { httpStatus: status, status: typeof err?.status === "string" ? err.status : null, reason: typeof reason === "string" ? reason : null };
}

// ---------- self-test: the report must never contain the values ----------

function selfTest() {
  const secrets = ["홍길동", "Gildong", "Hong", "컴퓨터공학과", "명지대학교", "교수", "student@mju.ac.kr", "ya29.secret-token"];
  const claims = { sub: "1", hd: "mju.ac.kr", email: "student@mju.ac.kr", email_verified: true, name: "홍길동/학생/컴퓨터공학과", given_name: "Gildong", family_name: "Hong", picture: "https://x" };
  const person = {
    metadata: { sources: [{ type: "PROFILE" }, { type: "DOMAIN_PROFILE" }] },
    names: [{ displayName: "홍길동/학생/컴퓨터공학과", givenName: "Gildong", familyName: "Hong", metadata: { primary: true, source: { type: "DOMAIN_PROFILE" } } }],
    organizations: [{ name: "명지대학교", department: "컴퓨터공학과", title: "교수", type: "school", current: true, metadata: { primary: true, source: { type: "DOMAIN_PROFILE" } } }],
  };
  const report = JSON.stringify({ idToken: summarizeIdToken(claims), people: summarizePerson(person, claims.name), error: errorSummary(403, { error: { status: "PERMISSION_DENIED", message: "student@mju.ac.kr 홍길동", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }) });
  const leaked = secrets.filter((s) => report.includes(s));
  const people = summarizePerson(person, claims.name);
  const format = summarizeIdToken(claims).displayNameFormat;
  const ok =
    leaked.length === 0 &&
    !report.includes("학생/") &&
    people.departmentAvailable === true &&
    people.organizations[0].departmentLooksLikeAcademicUnit === true &&
    format.wouldSplit === true &&
    format.affiliationLevel === "department_like";
  console.log(ok ? "SELF-TEST PASSED: the report carries no names, departments, e-mails or tokens." : `SELF-TEST FAILED (leaked: ${leaked.length})`);
  process.exit(ok ? 0 : 1);
}

// ---------- the real check ----------

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  const clientId = process.env.GOOGLE_PROBE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_PROBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.log("GOOGLE_PROBE_CLIENT_ID / GOOGLE_PROBE_CLIENT_SECRET 환경변수가 필요합니다 (테스트 전용 Desktop app OAuth 클라이언트).");
    process.exit(2);
  }

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  const { code, redirectUri, authError } = await new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/callback") return res.writeHead(404).end();
      const error = url.searchParams.get("error");
      const ok = !error && url.searchParams.get("state") === state;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<p style="font-family:sans-serif">${ok ? "로그인 완료. 터미널로 돌아가세요." : "로그인이 완료되지 않았습니다. 터미널의 안내를 확인하세요."}</p>`);
      server.close();
      resolve({
        code: ok ? url.searchParams.get("code") : null,
        redirectUri: `http://127.0.0.1:${server.address()?.port ?? port}/callback`,
        authError: error ?? (url.searchParams.get("state") !== state ? "state_mismatch" : null),
      });
    });
    let port;
    // Errors such as admin_policy_enforced (a school policy blocking the
    // app) are shown on Google's own page and never come back here.
    const timeout = setTimeout(() => {
      server.close();
      resolve({ code: null, redirectUri: null, authError: "no_callback_within_5_minutes" });
    }, 5 * 60 * 1000);
    server.on("close", () => clearTimeout(timeout));
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `http://127.0.0.1:${port}/callback`,
        response_type: "code",
        scope: SCOPES.join(" "),
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        hd: EXPECTED_DOMAIN,
        prompt: "consent select_account",
        include_granted_scopes: "false",
      }).toString();
      console.log("브라우저에서 @mju.ac.kr 계정으로 로그인하고, '조직 정보' 권한 체크박스도 선택해 주세요.");
      console.log("브라우저가 열리지 않으면 아래 주소를 직접 여세요:\n" + auth.toString() + "\n");
      if (process.platform === "win32" && process.env.GOOGLE_PROBE_NO_BROWSER !== "1") {
        spawn("cmd", ["/c", "start", "", auth.toString()], { detached: true, stdio: "ignore" }).unref();
      }
    });
  });

  const report = { step: "authorize" };
  if (!code) {
    report.result = "authorization_failed";
    report.error = authError;
    if (authError === "no_callback_within_5_minutes") {
      report.hint = "Google 화면에 표시된 오류 코드(예: admin_policy_enforced, org_internal, access_denied)를 확인해 알려주세요.";
    }
    return finish(report);
  }

  report.step = "token";
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: verifier }),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    report.result = "token_exchange_failed";
    report.error = { httpStatus: tokenRes.status, error: typeof token.error === "string" ? token.error : null };
    return finish(report);
  }
  const granted = new Set(String(token.scope ?? "").split(" "));
  report.grantedScopes = {
    profile: granted.has("https://www.googleapis.com/auth/userinfo.profile") || granted.has("profile"),
    email: granted.has("https://www.googleapis.com/auth/userinfo.email") || granted.has("email"),
    organizationRead: granted.has(SCOPES[3]),
  };

  const claims = token.id_token ? JSON.parse(Buffer.from(token.id_token.split(".")[1], "base64url").toString("utf8")) : {};
  report.idToken = summarizeIdToken(claims);

  report.step = "people";
  const peopleRes = await fetch("https://people.googleapis.com/v1/people/me?personFields=names,organizations&sources=READ_SOURCE_TYPE_PROFILE", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const person = await peopleRes.json().catch(() => ({}));
  if (peopleRes.ok) {
    report.people = summarizePerson(person, claims.name);
    report.result = report.people.departmentAvailable ? "department_available" : "no_department_in_people_api";
  } else {
    report.result = "people_api_failed";
    report.error = errorSummary(peopleRes.status, person);
  }

  // Clean up: revoke the grant so nothing stays authorized.
  const revoke = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: token.access_token }),
  }).catch(() => null);
  report.tokenRevoked = revoke?.ok === true;
  return finish(report);
}

function finish(report) {
  console.log("\n===== 결과 (값 없이 존재 여부만) =====");
  console.log(JSON.stringify(report, null, 2));
}

// Run only as a script (tests import the classifiers above).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
