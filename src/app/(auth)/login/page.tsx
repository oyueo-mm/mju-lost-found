export default function LoginPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 bg-zinc-50 px-6 dark:bg-black">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          명지 스마트 분실물 센터
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          @mju.ac.kr 계정으로 로그인하세요.
        </p>
      </div>

      <button
        type="button"
        disabled
        className="flex items-center gap-2 rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300"
      >
        Google로 로그인 (준비 중)
      </button>

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        아직 실제 로그인 기능은 연결되어 있지 않습니다.
      </p>
    </div>
  );
}
