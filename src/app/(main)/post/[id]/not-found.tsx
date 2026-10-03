import { StatusScreen } from "@/components/layout/StatusScreen";
import { LinkButton } from "@/components/ui/Button";

// /post/[id] for a post that was deleted or never existed (page.tsx calls
// notFound() for both, and for a malformed id/type).
export default function PostNotFound() {
  return (
    <StatusScreen
      title="삭제되었거나 존재하지 않는 게시글이에요"
      description="작성자가 게시글을 삭제했거나, 주소가 잘못되었을 수 있어요."
      actions={
        <>
          <LinkButton href="/lost">분실물 게시판</LinkButton>
          <LinkButton href="/found" variant="secondary">
            습득물 게시판
          </LinkButton>
          <LinkButton href="/search" variant="secondary">
            검색하기
          </LinkButton>
        </>
      }
    />
  );
}
