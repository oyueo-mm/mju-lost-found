# 선택 UI 통합 및 로컬 검증

기존 22개 파일의 단일 선택창 39개를 `src/components/ui/Select.tsx`로 통합했다. 기존 공통 Select, Radix Select, React Aria Select는 없었다. 여러 화면의 드롭다운 메뉴, 날짜 선택기, 라디오·체크박스, 자동완성은 일반 select와 구분해 유지했다. 기존 Scrollspy 및 사진 없는 게시글 목록 B안도 유지한다.

## 구현 및 호환성

- 실제 HTML `select`, `option`, `optgroup`을 유지한다. 별도 hidden input이나 커스텀 ARIA combobox를 만들지 않는다.
- `SelectProps`는 `ComponentPropsWithRef<"select">`를 확장한다. 기존 `value/defaultValue`, `onChange`, `name/form`, `required/disabled`, `ref`, ARIA 속성, 서버 폼 제출 및 브라우저 유효성 검사가 그대로 동작한다.
- Placeholder는 기존처럼 `<option value="">`로 전달한다. 그룹은 `optgroup`으로 전달하며 label/disabled도 그대로 적용된다.
- `error`는 `aria-invalid`로 전달된다. 설명·오류 메시지는 기존 label 및 `aria-describedby`로 연결한다.
- `native`는 특정 선택창의 플랫폼 팝업을 유지하는 옵션이다. 현재 운영 화면에서 별도로 강제할 필요는 없었다.
- 지원되는 정밀 포인터·hover 환경에서만 CSS `appearance: base-select`와 `::picker(select)`를 적용한다. 키보드 탐색·타이핑 탐색·포커스·선택·외부 클릭 닫기는 브라우저가 담당한다. 팝업은 top layer에 표시되며 브라우저 anchor positioning을 유지하고 여유 공간에 따라 위쪽 배치를 선택한다.
- 터치 환경, 기능 미지원 브라우저, 강제 색상 모드, 다중 선택/목록 상자는 플랫폼 UI를 유지한다. 실제 운영 select에는 다중 선택/검색형 select가 없지만 네이티브 props 계약은 지원한다.
- 의존성·데이터 모델·옵션 값·번역 사전·이벤트 핸들러·쿼리 생성 코드는 변경하지 않았다.

참고: [Chrome 공식 가이드](https://developer.chrome.com/docs/modern-web-guidance/guides/forms/branded-select-styling), [MDN 호환성과 점진적 적용](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Customizable_select).

## 변경 전후

닫힌 선택창은 공통 배경·테두리·둥근 모서리·높이·화살표·포커스·Disabled/Error 상태를 사용한다. 기존 필터 적용 상태의 파란 강조는 유지한다. 긴 선택 문구는 컨트롤 안에서 잘리며 페이지를 늘리지 않는다.

지원 환경의 열린 목록은 공통 글꼴, 충분한 항목 높이, 연한 테두리, 선택 항목의 파란 배경과 체크, hover/키보드 포커스를 사용한다. 최대 높이는 20rem 또는 뷰포트 높이의 절반이며 내부 스크롤을 제공한다. 과도한 그림자나 팝업 애니메이션은 추가하지 않았다. 테두리 전환만 120ms로 적용하고 reduced-motion에서는 제거한다.

## 적용 파일

| 화면 | 파일 | 선택창 수 |
| --- | --- | ---: |
| 게시판·검색 필터·정렬 | `src/components/search/SearchFilterBar.tsx` | 5 |
| 카테고리 필터 | `src/components/search/CategoryFilterSelects.tsx` | 2 |
| 기간 필터의 선택 부분 | `src/components/search/EventPeriodFilter.tsx` | 1 |
| 작성·수정 폼의 대분류·소분류 | `src/components/post/CategoryPicker.tsx` | 2 |
| 게시글 관리 처리·기관 | `src/components/post/PostManagement.tsx` | 2 |
| 작성 명의 | `src/components/organization/PostAsSelector.tsx` | 1 |
| 단체 대표 이전 | `src/components/organization/OrganizationLeadershipTransfer.tsx` | 1 |
| 신고 사유 | `src/components/report/ReportButton.tsx` | 1 |
| 물품 조회 | `src/app/(main)/items/page.tsx` | 2 |
| 관리자 게시글 필터 | `src/app/(main)/admin/posts/page.tsx` | 1 |
| 관리자 활동 필터 | `src/components/admin/AdminActivityView.tsx` | 3 |
| 관리자 권한 필터 | `src/components/admin/AdminRoleFilters.tsx` | 4 |
| 관리자 권한 편집의 기관 | `src/components/admin/AdminPermissionEditor.tsx` | 1 |
| API 통계 필터·정렬 | `src/components/admin/ApiStatsTable.tsx` | 2 |
| 외부 접근 등록 | `src/components/admin/ExternalAccessForm.tsx` | 1 |
| 외부 접근 편집 | `src/components/admin/ExternalAccessRow.tsx` | 1 |
| 시간대 통계 지표 | `src/components/admin/HourlyMetricSelect.tsx` | 1 |
| 관리 기관 등록 | `src/components/admin/InstitutionRegisterForm.tsx` | 2 |
| 신고 처리 | `src/components/admin/ReportProcessForm.tsx` | 3 |
| CSV 데이터 선택 | `src/components/admin/StatsExportPanel.tsx` | 1 |
| 사용자 제재 기간 | `src/components/admin/UserActionButtons.tsx` | 1 |
| 홍보 링크 대상 | `src/components/admin/UtmLinkBuilder.tsx` | 1 |

공통 파일: `src/components/ui/Select.tsx`, `select.css`, `Select.test.tsx`. 스타일 진입점은 `src/app/globals.css`의 CSS import다. 시간대 통계의 별도 화살표만 제거해 중복 표시를 방지했다.

검증 도구 파일: `scripts/preview-select.mjs`, `scripts/fixtures/SelectPreview.tsx`, `scripts/fixtures/selectNavigation.ts`. 이 보고서는 `docs/SELECT_UI.md`다. 위 목록은 이번 선택 UI 변경 범위이며, 기존 목록 B안의 작업 트리 변경은 별도로 보존했다.

언어 전환은 기존 `LocaleSwitcher`, 날짜·달력은 기존 기간/일자 선택기, 보관 장소 등 복합 입력은 기존 UI를 유지한다.

## 로컬 미리보기

```powershell
npm run build
node scripts/preview-select.mjs
```

접속: <http://127.0.0.1:4199/?mode=keyword&q=wallet&period=1w>

실제 Select, CategoryPicker, SearchFilterBar, AdminRoleFilters, HourlyMetricSelect를 샘플 데이터로 표시한다. Korean/English 전환, required/disabled/error, 그룹·긴 이름·100개 옵션·native opt-out·다중 선택을 확인할 수 있다. 버튼의 제출은 값만 화면에 출력한다.

서버는 loopback에만 바인딩하며 환경 파일·DB를 읽지 않고 API 및 GET 외 요청을 거부한다. `scripts/fixtures/selectNavigation.ts`는 미리보기 번들에서만 사용하는 로컬 Next navigation 어댑터다. 제품 코드의 라우터는 교체하지 않는다. 종료는 Ctrl+C다.

## 검증 범위

로컬 결과: 전체 224개 테스트 파일·2,641개 테스트 통과, 최종 프로덕션 빌드 및 TypeScript 타입 검사 통과, 변경한 TypeScript/TSX/MJS 파일의 ESLint와 diff 공백 검사 통과. 아래 브라우저 항목은 실제 컴포넌트와 최종 빌드 CSS를 사용하는 headless Edge에서 통과했으며 콘솔 예외는 없었다.

- 단위 테스트: 실제 select/option/group/placeholder/선택값/disabled/required/ARIA/멀티 선택 마크업과 기존 전체 회귀 테스트.
- 브라우저: 실제 컴포넌트의 controlled 변경, 종속 소분류 초기화, native required, FormData, disabled 제외, 초기화와 ref 포커스, 검색어·기간을 유지하는 정렬/필터/시간대 지표 변경, 관리자 필터의 hidden 필드와 숫자 ID 문자열, 한국어/영어 옵션 번역.
- 접근성: Enter/Space/방향키/Escape, 비활성 옵션·그룹 건너뛰기, 포커스 복원, 외부 클릭, 여러 선택창 전환, 브라우저 접근성 트리의 이름/combobox/invalid/설명 연결.
- 화면 폭: 320, 390, 768, 1024, 1440px. 긴 문구, 옵션 목록 폭과 스크롤, 화면 아래에서 위로 열리는 배치 및 reduced-motion·터치 fallback을 확인한다.

로컬 미리보기에서의 라우팅·제출 검사는 실제 DB 검색 결과나 저장 성공의 검증이 아니다. 실데이터 등록·수정·관리 작업, 실제 iOS/Android 및 Safari/Firefox, NVDA/VoiceOver의 음성 출력은 별도 실기기·인증 환경에서 확인해야 한다. 배포·push·마이그레이션·환경 변수 변경·Production 테스트 쓰기는 수행하지 않는다.
