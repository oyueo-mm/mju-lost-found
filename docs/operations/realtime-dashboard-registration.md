# Preview 서명키 대시보드 등록 절차

대상은 **Preview 프로젝트 `swqvlihgupranzfzjevb`만**이다. 새 키를 standby로 가져오는 작업만 승인돼 있다. 기존 키의 Rotate/Activate/Revoke/Delete, Production 변경, Data API 활성화는 하지 않는다.

## 준비한 로컬 도구

`scripts/operations/preview-realtime-manual-key.ps1`은 ES256/P-256 키를 Windows CurrentUser DPAPI로 암호화해 `.vercel/realtime-preview-manual.dpapi`에 보관한다. Git/배포 제외 경로이며 평문 파일·터미널·로그·채팅으로 private JWK를 내보내지 않는다. 같은 파일이 있으면 기존 키를 다시 사용하며 덮어쓰지 않는다.

이번에 준비한 **공개 kid**: `c0eb51e4-97b9-4d13-b042-1a820650d257`. 로컬 암호화 복호화와 private/public 서명 쌍을 검증했다. 이 kid는 비밀값이 아니다. 클라우드 등록은 아직 하지 않았다.

## 사용자가 수행할 단계

1. [Preview JWT Signing Keys](https://supabase.com/dashboard/project/swqvlihgupranzfzjevb/settings/jwt)를 연다. 주소의 project ref가 위 Preview ID인지 먼저 확인한다. 현재 Studio 소스의 메뉴 경로는 **Project Settings(톱니바퀴) → JWT Keys → JWT Signing Keys 탭**이다. API Keys의 anon/service_role 값, Legacy JWT Secret 탭이나 Storage URL signing keys를 선택하지 않는다.
2. **Create standby key**를 선택하고 알고리즘을 **ES256 (ECC)**로 설정한다. **Import an existing private key**를 체크한다. Supabase가 키를 새로 자동 생성하는 기본 모드로 저장하지 않는다. 자동 생성 키의 private 부분은 나중에 추출할 수 없어 앱의 외부 JWT 서명에 사용할 수 없다.
3. Windows PowerShell에서 다음 명령을 실행한다. 터미널에는 공개 kid와 상태만 나오고 private JWK는 클립보드로만 전달된다.

   ```powershell
   cd C:\proj_claude\mju-lost-found-vercel
   powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File scripts/operations/preview-realtime-manual-key.ps1 -Action Copy -ConfirmPreview
   ```

4. 터미널을 열어 둔 채 120초 안에 대시보드의 JWK 입력란에 붙여넣고 **Create standby key**로 저장한다. 키는 **Standby 상태**에 둔다. **Rotate key는 누르지 않는다.** Windows clipboard history/cloud sync 제외 형식을 함께 설정하고, 터미널이 실행 중이면 120초 후 같은 키가 남아 있을 때만 지운다. 터미널을 강제 종료하면 자동 삭제를 보장할 수 없다. 필요한 경우 같은 Copy 명령으로 **동일한 키**를 다시 복사한다.
5. 공개 kid가 `c0eb51e4-97b9-4d13-b042-1a820650d257`인지, 기존 활성 키가 그대로인지 확인한다. 완료 후 **“Preview standby 가져오기 완료”**라고 알려주면 된다. private JWK, `d` 값, 토큰, 인증 정보는 전달하지 않는다.

기존 standby 때문에 버튼이 없거나, 저장 전에 기존 키의 이동/삭제/회전 또는 **Migrate JWT secret**을 요구하면 그대로 중단하고 표시된 상태만 알려준다. 승인 범위를 넓혀 우회하지 않는다. 화면 문구가 다르면 키 입력란이 없는 화면에서 임의의 다른 비밀 필드에 붙여넣지 않는다.

## 이후 자동 작업

사용자는 Vercel에 같은 키를 또 붙여넣을 필요가 없다. 기존 승인 범위에서 로컬 암호화 키와 공개 JWKS의 kid/x/y 일치를 확인하고, Vercel **Preview만** `MJU_REALTIME_PRIVATE_JWK` 민감 변수로 등록한다. Production 체크박스는 사용하지 않는다. 실제 등록 전 기존 동명 변수를 조회해 중복/덮어쓰기를 방지한다.

그다음 Preview 재배포와 실제 일반 회원의 private 토큰·역할·채팅 권한·만료/회수·16단계 회귀 검증을 계속한다. JWKS에 키가 보이는 것만으로 Realtime 수용이 검증됐다고 판단하지 않는다. standby 키를 쓰려면 활성 키 회전이 실제로 필요한 경우 별도 승인 대상으로 남기며, 이번 절차에서 Rotate를 지시하지 않는다.

공개 키 게시 확인만 직접 수행하려면 다음 명령을 쓸 수 있다. 키 원문은 출력하지 않으며 아직 게시되지 않았으면 종료 코드 2다. 캐시 때문에 즉시 보이지 않을 수 있다.

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File scripts/operations/preview-realtime-manual-key.ps1 -Action Verify -ConfirmPreview
```

이 확인으로 실제 standby/in_use 상태를 알 수는 없다. 상태는 대시보드에서 별도로 확인한다. 키를 다시 생성해 재시도하지 않는다.

Standby 상태의 키가 실제 Realtime에서 수용되지 않으면 기존 활성 키는 그대로 보존하고 인증된 API polling을 유지한다. 활성화·회전, 기존 키 이동·폐기, 예약 역할 권한 확대나 공개 채널 재활성화로 우회하지 않는다. 별도 신뢰 제공자 방식 등 대안의 변경 범위와 검증 결과를 먼저 정리하며, 인증 신뢰 설정 변경은 따로 승인되기 전까지 실행하지 않는다.

근거: [Supabase 서명키·외부 키 가져오기 문서](https://supabase.com/docs/guides/auth/signing-keys), [현재 대시보드의 생성/Import 구현](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/JwtSecrets/jwt-secret-keys-table/create-key-dialog.tsx), [Microsoft clipboard 제외 형식](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-formats#cloud-clipboard-and-clipboard-history-formats).
