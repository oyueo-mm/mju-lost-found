import { ACTIVITY_RETENTION_DAYS } from "@/lib/retention/policy";

// 이용 통계 on the consent screen (consent screen version 2026-10-16 --
// changing this text means a new CURRENT_PRIVACY_VERSION): the purpose,
// the 이용 일자 record and its keeping / deletion at 회원탈퇴, in short --
// the same rules as /policy/privacy §1/§3/§7/§8 (metrics/record.ts,
// auth/withdrawal.ts, retention/policy.ts).
export const ACTIVITY_RECORD_ITEM = {
  label: "이용 일자 기록",
  detail:
    "로그인한 상태로 서비스를 이용한 날짜(하루 한 번). 회원 번호를 비밀 키로 변환한 값과 함께 저장해 이용 통계(활성 회원 수, 가입 후 재방문 등)에만 쓰며, 통계 화면에는 합계만 표시",
};

export const STATISTICS_PURPOSE = "로그인한 상태로 이용한 날짜는 서비스 이용 통계(활성 회원 수 등)를 만드는 데에도 쓰입니다.";

export const ACTIVITY_RECORD_RETENTION = `이용 일자 기록은 이용한 날로부터 ${ACTIVITY_RETENTION_DAYS}일 동안 보관한 뒤 삭제하며, 회원탈퇴 시에는 즉시 삭제합니다(그만큼 지난 기간의 통계 수치도 줄어들 수 있음).`;

// 수집 항목 shown on the consent screen (this version's text).
export const COLLECTED_ITEMS: { label: string; detail: string }[] = [
  { label: "Google 계정 식별 정보", detail: "Google 계정의 고유 식별자(구글 로그인 시 발급)" },
  { label: "이메일 주소", detail: "Google 계정의 이메일 주소(이메일 인증 여부는 로그인 확인에만 쓰고 저장하지 않음)" },
  { label: "닉네임", detail: "직접 설정한 닉네임(다른 이용자에게 공개되는 이름으로, 아래 이름과는 별개)" },
  {
    label: "이름, 소속(학과·단과대학)",
    detail:
      "명지대 Google 계정의 표시 이름이 '이름/신분/소속' 형식이면 이름과 소속을 자동으로 추출해 저장하고, 로그인할 때마다 비교해 갱신(신분은 저장하지 않음). 학교 학적 시스템에서 확인된 정보가 아니며, 소속은 학과가 아닌 단과대학일 수 있음. 자동으로 가져올 수 없는 계정은 게시글 등록·채팅 전에 직접 입력. 본인과 신고·분쟁을 처리하는 관리자(열람 기록)만 볼 수 있음",
  },
  {
    label: "Google 계정 이름",
    detail: "Google 로그인 시 전달받아 위 이름·소속 자동 추출에만 사용(동의 전에는 서버에 저장하지 않음)",
  },
  { label: "게시글 정보", detail: "분실물/습득물 게시글의 제목, 내용, 장소, 날짜, 첨부 이미지" },
  { label: "댓글/답글", detail: "게시글에 작성한 댓글 및 답글 내용" },
  { label: "채팅 메시지", detail: "다른 이용자와 주고받은 채팅 메시지, 채팅으로 전송한 사진" },
  { label: "서비스 이용 기록", detail: "로그인 일시, 게시글 조회 기록, 신고/알림 등 서비스 이용 내역" },
  ACTIVITY_RECORD_ITEM,
  { label: "자동 수집 정보", detail: "해시 처리된 IP(비로그인 AI 검색 이용량 제한), 로그인 세션·언어 설정·조회수 집계용 쿠키" },
];
