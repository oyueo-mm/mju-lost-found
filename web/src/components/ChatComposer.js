"use client";

import { useRef, useState } from "react";
import { sendMessage } from "@/lib/chat-actions";
import { resizeImage } from "@/lib/image-client";
import Icon from "./Icon";

const MAX_BYTES = 5 * 1024 * 1024;

export default function ChatComposer({ roomId, onSent, onOptimistic }) {
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(0);
  const [image, setImage] = useState(null); // { file, preview }
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const composingRef = useRef(false);

  async function pickImage(picked) {
    if (!picked) return;
    // 채팅 사진은 1280px 이면 충분 — 전송·수신 둘 다 가벼워짐
    const file = await resizeImage(picked, { maxEdge: 1280, quality: 0.82 });
    if (file.size > MAX_BYTES) {
      setError("이미지는 5MB 이하만 보낼 수 있어요.");
      return;
    }
    setError(null);
    setImage({ file, preview: URL.createObjectURL(file) });
  }

  function clearImage() {
    if (image?.preview) URL.revokeObjectURL(image.preview);
    setImage(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function send() {
    // 상태보다 DOM 값을 우선 (빠른 타이핑 시 1프레임 지연 방지)
    const raw = inputRef.current?.value ?? text;
    const content = raw.trim();
    const img = image;
    if (!content && !img) return;

    setError(null);
    setText("");
    if (inputRef.current) {
      inputRef.current.value = "";
      // 모바일에서 전송 후 키보드가 내려가지 않도록 포커스 유지
      inputRef.current.focus();
    }
    setImage(null);
    if (fileRef.current) fileRef.current.value = "";
    setBusy((n) => n + 1);

    // 보내는 즉시 화면에 표시
    const tempId = onOptimistic?.(content, img?.preview);

    try {
      const fd = new FormData();
      fd.set("content", content);
      if (img) fd.set("image", img.file);
      const r = await sendMessage(roomId, null, fd);
      if (r?.error) {
        setError(r.error);
        onSent?.(tempId, null); // 낙관적 메시지 제거
        if (content) {
          setText((t) => (t ? t : content));
          if (inputRef.current && !inputRef.current.value) {
            inputRef.current.value = content;
          }
        }
        if (img) setImage(img);
      } else {
        if (img?.preview) URL.revokeObjectURL(img.preview);
        onSent?.(tempId, r.message);
      }
    } catch {
      setError("전송에 실패했어요.");
      onSent?.(tempId, null);
    } finally {
      setBusy((n) => n - 1);
    }
  }

  function onKeyDown(e) {
    if (e.key !== "Enter" || e.shiftKey) return;
    // 한글 등 조합 중이면 엔터는 조합 확정용 → 전송하지 않음
    if (e.nativeEvent.isComposing || composingRef.current) return;
    e.preventDefault();
    send();
  }

  const canSend = (text.trim() || image) && busy <= 2;

  return (
    <div>
      {error && <p className="mb-1 px-1 text-xs text-brand-deep">{error}</p>}

      {image && (
        <div className="mb-2 flex items-center gap-2">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.preview}
              alt=""
              className="h-16 w-16 rounded-lg border border-line object-cover"
            />
            <button
              type="button"
              onClick={clearImage}
              aria-label="사진 제거"
              className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-solid text-white"
            >
              <Icon name="x" size={12} strokeWidth={2.5} />
            </button>
          </div>
          <span className="text-xs text-ink-faint">사진 1장</span>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex w-full items-center gap-2"
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => pickImage(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="사진 첨부"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="image" size={20} strokeWidth={1.8} />
        </button>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          type="text"
          autoComplete="off"
          maxLength={1000}
          placeholder="메시지 입력"
          className="min-w-0 flex-1 rounded-full border border-line bg-sunken px-4 py-2.5 text-sm outline-none transition focus:border-brand focus:bg-surface"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="btn btn-primary shrink-0 px-4 py-2.5 text-sm"
        >
          전송
        </button>
      </form>
    </div>
  );
}
