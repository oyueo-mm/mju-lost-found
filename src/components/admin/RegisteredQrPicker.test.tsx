import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RegisteredQrPicker } from "./RegisteredQrPicker";

it("renders Korean cascading filters, both purposes and registered metadata without direct inputs", () => {
  const html = renderToStaticMarkup(<RegisteredQrPicker month="2026-11" />);
  expect(html).toContain("캠퍼스"); expect(html).toContain("건물"); expect(html).toContain("설치 장소"); expect(html).toContain("QR 용도");
  expect(html).toContain("분실물 찾기"); expect(html).toContain("습득물 등록");
  expect(html).toContain("h_jonghap_guard_find"); expect(html).toContain("h_jonghap_guard_reg");
  expect(html).toContain("PNG 일괄 다운로드 (ZIP)");
  expect(html).not.toContain('<input');
});

it("explains an empty registry without generating a QR for an absent combination", () => {
  const html = renderToStaticMarkup(<RegisteredQrPicker month="2026-11" entries={[]} />);
  expect(html).toContain("현재 선택 가능한 등록 QR이 없습니다");
  expect(html).not.toContain("data-qr-url");
});
