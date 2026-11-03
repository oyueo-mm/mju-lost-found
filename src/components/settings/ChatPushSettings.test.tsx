import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(main)/me/push/actions", () => ({ deletePushSubscriptionAction: vi.fn(), pushStatusAction: vi.fn(), savePushSubscriptionAction: vi.fn() }));
vi.mock("@/lib/i18n/client", () => ({ useI18n: () => ({ t: (k: string) => k, locale: "ko" }) }));
const { ChatPushSettings } = await import("./ChatPushSettings");

describe("채팅 푸시 알림 card", () => {
  it("does not exist for users when the deployment has no VAPID key (push switched off)", () => {
    expect(renderToStaticMarkup(<ChatPushSettings vapidPublicKey={null} />)).toBe("");
  });
  it("is shown, switch not yet offered until the browser is checked, when configured", () => {
    const html = renderToStaticMarkup(<ChatPushSettings vapidPublicKey="BExample" />);
    expect(html).toContain("push.title");
    expect(html).not.toContain('role="switch"');
  });
});
