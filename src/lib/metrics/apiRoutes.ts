// What each timed API does -- the 비고 column of the API 응답 시간 table and
// the 서버 운영 sheet. Keys are the route names lib/metrics/record.ts
// normalizeRoute() records ("METHOD /path", numeric / uuid segments as
// [id]; /api/posts keeps its ?mode=). Written from each route handler, not
// guessed; a route missing here shows as "설명 없음" until it is added.
export const API_ROUTE_NOTES: Record<string, string> = {
  // 게시글
  "GET /api/posts": "분실물·습득물 게시글 목록·키워드 검색",
  "GET /api/posts?mode=semantic": "자연어(AI) 검색 (게시판 검색창)",
  "POST /api/posts": "게시글 등록 (분실물·습득물, 검색용 임베딩 계산 포함)",
  "POST /api/posts?mode=ai": "AI 검색 (문장·사진으로 찾기)",
  "POST /api/posts?mode=image": "이미지 검색 (예전 방식)",
  "GET /api/posts/[id]": "게시글 상세 조회",
  "PATCH /api/posts/[id]": "게시글 수정 (내용·상태 변경 포함)",
  "PUT /api/posts/[id]": "게시글 사진 임베딩 다시 계산 (내부 호출)",
  "DELETE /api/posts/[id]": "게시글 삭제 (작성자)",
  "POST /api/posts/[id]/image": "게시글 사진 첨부·교체",
  "DELETE /api/posts/[id]/image": "게시글 사진 삭제",
  "PATCH /api/posts/[id]/image": "게시글 사진 순서·대표 사진 변경",
  "GET /api/posts/[id]/comments": "댓글 목록 조회",
  "POST /api/posts/[id]/comments": "댓글 작성",
  "PATCH /api/posts/[id]/comments/[id]": "댓글 수정",
  "DELETE /api/posts/[id]/comments/[id]": "댓글 삭제",
  "POST /api/upload": "게시글 사진 업로드 준비 (서명된 업로드 주소 발급)",
  // 채팅
  "GET /api/chat": "내 채팅방 목록",
  "POST /api/chat": "게시글 작성자와 채팅방 열기 (없으면 생성)",
  "GET /api/chat/[id]": "채팅방 정보 조회",
  "GET /api/chat/[id]/messages": "채팅 메시지 조회 (읽음 처리 포함)",
  "POST /api/chat/[id]/messages": "채팅 메시지 보내기",
  "PATCH /api/chat/[id]/messages": "채팅 메시지 수정·공감 표시",
  "DELETE /api/chat/[id]/messages": "채팅 메시지 삭제",
  "POST /api/chat/[id]/upload": "채팅 사진 업로드 준비 (서명된 업로드 주소 발급)",
  "GET /api/chat/[id]/messages/[id]/image": "채팅 사진 보기 (참여자 확인 후 임시 주소로 연결)",
  // 알림
  "GET /api/notifications": "내 알림 목록",
  "GET /api/notifications/unread-count": "읽지 않은 알림 수 (헤더 알림 배지)",
  "PATCH /api/notifications/[id]": "알림 하나 읽음 처리",
  "DELETE /api/notifications/[id]": "알림 하나 삭제",
  "POST /api/notifications/read-all": "알림 모두 읽음 처리",
  // 신고
  "GET /api/reports": "내가 한 신고 목록",
  "POST /api/reports": "신고 접수",
  "GET /api/reports/[id]": "내 신고 상세",
  // 회원
  "POST /api/me/consent": "개인정보·이용약관 동의 저장",
  "POST /api/me/withdraw": "회원 탈퇴",
  // 관리자
  "GET /api/admin/posts": "관리자: 게시글 목록·검색",
  "DELETE /api/admin/posts/[id]": "관리자: 게시글 삭제",
  "GET /api/admin/reports": "관리자: 신고 목록",
  "GET /api/admin/reports/[id]": "관리자: 신고 상세",
  "POST /api/admin/reports/[id]/process": "관리자: 신고 처리 (기각·조치)",
  "POST /api/admin/reports/[id]/restore": "관리자: 신고로 임시 숨긴 글·댓글 복구",
  "GET /api/admin/users": "관리자: 회원 목록·검색",
  "PATCH /api/admin/users/[id]": "관리자: 회원 권한 변경·이용 정지·해제",
  "PATCH /api/admin/settings": "관리자: 서비스 설정 변경 (Google 테스트 모드)",
  "GET /api/admin/settings": "매일 새벽 자동 정리 작업 (Vercel Cron, 보관 기간 지난 기록 삭제, 토큰이 있으면 배포 이력 동기화)",
  "GET /api/version": "지금 응답한 배포의 ID·환경·커밋 (개발 통계의 Production 버전 확인용, 공개)",
  // 내부 측정 (API 요청이 아님)
  "ai:text-load": "AI 문장 모델 로딩 (서버 인스턴스당 한 번, 콜드 스타트)",
  "ai:text-embed": "AI 문장 임베딩 1건 계산 (검색어·게시글)",
  "ai:image-load": "AI 이미지 모델 로딩 (서버 인스턴스당 한 번, 콜드 스타트)",
  "ai:image-embed": "AI 이미지 임베딩 1건 계산 (사진 검색·게시글 사진)",
  "db:ping": "DB 왕복 시간 (통계를 기록할 때마다 측정)",
};

export function describeRoute(route: string): string {
  return API_ROUTE_NOTES[route] ?? "설명 없음";
}

export function methodOf(route: string): string {
  const m = /^([A-Z]+) /.exec(route);
  return m ? m[1] : "내부";
}
