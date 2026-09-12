"use client";

export default function Error({ reset }) {
  return (
    <div className="card-dashed mx-auto max-w-sm p-8 text-center">
      <p className="font-bold">잠시 문제가 생겼어요</p>
      <p className="mt-1.5 text-sm text-ink-soft">
        네트워크 상태를 확인하고 다시 시도해 주세요.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="btn btn-primary mt-4 px-4 py-2 text-sm"
      >
        다시 시도
      </button>
    </div>
  );
}
