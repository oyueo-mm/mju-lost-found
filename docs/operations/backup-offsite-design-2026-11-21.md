# PC에 의존하지 않는 장기 백업 구조 (설계만, 2026-11-21)

> 상태: **설계안. 아무것도 만들거나 바꾸지 않았다.** 아래 "승인 필요" 항목은 각각 별도 승인 대상이다.

## 1. 왜 필요한가
- 지금 자동 백업은 개인 PC 한 대의 작업 스케줄러에서만 돈다(`MJU Find daily backup`, `ops/backup` worktree).
- 2026-11-21에 WakeToRun을 켜서 **절전** 중 누락은 줄였다. 하지만 아래 경우는 여전히 백업이 없다.
  - PC가 꺼짐, 최대 절전, 배터리 상태(이 PC는 배터리에서 절전 해제 타이머가 꺼져 있음)
  - 로그오프(작업이 "로그온한 경우에만" 실행), 장기간 미사용
- 암호화 백업 파일도 같은 PC 한 곳에만 있다. 디스크 손상·분실이 곧 백업 상실이다(3-2-1 원칙 미충족).

## 2. 목표
1. PC가 꺼져 있어도 매일 1회 Production DB + Storage 백업
2. 생성 직후 **자동 복원 검증**(현재 WSL 복원 검사와 같은 수준: 테이블·행 수·이미지 참조)
3. PC와 다른 장소에 암호화 보관. 운영자 PC의 기존 백업은 두 번째 사본으로 유지
4. 실패하면 알림. 사람 개입 없이 다음 날 다시 시도
5. 새 유료 서비스 없이 시작할 수 있을 것

## 3. 권장 구조: GitHub Actions 예약 작업 + 비공개 보관소

```
GitHub Actions (cron, 매일 19:00 UTC = 04:00 KST)
  ├─ pg_dump (PG 17 클라이언트, 읽기 전용 전용 계정, BEGIN READ ONLY 스냅샷)
  ├─ Storage 3개 버킷 내려받기 (service key, 목록·크기 대조)
  ├─ tar → age 암호화 (공개키만 CI에 존재)
  ├─ 복원 검증: 같은 job 안의 postgres+pgvector 서비스 컨테이너에 복원 → 행 수·참조 대조
  ├─ 업로드: 비공개 보관소 (아래 4절 선택지)
  └─ 실패 시: GitHub 실패 메일 + 다음 실행 자동 재시도
운영자 PC (현행 유지): 매일 04:00 로컬 백업 + watchdog이 원격 최신본 날짜도 확인(추가)
```

- 저장소가 **공개**이므로 지켜야 할 점
  - 백업 산출물을 Actions artifact로 남기지 않는다. 공개 저장소의 artifact는 로그인한 누구나 받을 수 있다.
  - 로그에 행 데이터·경로·키를 출력하지 않는다. 지금 스크립트도 집계만 출력한다.
  - 워크플로는 `schedule`과 `workflow_dispatch`만 사용한다. fork PR에서는 secret이 전달되지 않고 예약 작업도 돌지 않는다.
  - 사용하는 action은 커밋 SHA로 고정한다. `environment` 보호 규칙으로 secret 접근 브랜치를 `vercel`(또는 `ops/backup`)로 제한한다.
- 복원 검증은 기존 `scripts/backup/verify-restore.mjs`와 `wsl-restore-check.sh`의 SQL을 그대로 재사용한다(Ubuntu runner, `pgvector/pgvector:pg17` 서비스 컨테이너).
- 암호화는 **age 공개키 방식**으로 한다. CI는 공개키만 갖고, 복호화 개인키는 운영자 오프라인 보관(비밀번호 관리자 + 종이)이다. CI가 탈취돼도 과거 백업은 해독할 수 없다. 현재 PC 백업의 패스프레이즈 방식과 분리된 키다.

## 4. 보관 장소 선택지

| 선택지 | 비용 | 장점 | 단점 |
|---|---|---|---|
| A. 별도 **비공개** GitHub 저장소의 Release 자산 | 무료(파일당 2GB, 현재 약 25MB/일) | 새 서비스 없음. 같은 계정에서 권한 관리 | 삭제 방지(불변성) 없음. 저장소 관리자 계정이 단일 위험점 |
| B. Cloudflare R2 | 무료 10GB, 송신 무료 | S3 호환. 수명 주기 규칙으로 보존 자동화 | 새 서비스 가입(무료지만 결제 수단 등록 필요) |
| C. Backblaze B2 | 무료 10GB | **Object Lock**(기간 내 삭제 불가)으로 랜섬웨어·실수 삭제 방어 | 새 서비스 가입 |
| D. Supabase Pro 일일 백업/PITR | 월 $25 이상 | 관리형, 즉시 복원 | 유료. 다운로드형 장기 보관은 별도. Storage 파일은 별도 백업 |

- 1차 권장: **A로 시작**(무료, 새 서비스 없음)한다. 삭제 방지가 필요해지면 C로 옮긴다.
- 보존 정책: 기존 GFS(일 7 / 주 4 / 월 3)를 원격에도 같이 적용한다. 약 14개 × 25MB ≈ 350MB다.

## 5. 필요한 권한과 승인 항목 (모두 미승인)
1. **Production DB 전용 읽기 계정 생성**(`backup_reader`: public SELECT, 시퀀스 USAGE, 쓰기 없음) — Production DB 권한 변경.
   - 대안: 기존 postgres 자격증명을 secret에 넣는다. 비권장(권한 과다).
2. **GitHub Actions secret 등록**: DB URL(읽기 계정), Supabase service key(Storage 읽기용), age 공개키, 보관소 토큰 — 자격증명 배포 범위 변경.
   - Storage만 읽는 제한 키가 없으므로, service key 대신 버킷 읽기 전용 정책을 둘지 검토한다.
3. 보관소 선택(A/B/C)과 비공개 저장소 생성
4. 복원 검증 실패 시 알림 수신처(GitHub 메일 기본)

## 6. 단계별 도입 (승인 후)
1. 비공개 보관소 준비, age 키 쌍 생성(개인키 오프라인)
2. 워크플로를 **Preview DB**로 먼저 실행: 덤프 → 암호화 → 복원 검증 → 업로드 → 보존 정리 → 실패 알림 확인
3. Production 읽기 계정 생성(별도 승인), secret 교체, `workflow_dispatch`로 1회 실행. 운영자 PC에서 복호화·복원으로 교차 검증
4. 예약 실행 1주 관찰. PC watchdog에 "원격 최신본 26시간 이내" 검사 추가
5. 운영 문서에 복구 절차(원격본 → 복호화 → 복원) 추가 후 복구 훈련 1회

## 7. 이번에 바꾼 것 (PC 쪽, 참고)
- `MJU Find daily backup`에 WakeToRun을 켰다(AC 전원일 때만 효과). watchdog 기준을 36→26시간으로 바꿨다. 실행할 때마다 시작 기록(부모 프로세스)을 남긴다. 커밋 `6274b3a`(`fix/backup-wake` → `ops/backup` fast-forward).
- 작업 스케줄러 운영 로그 활성화는 관리자 권한이 필요하다. 사용자가 관리자 PowerShell에서 실행한다: `wevtutil sl Microsoft-Windows-TaskScheduler/Operational /e:true`
