import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/legal";

export const metadata = { title: "고객센터 · 명지 분실물 센터" };

const GUIDE = [
  "명지대 Google 계정으로 로그인하고 닉네임을 정해요.",
  "물건을 주웠다면 습득물 게시판에서 캠퍼스를 고르고 등록해요.",
  "잃어버렸다면 '분실 신고'로 물건을 등록해요.",
  "AI가 등록된 습득물 중 짝이 맞는 글을 찾아주고, 90% 이상이면 알림을 보내요.",
  "게시글 상세의 'AI 매칭'을 확인하거나, 검색(키워드·AI 의미·사진)으로도 찾아요.",
  "내 물건을 찾으면 '작성자와 채팅'으로 연락해 안전하게 돌려받아요.",
];

const FAQ = [
  {
    q: "명지대(@mju.ac.kr) 계정으로 로그인이 안 돼요.",
    a: "재학생·교직원은 학교에서 발급한 구글 계정(아이디@mju.ac.kr)이 있어요. 로그인 창에서 개인 Gmail이 아니라 이 주소를 골라 주세요. 비밀번호를 모르면 명지대 통합정보시스템(학교 포털)의 '구글 계정/메일' 메뉴에서 설정·초기화할 수 있고, 메뉴가 없으면 정보통신처(전산실)에 학번과 함께 문의하면 활성화해 줘요. 그래도 안 되면 아래 문의하기로 학번과 상황을 남겨 주세요.",
  },
  {
    q: "@gmail.com 으로 로그인이 되던데요?",
    a: "베타 기간 동안 미리 신청한 테스터에 한해 임시로 허용하고 있어요. 정식 오픈 후에는 @mju.ac.kr 계정만 이용할 수 있어요.",
  },
  {
    q: "닉네임을 바꾸고 싶어요.",
    a: "내 정보 > 닉네임 변경에서 바꿀 수 있어요. 30일에 한 번만 변경할 수 있어요.",
  },
  {
    q: "학과가 잘못 표시돼요.",
    a: "학과는 명지대 Google 계정 이름에서 자동으로 가져와요. 오류가 있으면 아래로 문의해 주세요.",
  },
  {
    q: "다른 캠퍼스 글이 안 보여요.",
    a: "인문캠퍼스와 자연캠퍼스는 게시글·장소가 완전히 분리돼 있어요. 게시판 상단 탭에서 캠퍼스를 바꿔보세요.",
  },
  {
    q: "부적절한 게시글·사용자를 발견했어요.",
    a: "게시글 상세에서 '신고'를 눌러주세요. 관리자가 확인 후 조치해요.",
  },
  {
    q: "AI 매칭은 어떻게 되나요?",
    a: "분실 신고를 등록하면 AI가 제목·설명·카테고리·장소·시간을 분석해 등록된 습득물 중 짝이 맞는 글을 찾아줘요. 90% 이상 일치하면 자동으로 알림도 보내요. 게시글 상세의 'AI 매칭'에서 확인할 수 있어요.",
  },
  {
    q: "물건을 되찾았어요.",
    a: "채팅방에서 서로 '거래 완료'를 누르면 마무리돼요. 내 정보 > 내 게시글에서 글 상태도 '찾음'/'완료'로 바꿔주세요.",
  },
];

export default function HelpPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-extrabold">고객센터</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          이용 중 궁금한 점이나 문제가 있으면 확인해 보세요.
        </p>
      </div>

      <section id="guide">
        <h2 className="font-bold">이용안내</h2>
        <ol className="card mt-2 divide-y divide-line-soft p-1">
          {GUIDE.map((g, i) => (
            <li key={i} className="flex gap-3 px-4 py-3 text-sm">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">
                {i + 1}
              </span>
              <span className="text-ink-soft">{g}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="font-bold">자주 묻는 질문</h2>
        <div className="mt-2 space-y-2">
          {FAQ.map((f, i) => (
            <details key={i} className="card p-4">
              <summary className="cursor-pointer font-semibold">{f.q}</summary>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-bold">문의하기</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          위에서 해결되지 않는 문제나 개선 아이디어는 <b>1:1 문의</b>로
          보내주세요. 답변은 알림으로 와요. 게시글·메시지 문제는 신고 기능도
          있어요.
        </p>
        <Link
          href="/my/inquiries"
          className="btn btn-primary mt-3 px-4 py-2 text-sm"
        >
          1:1 문의하기
        </Link>
        {SUPPORT_EMAIL && (
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
              "[명지 분실물 센터] 문의",
            )}`}
            className="mt-2 block text-xs text-ink-faint underline sm:ml-3 sm:mt-0 sm:inline"
          >
            로그인이 안 될 땐 {SUPPORT_EMAIL} 로 메일
          </a>
        )}
      </section>
    </div>
  );
}
