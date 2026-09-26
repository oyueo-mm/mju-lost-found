import { prisma } from "@/lib/db/prisma";
import { NotificationType, Prisma, type KeywordAlertPostType } from "@/generated/prisma/client";
import type { PostType } from "@/lib/posts/schema";

// 키워드 알림 Phase: 새 LostPost/FoundPost가 커밋된 *뒤에* 호출되는
// best-effort 매칭 -- posts/aiService.ts의 createLostPost/createFoundPost가
// embedPostBestEffort()와 정확히 같은 방식(next/server의 after())으로
// 호출한다. 이 함수는 절대 throw하지 않는다(아래 최상위 try/catch) --
// 키워드 알림 계산이 실패해도 게시글 작성 자체는 이미 성공한 뒤이므로,
// 이 실패가 그 응답에 영향을 줘서는 안 된다(embedPostBestEffort 자신의
// "best-effort" 주석과 동일한 원칙).
export type MatchablePost = {
  id: number;
  userId: number;
  title: string;
  description: string;
  campus: string;
  category: string;
};

const POST_TYPE_FILTER: Record<PostType, KeywordAlertPostType[]> = {
  lost: ["ALL", "LOST"],
  found: ["ALL", "FOUND"],
};

// 대소문자 무시 substring 포함 여부 -- posts/service.ts의 keyword 검색이
// 이미 쓰는 것과 같은 "특별한 정규화 없음, 대소문자만 무시" 규칙을
// 재사용한다(그 검색은 Prisma의 `mode: "insensitive"`로 DB에서 하지만,
// 여기서는 이미 메모리에 있는 새 글 하나의 제목/본문 문자열을 대상으로
// 여러 사용자의 키워드를 비교하는 반대 방향이라 DB가 아니라 JS로 한다).
function includesKeyword(haystackLower: string, keyword: string): boolean {
  return haystackLower.includes(keyword.toLowerCase());
}

// 조건 하나하나가 이 phase 스펙 4번의 각 항목과 1:1 대응한다.
function matchesAlert(
  alert: { keyword: string; campuses: string[]; categories: string[]; excludeKeywords: string[] },
  post: MatchablePost,
  haystackLower: string,
): boolean {
  if (!includesKeyword(haystackLower, alert.keyword)) return false;
  if (alert.excludeKeywords.some((ex) => includesKeyword(haystackLower, ex))) return false;
  if (alert.campuses.length > 0 && !alert.campuses.includes(post.campus)) return false;
  if (alert.categories.length > 0 && !alert.categories.includes(post.category)) return false;
  return true;
}

// 하나의 (알림, 게시글) 매치를 실제로 기록 + Notification 생성 -- 둘 다
// 같은 트랜잭션 안에서, KeywordAlertMatch의 unique 제약이 실제 "중복 방지"
// 보증이다(먼저 성공한 쪽만 커밋되고, 이미 매치된 조합은 P2002로
// 트랜잭션 전체가 롤백된다 -- applyReportAction()의 ModerationAction.
// reportId unique 제약과 동일한 패턴).
async function createMatchNotification(
  alert: { id: number; userId: number; keyword: string },
  postType: PostType,
  post: MatchablePost,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const match = await tx.keywordAlertMatch.create({
      data: { keywordAlertId: alert.id, postType, postId: post.id },
    });
    await tx.notification.create({
      data: {
        userId: alert.userId,
        type: NotificationType.KEYWORD_ALERT_MATCH,
        title: "키워드 알림",
        content: `'${alert.keyword}' 키워드 알림과 일치하는 새 글이 등록되었습니다: ${post.title}`,
        relatedType: "keyword_alert_match",
        relatedId: match.id,
      },
    });
  });
}

export async function notifyKeywordAlertSubscribers(postType: PostType, post: MatchablePost): Promise<void> {
  try {
    // 자기 자신이 올린 글에는 알리지 않는다 -- DB 쿼리 자체에서 제외해,
    // 아래 필터 로직이 실수로 빠뜨릴 가능성 자체를 없앤다.
    const alerts = await prisma.keywordAlert.findMany({
      where: { userId: { not: post.userId }, postType: { in: POST_TYPE_FILTER[postType] } },
    });
    if (alerts.length === 0) return;

    const haystackLower = `${post.title}\n${post.description}`.toLowerCase();
    const matched = alerts.filter((alert) => matchesAlert(alert, post, haystackLower));
    if (matched.length === 0) return;

    for (const alert of matched) {
      try {
        await createMatchNotification(alert, postType, post);
      } catch (error) {
        // P2002 = 이 (알림, 게시글) 조합은 이미 처리된 적이 있다(재시도 등
        // 이 함수가 같은 글에 대해 두 번 불렸을 가능성에 대한 방어) --
        // 조용히 건너뛴다, 실패로 보고하지 않는다. 그 외 에러는 로그만
        // 남기고(이 alert 하나의 문제가 나머지 alert들의 처리를 막지
        // 않는다) 계속 진행한다.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
          console.error(
            `Failed to create a keyword alert notification (alert ${alert.id}, ${postType} post ${post.id}):`,
            error,
          );
        }
      }
    }
  } catch (error) {
    console.error(`Failed to evaluate keyword alerts for new ${postType} post ${post.id}:`, error);
  }
}
