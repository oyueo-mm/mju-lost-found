import type { Metadata } from "next";

import { StatusScreen } from "@/components/layout/StatusScreen";
import { LinkButton } from "@/components/ui/Button";

export const metadata: Metadata = { title: "페이지를 찾을 수 없어요" };

// Any URL the app doesn't have, and every notFound() without a closer
// not-found.tsx.
export default function NotFound() {
  return (
    <StatusScreen
      title="페이지를 찾을 수 없어요"
      description="주소가 바뀌었거나 삭제된 페이지일 수 있어요. 주소를 다시 확인해주세요."
      actions={
        <>
          <LinkButton href="/">홈으로</LinkButton>
          <LinkButton href="/search" variant="secondary">
            분실물 검색
          </LinkButton>
        </>
      }
    />
  );
}
