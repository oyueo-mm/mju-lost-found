// Run as a DevTools Snippet on the open chat tab. It observes received frames
// only. It never sends a request, reads a token, or prints a topic or raw frame.
(() => {
  const projects = {
    "https://mju-find.vercel.app": "tmifqtyxojtuoejxjrng.supabase.co",
    "https://mju-lost-found-preview.vercel.app": "swqvlihgupranzfzjevb.supabase.co",
    "http://localhost:3102": "swqvlihgupranzfzjevb.supabase.co",
  };
  const hostname = projects[location.origin];
  if (!hostname || !/^\/chat\/[1-9]\d*\/?$/.test(location.pathname)) {
    console.warn("[MJU Realtime] Open a MJU Find chat room before running this snippet.");
    return;
  }

  const installed = Symbol.for("mju.realtime.browserReceipt");
  if (window[installed]) {
    console.info("[MJU Realtime] READY");
    return;
  }

  const decoder = new TextDecoder();
  const memberTopic = /^realtime:mju-chat:[0-9a-f-]{36}$/i;
  const nonceFormat = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

  function observeFrame(data) {
    try {
      if (typeof data === "string") {
        const frame = JSON.parse(data);
        if (!Array.isArray(frame)) return;
        const [joinRef, ref, topic, event, payload] = frame;
        if (event === "phx_reply" && joinRef != null && joinRef === ref && memberTopic.test(topic)) {
          if (payload?.status === "ok") console.info("[MJU Realtime] JOIN OK");
          if (payload?.status === "error") console.warn("[MJU Realtime] JOIN DENIED");
        }
        return;
      }
      if (!(data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(data);
      if (bytes.length < 5 || bytes[0] !== 4 || bytes[4] !== 1) return;
      const eventStart = 5 + bytes[1];
      const eventEnd = eventStart + bytes[2];
      const payloadStart = eventEnd + bytes[3];
      if (payloadStart >= bytes.length ||
          !memberTopic.test(decoder.decode(bytes.subarray(5, eventStart))) ||
          decoder.decode(bytes.subarray(eventStart, eventEnd)) !== "transport_control") return;
      const nonce = JSON.parse(decoder.decode(bytes.subarray(payloadStart)))?.nonce;
      if (typeof nonce === "string" && nonceFormat.test(nonce)) console.info(`[MJU Realtime] RECEIVED ${nonce}`);
    } catch {
      // Ignore unrelated protocol frames without affecting the chat socket.
    }
  }

  window.WebSocket = new Proxy(window.WebSocket, {
    construct(NativeSocket, args, NewTarget) {
      const socket = Reflect.construct(NativeSocket, args, NewTarget);
      const url = new URL(socket.url);
      if (url.origin === `wss://${hostname}` && url.pathname === "/realtime/v1/websocket") {
        socket.addEventListener("message", ({ data, isTrusted }) => {
          if (!isTrusted) return;
          if (data instanceof Blob) void data.arrayBuffer().then(observeFrame).catch(() => {});
          else observeFrame(data);
        });
      }
      return socket;
    },
  });
  window[installed] = true;
  console.info("[MJU Realtime] READY");
})();
