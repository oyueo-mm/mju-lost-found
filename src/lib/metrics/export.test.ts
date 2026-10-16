import { inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { datasetsOf, toCsv, toSheets, toXlsx, CAVEATS } = await import("./export");
const { buildCsv, crc32, safeText } = await import("./xlsx");
type Report = import("./report").Report;

// A three-day report: 10/14 is before 방문 통계 began (미측정), 10/15 partial.
function fakeReport(): Report {
  const range = { from: "2026-10-14", until: "2026-10-17", unit: "day" as const };
  const n = (a: number | null, b: number | null, c: number | null) => [a, b, c];
  const core = {
    signups: n(1, 4, 2),
    active: n(null, 9, 5),
    lost: n(0, 1, 0),
    found: n(2, 0, 1),
    searchKeyword: n(null, 1, 3),
    searchSemantic: n(null, 3, 0),
    searchImage: n(null, 0, 1),
    recommend: n(null, 0, 2),
    chatRooms: n(0, 1, 0),
    messages: n(0, 5, 2),
    completed: n(1, 0, 1),
  };
  const visit = {
    pvAnon: n(null, 71, 20),
    pvMember: n(null, 38, 10),
    sessionAnon: n(null, 21, 6),
    sessionMember: n(null, 0, 2),
    searchAnon: n(null, 0, 2),
    searchMember: n(null, 0, 1),
    internalPv: n(null, 58, 3),
  };
  const coverage = Object.fromEntries(
    [...Object.keys(core), ...Object.keys(visit)].map((k) => [k, ["signups", "lost", "found", "chatRooms", "messages", "completed"].includes(k) ? ["full", "full", "full"] : ["none", "partial", "full"]]),
  );
  const totals = Object.fromEntries(
    Object.entries({ ...core, ...visit }).map(([k, v]) => [k, v.reduce<number>((a, x) => a + (x ?? 0), 0)]),
  ) as Report["totals"];
  totals.active = 12;
  return {
    range,
    buckets: ["2026-10-14", "2026-10-15", "2026-10-16"],
    generatedAt: "2026-10-16 09:30",
    today: "2026-10-16",
    core,
    visit,
    completedByType: { lost: n(1, 0, 0), found: n(0, 0, 1) },
    coverage: coverage as Report["coverage"],
    totals,
    totalCoverage: Object.fromEntries(Object.entries(coverage).map(([k, c]) => [k, c[0] === "full" ? "full" : "partial"])) as Report["totalCoverage"],
    breakdown: {
      pages: [{ kind: "home", anon: 40, member: 8 }],
      refs: [
        { source: "everytime", sessions: 17 },
        { source: "direct", sessions: 12 },
      ],
      utmSources: [{ value: "everytime", sessions: 5 }],
      utmCampaigns: [{ value: "-launch", sessions: 2 }],
    },
    internalSearches: 0,
    flow: {
      startSince: "2026-10-16",
      since: "2026-10-16",
      coverage: "partial",
      startCoverage: "partial",
      startHour: Array.from({ length: 24 }, (_, h) => (h === 10 ? 3 : h === 21 ? 2 : 0)),
      endHour: Array.from({ length: 24 }, (_, h) => (h === 10 ? 2 : h === 22 ? 2 : 0)),
      startDow: [0, 0, 0, 0, 5, 0, 0],
      endDow: [0, 0, 0, 0, 4, 0, 0],
      firstPage: { home: 3, lost: 2 },
      exitPage: { post: 2, home: 1, found: 1 },
      pageViewsSinceFlow: { post: 4, home: 5, found: 2, lost: 3 },
      exitByDevice: { mobile: { post: 2, home: 1 }, pc: { found: 1 }, tablet: {}, other: {} },
      paths: [
        { first: "home", last: "post", sessions: 2 },
        { first: "home", last: "home", sessions: 1 },
      ],
      duration: { lt10s: 1, "10to30s": 0, "30to60s": 1, "1to3m": 2, "3to5m": 0, "5to10m": 0, "10mplus": 0 },
      durationByDevice: {
        mobile: { lt10s: 1, "10to30s": 0, "30to60s": 0, "1to3m": 2, "3to5m": 0, "5to10m": 0, "10mplus": 0 },
        pc: { lt10s: 0, "10to30s": 0, "30to60s": 1, "1to3m": 0, "3to5m": 0, "5to10m": 0, "10mplus": 0 },
        tablet: { lt10s: 0, "10to30s": 0, "30to60s": 0, "1to3m": 0, "3to5m": 0, "5to10m": 0, "10mplus": 0 },
        other: { lt10s: 0, "10to30s": 0, "30to60s": 0, "1to3m": 0, "3to5m": 0, "5to10m": 0, "10mplus": 0 },
      },
      durationSeconds: { mobile: 250, pc: 40, tablet: 0, other: 0 },
      flowSessions: { mobile: 3, pc: 1, tablet: 0, other: 0 },
      pages: { "1": 1, "2": 1, "3to4": 2, "5to9": 0, "10plus": 0 },
      open: 3,
      closed: 1,
    },
    device: {
      since: "2026-10-16",
      coverage: ["none", "none", "partial"],
      totalCoverage: "partial",
      pv: { mobile: n(null, null, 20), pc: n(null, null, 8), tablet: n(null, null, 2), other: n(null, null, 0) },
      session: { mobile: n(null, null, 5), pc: n(null, null, 2), tablet: n(null, null, 1), other: n(null, null, 0) },
      totals: { pv: { mobile: 20, pc: 8, tablet: 2, other: 0 }, session: { mobile: 5, pc: 2, tablet: 1, other: 0 } },
    },
    timings: [
      { route: "GET /api/posts", count: 10, errors: 1, avgMs: 250, p50: "≤ 200ms", p95: "≤ 800ms", totalMs: 2500, buckets: [0, 0, 0, 5, 4, 1, 0, 0, 0, 0] },
      { route: "ai:text-embed", count: 3, errors: 0, avgMs: 600, p50: "≤ 800ms", p95: "≤ 800ms", totalMs: 1800, buckets: [0, 0, 0, 0, 0, 3, 0, 0, 0, 0] },
    ],
    capacity: { day: "2026-10-16", dbMb: 17, storageMb: 13 },
  };
}

// Minimal unzip for the test: entry name -> text.
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = inflateRawSync(buf.subarray(dataStart, dataStart + size));
    expect(crc32(data)).toBe(crc);
    out.set(name, data.toString("utf8"));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

describe("운영 통계 내보내기", () => {
  it("builds six sheets whose totals match the report (the dashboard's numbers)", () => {
    const report = fakeReport();
    const sets = datasetsOf(report);
    expect(sets.map((s) => s.name)).toEqual(["운영 요약", "방문 통계", "유입 분석", "서비스 이용", "완료 처리", "서버 운영", "방문 시간·이탈"]);
    const summary = sets[0].tables[0].rows;
    const value = (label: string) => summary.find((r) => r[1] === label)?.[2];
    expect(value("페이지뷰 합계")).toBe(71 + 20 + 38 + 10);
    expect(value("방문 세션 합계")).toBe(21 + 6 + 0 + 2);
    expect(value("검색 합계")).toBe(1 + 3 + 3 + 0 + 0 + 1);
    expect(value("로그인 구분 집계 전 검색")).toBe(8 - 3);
    expect(value("에브리타임 유입 방문 세션")).toBe(17);
    expect(value("활성 회원(기간 내 서로 다른 로그인 회원)")).toBe(12);
    // a 미측정 day stays null, never 0
    expect(sets[1].tables[0].rows[0]).toEqual(["2026-10-14", null, null, null, null, null, null, null, null, null]);
  });

  it("adds the device split to the summary and the 방문 통계 sheet (미측정 before it began)", () => {
    const sets = datasetsOf(fakeReport());
    const summary = sets[0].tables[0].rows;
    expect(summary.find((r) => r[1] === "방문 세션(모바일(스마트폰))")?.[2]).toBe(5);
    expect(summary.find((r) => r[1] === "방문 세션(태블릿)")?.[2]).toBe(1);
    const device = sets[1].tables[1];
    expect(device.title).toContain("접속 기기별");
    expect(device.rows[0]).toEqual(["2026-10-14", null, null, null, null, null, null, null, null]);
    expect(device.rows[2]).toEqual(["2026-10-16", 5, 2, 1, 0, 20, 8, 2, 0]);
    expect(device.total).toEqual(["합계", 5, 2, 1, 0, 20, 8, 2, 0]);
    expect(toCsv(fakeReport(), "visits")).toContain("2026-10-16,5,2,1,0,20,8,2,0");
  });

  it("adds 방문 시간·이탈: start/exit by hour, durations (estimates), screens, open sessions", () => {
    const flow = datasetsOf(fakeReport()).find((d) => d.key === "flow")!;
    const summary = Object.fromEntries(flow.tables[0].rows.map((r) => [r[0], r[1]]));
    expect(summary["평균 체류 시간 (초)"]).toBe(73); // (250 + 40) / 4
    expect(summary["체류 시간 중앙값 (구간)"]).toBe("30초~1분");
    expect(summary["한 화면만 보고 끝난 방문 비율 (÷ 체류·이탈 집계 방문)"]).toBe("25.0%");
    expect(summary["종료 미확인 방문 (다시 오지 않아 끝을 확인 못 함, 대부분 이미 떠남)"]).toBe(3);
    // 종료율: exits ÷ page views of the same days (post: 2 ÷ 4)
    const post = flow.tables[5].rows.find((r) => r[0] === "게시글 상세")!;
    expect(post.slice(0, 5)).toEqual(["게시글 상세", 0, 2, 4, 0.5]);
    expect(flow.tables[1].rows[10]).toEqual(["10시", 3, 2]);
    expect(flow.tables[1].rows[22]).toEqual(["22시", 0, 2]);
    expect(flow.tables[2].rows[4]).toEqual(["금", 5, 4]);
    expect(flow.notes.join(" ")).toContain("추정치");
    expect(toCsv(fakeReport(), "flow")).toContain("# MJU Find 운영 통계 - 방문 시간·이탈");
  });

  it("states the required caveats in every file", () => {
    const text = CAVEATS.join("\n");
    expect(text).toContain("고유 방문자 수가 아닙니다");
    expect(text).toContain("실제 물품 반환을 확인한 수치가 아닙니다");
    expect(text).toContain("미측정");
    expect(text).toContain("직접 비교하지 마세요");
    const sheets = toSheets(fakeReport());
    for (const sheet of sheets) {
      const cells = sheet.rows.flat().map((c) => (c && typeof c === "object" ? c.v : c));
      expect(cells[0]).toContain("MJU Find 운영 통계");
      expect(cells.some((v) => typeof v === "string" && v.startsWith("통계 기간: 2026-10-14 ~ 2026-10-16"))).toBe(true);
      expect(cells.some((v) => typeof v === "string" && v.startsWith("생성 일시: 2026-10-16 09:30 (KST)"))).toBe(true);
    }
  });

  it("writes a valid xlsx package: six sheets, dates as dates, 미측정 as text, no formulas", () => {
    const files = unzip(toXlsx(fakeReport()));
    expect([...files.keys()]).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet6.xml"]),
    );
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="운영 요약"');
    const visits = files.get("xl/worksheets/sheet2.xml")!;
    expect(visits).toContain("<v>46309</v>"); // 2026-10-15 as an Excel date
    expect(visits).toContain("미측정");
    expect([...files.values()].join("")).not.toContain("<f>");
    // a value that looks like a formula is written as text with a leading apostrophe
    expect(files.get("xl/worksheets/sheet3.xml")).toContain("&apos;-launch".replace("&apos;", "'"));
  });

  it("lists each API with its role in the 서버 운영 sheet", () => {
    const server = datasetsOf(fakeReport()).find((d) => d.key === "server")!;
    expect(server.tables[1].columns.map((c) => c.label)).toContain("비고(기능)");
    expect(server.tables[1].rows[0].slice(0, 3)).toEqual(["GET /api/posts", "분실물·습득물 게시글 목록·키워드 검색", 10]);
    expect(server.tables[2].rows[0].slice(0, 2)).toEqual(["ai:text-embed", "AI 문장 임베딩 1건 계산 (검색어·게시글)"]);
  });

  it("writes one CSV per data kind, with notes on top and blanks for 미측정", () => {
    const csv = toCsv(fakeReport(), "visits");
    expect(csv.startsWith("﻿# MJU Find 운영 통계 - 방문 통계")).toBe(true);
    expect(csv).toContain("# 통계 기간: 2026-10-14 ~ 2026-10-16 · 집계 단위 일별");
    expect(csv).toContain("# 빈 칸은 미측정");
    expect(csv).toContain("\r\n2026-10-14,,,,,,,,,\r\n");
    expect(csv).toContain("2026-10-15,71,38,109,21,0,21,65.1,9,58");
    expect(toCsv(fakeReport(), "referrals")).toContain("'-launch,2");
    expect(toCsv(fakeReport(), "visits", "이번 주 (2026-10-12 ~ 2026-10-16)")).toContain("# 통계 기간: 이번 주 (2026-10-12 ~ 2026-10-16) · 집계 단위 일별");
  });

  it("neutralizes spreadsheet formulas in CSV and quotes separators", () => {
    expect(safeText("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(safeText("+1")).toBe("'+1");
    expect(safeText("@SUM")).toBe("'@SUM");
    expect(safeText("GET /api/posts")).toBe("GET /api/posts");
    expect(buildCsv([["=1+1", 'a,"b"', -5, null]])).toBe('﻿\'=1+1,"a,""b""",-5,\r\n');
  });
});
