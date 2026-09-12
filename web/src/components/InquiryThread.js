import { formatDateTime } from "@/lib/format";

// messages: [{ id, staff, body, created_at }]
export default function InquiryThread({ messages, meRight = true }) {
  if (!messages || messages.length === 0) return null;
  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const right = meRight ? !m.staff : m.staff;
        return (
          <div
            key={m.id}
            className={`flex flex-col ${right ? "items-end" : "items-start"}`}
          >
            <span className="px-1 text-[11px] font-semibold text-ink-faint">
              {m.staff ? "운영팀" : meRight ? "나" : "이용자"}
            </span>
            <div
              className={`mt-1 max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                right
                  ? "rounded-br-sm bg-brand text-white"
                  : "rounded-bl-sm border border-line bg-surface text-ink"
              }`}
            >
              {m.body}
            </div>
            <span className="num mt-1 px-1 text-[11px] text-ink-faint">
              {formatDateTime(m.created_at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
