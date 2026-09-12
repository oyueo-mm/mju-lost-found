import {
  CURRENT_TERMS_VERSION,
  PRIVACY_OFFICER,
  SUPPORT_EMAIL,
} from "@/lib/legal";

export const metadata = { title: "개인정보 처리방침 · 명지 분실물 센터" };

const CONTACT = SUPPORT_EMAIL || "서비스 내 문의하기";

export default function PrivacyPage() {
  return (
    <article className="space-y-6">
      <header>
        <h1 className="text-xl font-extrabold">개인정보 처리방침</h1>
        <p className="num mt-1.5 text-sm text-ink-faint">
          시행일 2026년 9월 8일 · v{CURRENT_TERMS_VERSION}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          명지 스마트 분실물 센터(이하 “서비스”)를 운영하는 학생 프로젝트팀(이하
          “운영팀”)은 「개인정보 보호법」 및 「정보통신망 이용촉진 및 정보보호
          등에 관한 법률」 등 관련 법령을 준수합니다. 이 서비스는 명지대학교
          재학생·교직원의 편의를 위해 학생이 자발적으로 만든 비영리 프로젝트이며,
          명지대학교의 공식 서비스가 아닙니다.
        </p>
      </header>

      <section className="card p-5">
        <h2 className="font-bold">제1조 (개인정보의 처리 목적)</h2>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-soft">
          <li>이용자 식별·인증: Google 계정 인증 로그인, 명지대 구성원 확인, 중복·부정 가입 방지</li>
          <li>서비스 제공: 분실물·습득물 게시, 카테고리·캠퍼스 분류, AI 기반 유사 게시물 매칭, 사진·문장 검색</li>
          <li>이용자 간 연락 중개: 1:1 채팅 연결, 거래 완료 확인, 명지도 산정</li>
          <li>안전 및 분쟁 대응: 신고 접수·처리, 부정 이용 제한, 계정 정지 및 이의 제기 처리</li>
          <li>공지: 서비스 운영·정책 변경 등 필수 안내</li>
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">제2조 (처리하는 개인정보 항목 및 수집 방법)</h2>
        <p className="mt-2 text-sm font-semibold">1. 회원가입·이용 과정에서 수집</p>
        <ul className="mt-1 space-y-1.5 text-sm leading-relaxed text-ink-soft">
          <li>Google 계정 인증 정보: 이메일 주소, 이름(프로필 표시 이름) — 필수</li>
          <li>Google 계정 이름에서 자동 추출: 학과·소속(재학생/교직원 구분) — 필수</li>
          <li>이용자 입력: 닉네임(공개, 필수), 학번(본인만 열람, 선택)</li>
          <li>서비스 이용 중 생성: 게시글·사진·댓글·채팅 메시지, 조회 기록, 명지도, 신고·정지 이력</li>
        </ul>
        <p className="mt-2 text-xs text-ink-faint">
          서비스는 이름·이메일 외 Google 계정의 다른 정보(연락처, 캘린더 등)에
          접근하지 않습니다.
        </p>
        <p className="mt-3 text-sm font-semibold">2. 자동 생성·수집 정보</p>
        <ul className="mt-1 space-y-1.5 text-sm leading-relaxed text-ink-soft">
          <li>서비스 이용 기록, 접속 일시, 기기·브라우저 종류</li>
          <li>
            접속 IP 주소는 서비스 데이터베이스에 저장하지 않으며, 서비스가
            이용하는 호스팅·인프라 사업자의 보안·운영 로그에 단기간 남을 수
            있습니다.
          </li>
          <li>
            쿠키·로컬스토리지: 로그인 세션 유지, 테마(다크 모드 등) 설정 저장
            목적으로만 사용
          </li>
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">제3조 (개인정보의 처리 및 보유 기간)</h2>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-soft">
          <li>계정 정보(이메일·이름·닉네임·학과·학번): 회원 탈퇴 시까지, 탈퇴 요청 시 지체 없이 파기</li>
          <li>게시글·사진·댓글: 이용자가 삭제하거나 탈퇴 시까지(직접 삭제 가능)</li>
          <li>채팅 메시지: 채팅방 삭제 또는 탈퇴 시까지. 상대방이 있는 대화는 상대방 탈퇴 전까지 상대방 화면에 남을 수 있음</li>
          <li>신고·정지 이력: 분쟁 대응 및 재발 방지를 위해 처리 완료 후 1년 보관 후 파기</li>
          <li>영구 정지 계정의 최소 식별정보(정지 사유·일시): 재가입·회피 방지를 위해 보관</li>
          <li>서비스 종료 시: 모든 개인정보를 지체 없이 파기</li>
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">제4조 (개인정보의 제3자 제공)</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          운영팀은 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 이용자가
          사전에 동의한 경우, 또는 법령에 근거하여 수사기관 등이 적법한 절차에
          따라 요청하는 경우는 예외로 합니다.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">제5조 (개인정보 처리의 위탁)</h2>
        <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>
            <b className="text-ink">Supabase, Inc.</b> — 데이터베이스, 계정 인증,
            파일(사진) 저장 / 처리 위치: 대한민국(서울 리전)
          </li>
          <li>
            <b className="text-ink">Vercel, Inc.</b> — 웹 애플리케이션
            호스팅·전송 / 처리 위치: 대한민국(서울 리전) 및 미국
          </li>
          <li>
            <b className="text-ink">Cloudflare, Inc.</b> — AI 처리(게시글
            텍스트·업로드 이미지의 특징 벡터 생성, 이미지 내용 설명) / 처리 위치:
            미국 등 Cloudflare 글로벌 인프라
          </li>
        </ul>
        <p className="mt-2 text-xs text-ink-faint">
          Cloudflare AI 처리 시 게시글 텍스트 및 업로드한 사진이 특징 분석을 위해
          전송되며, 전송된 데이터는 해당 요청 처리에만 사용되고 학습에 이용되지
          않습니다.
        </p>
      </section>

      <section id="overseas" className="card p-5">
        <h2 className="font-bold">제6조 (개인정보의 국외 이전)</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          제5조의 위탁에 따라 아래와 같이 개인정보가 국외로 이전될 수 있습니다.
        </p>
        <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>
            <b className="text-ink">Vercel, Inc. (미국)</b> — 이전 항목: 서비스
            이용 과정에서 처리되는 정보 / 시점·방법: 서비스 이용 시 네트워크
            전송 / 목적·보유: 호스팅 제공, 위탁계약 종료 시까지
          </li>
          <li>
            <b className="text-ink">Cloudflare, Inc. (미국 등)</b> — 이전 항목:
            게시글 텍스트, 업로드 이미지 / 시점·방법: AI 처리 요청 시 네트워크
            전송 / 목적·보유: AI 처리 제공, 요청 처리 후 즉시
          </li>
        </ul>
        <p className="mt-2 text-xs text-ink-faint">
          이용자는 국외 이전을 거부할 수 있으나, 이 경우 회원가입 및 서비스의
          핵심 기능(AI 매칭·이미지 검색 등) 이용이 제한될 수 있습니다.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">제7조 (개인정보의 파기)</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          보유 기간이 경과하거나 처리 목적이 달성된 개인정보는 지체 없이
          파기합니다. 전자적 파일은 복구가 불가능한 방법으로 영구 삭제하며,
          출력물은 분쇄 또는 소각합니다.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">제8조 (정보주체의 권리와 행사 방법)</h2>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-soft">
          <li>이용자는 개인정보 열람·정정·삭제·처리정지 요구, 동의 철회 및 탈퇴를 요청할 수 있습니다.</li>
          <li>게시글·사진·댓글·채팅방은 서비스 내에서 직접 열람·수정·삭제할 수 있습니다.</li>
          <li>그 밖의 권리 행사는 {CONTACT} 로 요청할 수 있으며, 운영팀은 본인 확인 후 지체 없이 조치합니다.</li>
          <li>만 14세 미만 아동의 개인정보는 수집하지 않습니다.</li>
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">제9조 (개인정보의 안전성 확보 조치)</h2>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-soft">
          <li>관리자 기능은 지정된 인원만 접근</li>
          <li>데이터베이스 행 단위 접근 제어(RLS)로 이용자는 자신의 정보와 공개 정보만 조회 가능</li>
          <li>인증 정보·비밀 키는 코드에 포함하지 않고 별도 환경변수로 분리 관리</li>
          <li>전송 구간 암호화(HTTPS)</li>
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">제10조 (쿠키 등 자동 수집 장치)</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          서비스는 로그인 세션 유지 및 화면 설정 저장을 위해 쿠키와 브라우저
          로컬스토리지를 사용합니다. 브라우저 설정에서 쿠키 저장을 거부할 수
          있으나 이 경우 로그인이 유지되지 않습니다. 서비스는 광고·행태정보 수집
          목적의 쿠키를 사용하지 않습니다.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">제11조 (개인정보 보호책임자)</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          개인정보 보호책임자: {PRIVACY_OFFICER}
          <br />
          연락처: {CONTACT}
        </p>
        <p className="mt-2 text-xs text-ink-faint">
          개인정보 관련 문의·불만·피해 구제는 위 연락처로 문의할 수 있으며,
          운영팀은 지체 없이 답변·처리합니다.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">제12조 (권익침해 구제 방법)</h2>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-soft">
          <li>개인정보 분쟁조정위원회: 1833-6972 / www.kopico.go.kr</li>
          <li>개인정보 침해신고센터(KISA): (국번없이) 118 / privacy.kisa.or.kr</li>
          <li>대검찰청 사이버수사과: (국번없이) 1301 / www.spo.go.kr</li>
          <li>경찰청 사이버범죄 신고시스템: (국번없이) 182 / ecrm.police.go.kr</li>
        </ul>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">제13조 (개인정보 처리방침의 변경)</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          이 처리방침은 법령·서비스 변경에 따라 개정될 수 있으며, 개정 시 시행일
          및 변경 내용을 서비스 내 공지 또는 알림으로 최소 7일 전(중대한 변경은
          30일 전)에 고지합니다.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">부칙</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          이 개인정보 처리방침은 2026년 9월 8일부터 시행합니다. (최초 제정)
        </p>
      </section>
    </article>
  );
}
