export const THEME_MODES = [
  { key: "system", label: "시스템" },
  { key: "light", label: "밝게" },
  { key: "dark", label: "어둡게" },
];

export const ACCENTS = [
  { key: "blue", label: "명지 블루", color: "#0b4da2" },
  { key: "green", label: "그린", color: "#1f8a4c" },
  { key: "purple", label: "퍼플", color: "#6d4bb8" },
  { key: "rose", label: "로즈", color: "#c43a63" },
];

// 첫 페인트 전에 실행되는 인라인 스크립트 (FOUC 방지)
export const THEME_INIT_SCRIPT = `(function(){try{
var r=document.documentElement;
var m=localStorage.getItem('theme')||'system';
var dark=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
r.dataset.theme=dark?'dark':'light';
var a=localStorage.getItem('accent');
if(a&&a!=='blue')r.dataset.accent=a;else delete r.dataset.accent;
if(localStorage.getItem('contrast')==='high')r.dataset.contrast='high';
}catch(e){}})();`;
