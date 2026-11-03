// Where chat web push can work, decided before anything is asked of the
// browser. Pure (tested): the settings card passes what it reads from
// navigator/window.
//   in_app      -- KakaoTalk / Everytime / Instagram / NAVER / Line / Facebook
//                  in-app browsers: no Web Push; open in Chrome or Safari
//   ios_tab     -- iPhone/iPad outside the home-screen app: Web Push only
//                  works for a site added to the home screen (iOS 16.4+)
//   unsupported -- no Service Worker / Push / Notification API
//   denied      -- the user blocked notifications: never ask again
//   ready       -- can turn it on
export type PushEnvironment = { kind: "in_app" | "ios_tab" | "unsupported" | "denied" | "ready" };

const IN_APP = /KAKAOTALK|everytime|Everytime|Instagram|FBAN|FBAV|NAVER\(inapp|Line\/|DaumApps|; wv\)/;

export function pushEnvironment(e: {
  userAgent: string;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  standalone: boolean;
  permission: "default" | "granted" | "denied";
}): PushEnvironment {
  if (IN_APP.test(e.userAgent)) return { kind: "in_app" };
  const ios = /iPhone|iPad|iPod/.test(e.userAgent) || (/Macintosh/.test(e.userAgent) && /Mobile\//.test(e.userAgent));
  if (ios && !e.standalone) return { kind: "ios_tab" };
  if (!e.hasServiceWorker || !e.hasPushManager || !e.hasNotification) return { kind: "unsupported" };
  if (e.permission === "denied") return { kind: "denied" };
  return { kind: "ready" };
}
