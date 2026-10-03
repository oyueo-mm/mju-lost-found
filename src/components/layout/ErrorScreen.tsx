"use client";

import { useEffect } from "react";

import { StatusScreen } from "@/components/layout/StatusScreen";
import { Button, LinkButton } from "@/components/ui/Button";

// The app's error boundary UI (app/error.tsx and (main)/error.tsx). The
// error itself is only logged to the browser console; the user sees a
// plain explanation plus the opaque digest Next.js attaches (it matches
// the server log entry, and carries no internal detail).
export function ErrorScreen({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      title="일시적인 오류가 발생했어요"
      description="요청을 처리하는 중에 문제가 생겼어요. 잠시 후 다시 시도해주세요. 문제가 계속되면 의견 보내기로 알려주세요."
      actions={
        <>
          <Button type="button" onClick={() => retry()}>
            다시 시도
          </Button>
          <LinkButton href="/" variant="secondary">
            홈으로
          </LinkButton>
        </>
      }
      footnote={error.digest ? `오류 번호: ${error.digest}` : undefined}
    />
  );
}
