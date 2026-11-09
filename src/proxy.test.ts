import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { LANDING_HEADER } from "./lib/metrics/landing";

it("overwrites a forged return header with the actual validated destination", () => {
  const req = new NextRequest("https://example.com/found/new?utm_source=poster_qr&utm_campaign=h_guard01_register&secret=private", { headers: { [LANDING_HEADER]: "/admin" } });
  const response = proxy(req);
  expect(response.headers.get(`x-middleware-request-${LANDING_HEADER}`)).toBe("/found/new?utm_source=poster_qr&utm_campaign=h_guard01_register");
});
