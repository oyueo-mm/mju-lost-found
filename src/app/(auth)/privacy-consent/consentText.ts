import { ACTIVITY_RETENTION_DAYS } from "@/lib/retention/policy";

// 이용 통계 on the consent screen (consent version 2026-10-16): the purpose,
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
