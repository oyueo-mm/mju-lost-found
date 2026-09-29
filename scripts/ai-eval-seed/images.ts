// Procedural "photo-like" images for the AI-eval seed (Preview only).
//
// This environment has no real photos of lost items, so each object is
// drawn once as SVG and re-rendered from a different angle / background /
// lighting per post (same physical object on the Lost and Found side), and
// each decoy is drawn as a genuinely different object of the same kind.
// These are NOT photographs -- SigLIP was trained on natural photos, so
// image-similarity results on these images are a smoke test of the real
// upload -> embedding -> search pipeline, not a benchmark of real-world
// image-search accuracy.
import sharp from "sharp";

import type { Background, ImageSpec } from "./data";

const W = 720;
const H = 540;

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function background(bg: Background, seed: number): { defs: string; body: string } {
  switch (bg) {
    case "desk":
      return {
        defs: `
          <linearGradient id="bgBase" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#b98652"/><stop offset="1" stop-color="#8d5c34"/>
          </linearGradient>
          <filter id="wood" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.003 0.07" numOctaves="3" seed="${seed % 97}"/>
            <feColorMatrix type="matrix" values="0 0 0 0 0.28  0 0 0 0 0.16  0 0 0 0 0.07  1.6 0 0 0 -0.55"/>
          </filter>`,
        body: `<rect width="${W}" height="${H}" fill="url(#bgBase)"/><rect width="${W}" height="${H}" filter="url(#wood)"/>`,
      };
    case "floor": {
      const lines: string[] = [];
      for (let x = -40; x < W + 40; x += 150) lines.push(`<path d="M${x} 0 L${x + 60} ${H}" stroke="#7f7f79" stroke-width="3"/>`);
      for (let y = 60; y < H; y += 150) lines.push(`<path d="M0 ${y} L${W} ${y - 20}" stroke="#7f7f79" stroke-width="3"/>`);
      return {
        defs: `
          <linearGradient id="bgBase" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#a7a7a1"/><stop offset="1" stop-color="#8e8e88"/>
          </linearGradient>
          <filter id="speck"><feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2" seed="${seed % 89}"/>
            <feColorMatrix type="matrix" values="0 0 0 0 0.3  0 0 0 0 0.3  0 0 0 0 0.28  1.2 0 0 0 -0.6"/></filter>`,
        body: `<rect width="${W}" height="${H}" fill="url(#bgBase)"/>${lines.join("")}<rect width="${W}" height="${H}" filter="url(#speck)"/>`,
      };
    }
    case "whiteTable":
      return {
        defs: `
          <radialGradient id="bgBase" cx="0.35" cy="0.3" r="0.9">
            <stop offset="0" stop-color="#f7f6f2"/><stop offset="1" stop-color="#d9d6ce"/>
          </radialGradient>`,
        body: `<rect width="${W}" height="${H}" fill="url(#bgBase)"/>`,
      };
    case "bench": {
      const slats: string[] = [];
      for (let y = -20, i = 0; y < H; y += 92, i++) {
        slats.push(`<rect x="-10" y="${y}" width="${W + 20}" height="78" fill="url(#slat)"/>`);
        slats.push(`<rect x="-10" y="${y + 78}" width="${W + 20}" height="14" fill="#262b25"/>`);
      }
      return {
        defs: `
          <linearGradient id="slat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#6a7466"/><stop offset="1" stop-color="#4f584c"/>
          </linearGradient>
          <filter id="weather"><feTurbulence type="fractalNoise" baseFrequency="0.01 0.2" numOctaves="3" seed="${seed % 83}"/>
            <feColorMatrix type="matrix" values="0 0 0 0 0.15  0 0 0 0 0.17  0 0 0 0 0.14  1.4 0 0 0 -0.55"/></filter>`,
        body: `${slats.join("")}<rect width="${W}" height="${H}" filter="url(#weather)"/>`,
      };
    }
    case "carpet":
      return {
        defs: `
          <filter id="pile"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="${seed % 79}"/>
            <feColorMatrix type="matrix" values="0 0 0 0 0.18  0 0 0 0 0.2  0 0 0 0 0.25  1.5 0 0 0 -0.4"/></filter>`,
        body: `<rect width="${W}" height="${H}" fill="#48505e"/><rect width="${W}" height="${H}" filter="url(#pile)"/>`,
      };
    case "concrete":
      return {
        defs: `
          <filter id="blotch"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="4" seed="${seed % 73}"/>
            <feColorMatrix type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.44  0 0 0 0 0.42  1.3 0 0 0 -0.55"/></filter>`,
        body: `<rect width="${W}" height="${H}" fill="#b6b3ad"/><rect width="${W}" height="${H}" filter="url(#blotch)"/>`,
      };
  }
}

function studentCard(rand: () => number, clean: boolean): string {
  const bars = clean ? [170, 110, 140, 70] : [150, 125, 160, 95];
  const photoFill = clean ? "#b9a89b" : "#9aa6b4";
  const barcode: string[] = [];
  let x = -30;
  while (x < 128) {
    const w = 1 + Math.floor(rand() * 4);
    barcode.push(`<rect x="${x}" y="58" width="${w}" height="24" fill="#2b2b2b"/>`);
    x += w + 1 + Math.floor(rand() * 3);
  }
  const scratches: string[] = [];
  if (!clean) {
    for (let i = 0; i < 38; i++) {
      const x1 = -145 + rand() * 290;
      const y1 = -90 + rand() * 180;
      const len = 20 + rand() * 90;
      const ang = rand() * Math.PI;
      const x2 = x1 + Math.cos(ang) * len;
      const y2 = y1 + Math.sin(ang) * len * 0.35;
      const light = rand() > 0.35;
      scratches.push(
        `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${light ? "#ffffff" : "#8a8a8a"}" stroke-opacity="${light ? 0.6 : 0.35}" stroke-width="${(0.8 + rand() * 1.2).toFixed(2)}"/>`,
      );
    }
  }
  return `
    <g filter="url(#privacy)">
      <rect x="-150" y="-95" width="300" height="190" rx="12" fill="#f6f6f2" stroke="#d6d6d0" stroke-width="2"/>
      <rect x="-150" y="-95" width="300" height="42" rx="12" fill="#1c4fa0"/>
      <rect x="-150" y="-70" width="300" height="17" fill="#1c4fa0"/>
      <rect x="-130" y="-83" width="120" height="10" rx="3" fill="#ffffff" opacity=".85"/>
      <rect x="-132" y="-40" width="78" height="100" rx="4" fill="#cfd6de"/>
      <circle cx="-93" cy="-8" r="18" fill="${photoFill}"/>
      <path d="M-125 58 Q-93 14 -61 58 Z" fill="${photoFill}"/>
      ${bars.map((w, i) => `<rect x="-35" y="${-32 + i * 22}" width="${w}" height="10" rx="3" fill="#6b7280" opacity=".7"/>`).join("")}
      ${barcode.join("")}
      <g clip-path="url(#cardClip)">${scratches.join("")}</g>
    </g>`;
}

function object(spec: ImageSpec, rand: () => number): string {
  switch (spec.kind) {
    case "cardWallet":
      return `
        <rect x="-95" y="-120" width="150" height="46" rx="5" fill="#2f6fed"/>
        <rect x="-20" y="-112" width="130" height="40" rx="5" fill="#e9c14a"/>
        <rect x="-130" y="-90" width="260" height="175" rx="16" fill="#1d1d20"/>
        <rect x="-130" y="-90" width="260" height="175" rx="16" fill="url(#sheen)"/>
        <rect x="-121" y="-81" width="242" height="157" rx="11" fill="none" stroke="#4d4d52" stroke-width="2" stroke-dasharray="7 5"/>
        <path d="M-115 -42 H115" stroke="#0e0e10" stroke-width="3"/><path d="M-115 -39 H115" stroke="#3a3a3f" stroke-width="1"/>
        <path d="M-115 -8 H115" stroke="#0e0e10" stroke-width="3"/><path d="M-115 -5 H115" stroke="#3a3a3f" stroke-width="1"/>`;
    case "longWallet":
      return `
        <rect x="-165" y="-82" width="330" height="164" rx="12" fill="#18181a"/>
        <rect x="-165" y="-82" width="330" height="164" rx="12" fill="url(#sheen)"/>
        <path d="M-157 -74 H157 V74" fill="none" stroke="#9a9aa0" stroke-width="4" stroke-dasharray="2 3"/>
        <rect x="150" y="-60" width="16" height="30" rx="4" fill="#b8b8be"/>`;
    case "studentCard":
      return studentCard(rand, spec.variant === "clean");
    case "airpodsProCase": {
      const sticker =
        spec.variant === "greenSticker"
          ? `<circle cx="58" cy="34" r="14" fill="#2eaa55"/><circle cx="54" cy="30" r="4" fill="#ffffff" opacity=".45"/>`
          : spec.variant === "noSticker"
            ? ""
            : `<circle cx="-55" cy="40" r="13" fill="#2f6fed"/><circle cx="-59" cy="36" r="4" fill="#ffffff" opacity=".45"/>`;
      return `
        <rect x="-112" y="-82" width="224" height="164" rx="64" fill="url(#caseGrad)" stroke="#d4d4ce" stroke-width="2"/>
        <path d="M-106 -28 Q0 -36 106 -28" fill="none" stroke="#c9c9c3" stroke-width="2.5"/>
        <circle cx="0" cy="18" r="3.5" fill="#9fc79f" opacity=".85"/>
        ${sticker}`;
    }
    case "airpodsCase":
      return `
        <rect x="-78" y="-104" width="156" height="208" rx="48" fill="${spec.color ?? "url(#caseGrad)"}" stroke="#d4d4ce" stroke-width="2"/>
        <path d="M-74 -40 Q0 -46 74 -40" fill="none" stroke="#c9c9c3" stroke-width="2.5"/>
        <circle cx="0" cy="-18" r="3.5" fill="#9fc79f" opacity=".85"/>`;
    case "phonePinkClearCase":
      return `
        <rect x="-78" y="-160" width="156" height="320" rx="28" fill="#f3c7cf"/>
        <rect x="-66" y="-148" width="68" height="68" rx="18" fill="#e7b1bc"/>
        <circle cx="-47" cy="-129" r="13" fill="#1b1b1f"/><circle cx="-47" cy="-129" r="5" fill="#3b4a66"/>
        <circle cx="-19" cy="-101" r="13" fill="#1b1b1f"/><circle cx="-19" cy="-101" r="5" fill="#3b4a66"/>
        <circle cx="-19" cy="-129" r="4" fill="#f6f1d8"/>
        <rect x="-52" y="28" width="104" height="64" rx="4" fill="#f3e7c8"/>
        <path d="M24 28 V92" stroke="#b9a988" stroke-width="1.5" stroke-dasharray="3 3"/>
        <rect x="-44" y="38" width="58" height="7" rx="2" fill="#a0936f"/>
        <rect x="-44" y="52" width="46" height="6" rx="2" fill="#b9ab88"/>
        <rect x="-44" y="64" width="52" height="6" rx="2" fill="#b9ab88"/>
        <rect x="-88" y="-170" width="176" height="340" rx="36" fill="#ffffff" fill-opacity=".12" stroke="#ffffff" stroke-opacity=".75" stroke-width="3"/>
        <path d="M-60 -170 L60 170" stroke="#ffffff" stroke-opacity=".18" stroke-width="40"/>`;
    case "phoneBlackLeather":
      return `
        <rect x="-88" y="-170" width="176" height="340" rx="36" fill="#1f1b19"/>
        <rect x="-88" y="-170" width="176" height="340" rx="36" fill="url(#sheen)"/>
        <rect x="-74" y="-156" width="74" height="74" rx="20" fill="#0e0e0f"/>
        <circle cx="-54" cy="-136" r="14" fill="#2a2a2e"/><circle cx="-54" cy="-136" r="6" fill="#4a5875"/>
        <circle cx="-24" cy="-106" r="14" fill="#2a2a2e"/><circle cx="-24" cy="-106" r="6" fill="#4a5875"/>`;
    case "clearCaseOnly":
      return `
        <rect x="-50" y="8" width="100" height="84" rx="3" fill="#ffffff"/>
        <rect x="-44" y="14" width="88" height="62" fill="#8ec5ea"/>
        <path d="M-44 76 Q-10 44 18 62 Q32 52 44 60 V76 Z" fill="#5aa55a"/>
        <circle cx="26" cy="30" r="8" fill="#ffe27a"/>
        <rect x="-88" y="-170" width="176" height="340" rx="36" fill="#ffffff" fill-opacity=".14" stroke="#ffffff" stroke-opacity=".85" stroke-width="4"/>
        <rect x="-74" y="-156" width="74" height="74" rx="20" fill="none" stroke="#ffffff" stroke-opacity=".75" stroke-width="3"/>
        <path d="M-60 -170 L60 170" stroke="#ffffff" stroke-opacity=".15" stroke-width="36"/>`;
    case "ipadWithPencil":
      return `
        <rect x="-168" y="-120" width="336" height="240" rx="22" fill="#5d6068"/>
        <rect x="-160" y="-112" width="320" height="224" rx="15" fill="#0f1114"/>
        <rect x="-160" y="-112" width="320" height="224" rx="15" fill="#ffffff" fill-opacity=".06" filter="url(#matte)"/>
        <path d="M-160 60 L40 -112 L140 -112 L-60 112 L-160 112 Z" fill="#ffffff" fill-opacity=".05"/>
        <circle cx="0" cy="-116" r="2.5" fill="#2a2c30"/>
        <rect x="-115" y="-137" width="220" height="15" rx="7" fill="#f5f5f3" stroke="#d8d8d4" stroke-width="1.5"/>
        <path d="M105 -137 L128 -129.5 L105 -122 Z" fill="#ebe3d2"/>`;
    case "galaxyTabKeyboard": {
      const keys: string[] = [];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 12; c++) {
          keys.push(`<rect x="${-150 + c * 25}" y="${62 + r * 26}" width="21" height="21" rx="3" fill="#3b3c40"/>`);
        }
      }
      return `
        <rect x="-168" y="-175" width="336" height="215" rx="16" fill="#111214"/>
        <rect x="-160" y="-167" width="320" height="199" rx="11" fill="#07080a"/>
        <path d="M-160 20 L10 -167 L90 -167 L-80 32 Z" fill="#ffffff" fill-opacity=".05"/>
        <rect x="-168" y="44" width="336" height="130" rx="10" fill="#26272a"/>
        ${keys.join("")}`;
    }
    case "clearUmbrellaWood":
    case "clearUmbrellaPlastic": {
      const handle =
        spec.kind === "clearUmbrellaWood"
          ? `<path d="M168 0 L205 0 Q245 0 245 38 Q245 70 215 70 Q195 70 195 52" fill="none" stroke="#7d4f27" stroke-width="18" stroke-linecap="round"/>
             <path d="M168 -3 L205 -3 Q241 -3 241 36" fill="none" stroke="#a8733f" stroke-width="5" stroke-linecap="round" opacity=".7"/>`
          : `<path d="M168 0 L205 0 Q245 0 245 38 Q245 70 215 70 Q195 70 195 52" fill="none" stroke="#bdbdbd" stroke-width="21" stroke-linecap="round"/>
             <path d="M168 0 L205 0 Q245 0 245 38 Q245 70 215 70 Q195 70 195 52" fill="none" stroke="#f3f3f3" stroke-width="16" stroke-linecap="round"/>`;
      return `
        <rect x="-222" y="-4" width="22" height="8" rx="3" fill="#5b5f63"/>
        <rect x="128" y="-5" width="44" height="10" fill="#8f969c"/>
        <path d="M-204 0 L-40 -36 Q60 -42 132 -19 L132 19 Q60 42 -40 36 Z" fill="#dcebf5" fill-opacity=".45" stroke="#ffffff" stroke-opacity=".8" stroke-width="2"/>
        <path d="M-198 0 Q-40 -14 130 -9" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="1.5"/>
        <path d="M-198 0 Q-40 14 130 9" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="1.5"/>
        <path d="M-190 0 L128 -15" stroke="#8a939b" stroke-opacity=".55" stroke-width="1.5"/>
        <path d="M-190 0 L128 15" stroke="#8a939b" stroke-opacity=".55" stroke-width="1.5"/>
        <rect x="20" y="-40" width="18" height="80" rx="4" fill="#ffffff" fill-opacity=".4"/>
        ${handle}`;
    }
    case "ecoBagWithItems":
      return `
        <path d="M-75 -110 Q-75 -205 -12 -205 Q40 -205 40 -110" fill="none" stroke="#e3d7ba" stroke-width="16"/>
        <path d="M-40 -110 Q-40 -190 18 -190 Q72 -190 72 -110" fill="none" stroke="#ece2c8" stroke-width="16"/>
        <rect x="-82" y="-152" width="112" height="62" rx="3" fill="#243b6b"/>
        <rect x="-82" y="-152" width="112" height="9" fill="#f1eee4"/>
        <rect x="32" y="-142" width="62" height="46" rx="12" fill="#2f5fd0"/>
        <path d="M-122 -112 L122 -112 L138 150 Q0 166 -138 150 Z" fill="#efe6d0"/>
        <path d="M-122 -112 L122 -112 L138 150 Q0 166 -138 150 Z" fill="#ffffff" fill-opacity=".1" filter="url(#canvas)"/>
        <path d="M-122 -112 L-138 150 Q-100 158 -80 157 L-90 -112 Z" fill="#000000" fill-opacity=".06"/>
        <path d="M-118 -100 H118" stroke="#d2c4a2" stroke-width="2" stroke-dasharray="5 4"/>`;
    case "glasses": {
      const c = spec.color ?? "#1b1b1b";
      const thin = spec.variant === "clean";
      const w = thin ? 4 : 11;
      return `
        <rect x="-150" y="-48" width="130" height="92" rx="${thin ? 40 : 26}" fill="#dfe8ef" fill-opacity=".25" stroke="${c}" stroke-width="${w}"/>
        <rect x="20" y="-48" width="130" height="92" rx="${thin ? 40 : 26}" fill="#dfe8ef" fill-opacity=".25" stroke="${c}" stroke-width="${w}"/>
        <path d="M-20 -22 Q0 -34 20 -22" fill="none" stroke="${c}" stroke-width="${thin ? 4 : 9}"/>
        <path d="M-150 -36 L-172 -40 L-120 70" fill="none" stroke="${c}" stroke-width="${thin ? 4 : 9}" stroke-linecap="round"/>
        <path d="M150 -36 L172 -40 L128 76" fill="none" stroke="${c}" stroke-width="${thin ? 4 : 9}" stroke-linecap="round"/>
        <path d="M-130 -30 L-60 20" stroke="#ffffff" stroke-opacity=".35" stroke-width="10"/>
        <path d="M40 -30 L110 20" stroke="#ffffff" stroke-opacity=".35" stroke-width="10"/>`;
    }
    case "powerBank": {
      const c = spec.color ?? "#f2f2ef";
      const cable = spec.accent
        ? `<path d="M0 132 Q10 190 90 180 Q170 170 150 100 Q135 40 190 20" fill="none" stroke="${spec.accent}" stroke-width="9" stroke-linecap="round"/>
           <rect x="180" y="6" width="22" height="32" rx="5" fill="#cfcfcf"/>`
        : "";
      return `
        ${cable}
        <rect x="-78" y="-130" width="156" height="262" rx="22" fill="${c}" stroke="#00000022" stroke-width="2"/>
        <rect x="-78" y="-130" width="156" height="262" rx="22" fill="url(#sheen)"/>
        <rect x="-18" y="124" width="36" height="8" rx="4" fill="#3a3a3a"/>
        ${[0, 1, 2, 3].map((i) => `<circle cx="${-24 + i * 16}" cy="96" r="4" fill="${i < 3 ? "#56b3ff" : "#9aa"}"/>`).join("")}
        <rect x="-40" y="-40" width="80" height="10" rx="4" fill="#00000033"/>`;
    }
    case "mouse": {
      const c = spec.color ?? "#3a3c40";
      const receiver = spec.accent ? `<rect x="80" y="60" width="26" height="46" rx="4" fill="${spec.accent}"/><rect x="84" y="46" width="18" height="16" fill="#b9b9b9"/>` : "";
      return `
        <ellipse cx="0" cy="0" rx="72" ry="118" fill="${c}"/>
        <ellipse cx="0" cy="0" rx="72" ry="118" fill="url(#sheen)"/>
        <path d="M0 -118 V-30" stroke="#00000055" stroke-width="3"/>
        <path d="M-70 -30 Q0 -16 70 -30" fill="none" stroke="#00000044" stroke-width="3"/>
        <rect x="-7" y="-92" width="14" height="34" rx="7" fill="#1a1a1a"/>
        <rect x="-16" y="60" width="32" height="6" rx="3" fill="#ffffff" opacity=".35"/>
        ${receiver}`;
    }
    case "calculator": {
      const keys: string[] = [];
      for (let r = 0; r < 7; r++) {
        for (let col = 0; col < 5; col++) {
          const top = r < 2;
          keys.push(`<rect x="${-70 + col * 29}" y="${-10 + r * 22}" width="${top ? 22 : 24}" height="15" rx="4" fill="${top ? "#55595f" : r > 4 && col === 4 ? "#3d6fb6" : "#e9e9e6"}"/>`);
        }
      }
      const sticker = spec.accent ? `<circle cx="58" cy="-108" r="14" fill="${spec.accent}"/>` : "";
      return `
        <rect x="-90" y="-140" width="180" height="310" rx="18" fill="#2c2f33"/>
        <rect x="-72" y="-120" width="144" height="70" rx="6" fill="#b8c4a8"/>
        <rect x="-60" y="-100" width="96" height="10" rx="2" fill="#4a5242" opacity=".7"/>
        <rect x="-10" y="-80" width="70" height="16" rx="2" fill="#4a5242" opacity=".8"/>
        <rect x="-72" y="-36" width="60" height="10" rx="3" fill="#c7c9cc" opacity=".6"/>
        ${keys.join("")}
        ${sticker}`;
    }
    case "keysCharm": {
      const n = spec.keyCount ?? 2;
      const keyPath = (angle: number) =>
        `<g transform="rotate(${angle})"><rect x="-8" y="30" width="16" height="130" rx="4" fill="#c9ccd1"/><circle cx="0" cy="30" r="24" fill="#d5d8dc"/><circle cx="0" cy="26" r="8" fill="none" stroke="#9ea3a9" stroke-width="3"/>
         <path d="M8 120 H24 V132 H8 M8 140 H20 V150 H8" fill="#c9ccd1" stroke="#aab0b6" stroke-width="2"/></g>`;
      const charm =
        spec.charm === "bear"
          ? `<g transform="translate(-120 40)"><circle cx="0" cy="0" r="42" fill="#8a5a33"/><circle cx="-32" cy="-34" r="16" fill="#8a5a33"/><circle cx="32" cy="-34" r="16" fill="#8a5a33"/>
             <circle cx="0" cy="12" r="18" fill="#c89a6c"/><circle cx="-14" cy="-8" r="5" fill="#1b1b1b"/><circle cx="14" cy="-8" r="5" fill="#1b1b1b"/><circle cx="0" cy="8" r="5" fill="#1b1b1b"/></g>
             <path d="M-40 -60 Q-90 -40 -110 0" fill="none" stroke="#b9b9b9" stroke-width="4"/>`
          : spec.charm === "rabbit"
            ? `<g transform="translate(-120 50)"><ellipse cx="-16" cy="-62" rx="11" ry="34" fill="#f4b7c8"/><ellipse cx="16" cy="-62" rx="11" ry="34" fill="#f4b7c8"/><circle cx="0" cy="0" r="40" fill="#f4b7c8"/>
               <circle cx="-13" cy="-6" r="5" fill="#1b1b1b"/><circle cx="13" cy="-6" r="5" fill="#1b1b1b"/><circle cx="0" cy="8" r="4" fill="#d9657f"/></g>
               <path d="M-40 -60 Q-90 -40 -110 0" fill="none" stroke="#b9b9b9" stroke-width="4"/>`
            : "";
      return `
        <circle cx="0" cy="-70" r="34" fill="none" stroke="#b9bdc2" stroke-width="7"/>
        ${Array.from({ length: n }, (_, i) => keyPath(-25 + i * 28)).join("")}
        ${charm}`;
    }
    // ---------- batch 3 ----------
    case "budsCase": {
      const c = spec.color ?? "#f1f1ef";
      return `
        <rect x="-100" y="-78" width="200" height="156" rx="66" fill="${c}" stroke="#00000022" stroke-width="2"/>
        <rect x="-100" y="-78" width="200" height="156" rx="66" fill="url(#sheen)"/>
        <path d="M-98 -8 Q0 -2 98 -8" fill="none" stroke="#00000033" stroke-width="3"/>
        <circle cx="0" cy="36" r="4" fill="#7fd07f" opacity=".85"/>`;
    }
    case "earphonesWired": {
      const c = spec.color ?? "#f4f4f2";
      const bud = (x: number, y: number, r: number) =>
        `<g transform="translate(${x} ${y}) rotate(${r})"><circle cx="0" cy="0" r="30" fill="${c}" stroke="#00000022" stroke-width="2"/><rect x="-9" y="20" width="18" height="60" rx="8" fill="${c}" stroke="#00000022" stroke-width="2"/><circle cx="-8" cy="-8" r="7" fill="#ffffff" opacity=".5"/></g>`;
      return `
        <path d="M-120 -30 Q-110 60 -30 80 Q40 95 60 150" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
        <path d="M110 -40 Q120 40 50 70 Q20 85 55 145" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
        <path d="M58 150 Q80 200 150 190" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
        <rect x="140" y="178" width="46" height="24" rx="8" fill="#cfd2d6"/><rect x="182" y="184" width="16" height="12" rx="4" fill="#9ea3a9"/>
        ${bud(-125, -70, -20)}${bud(115, -80, 25)}`;
    }
    case "bankCard": {
      const c = spec.color ?? "#2f6fed";
      const logo = spec.accent ?? "#ffffff";
      return `
        <rect x="-150" y="-95" width="300" height="190" rx="14" fill="${c}"/>
        <rect x="-150" y="-95" width="300" height="190" rx="14" fill="url(#sheen)"/>
        <rect x="-112" y="-40" width="52" height="40" rx="6" fill="#d9b85c"/><path d="M-112 -20 H-60 M-86 -40 V0" stroke="#a88a3a" stroke-width="2"/>
        <circle cx="102" cy="-52" r="22" fill="${logo}" opacity=".9"/>
        <rect x="-112" y="30" width="170" height="12" rx="4" fill="#ffffff" opacity=".55"/>
        <rect x="-112" y="54" width="110" height="10" rx="4" fill="#ffffff" opacity=".4"/>`;
    }
    case "cardCase": {
      const c = spec.color ?? "#1f2a44";
      const peek = spec.accent ?? "#f3f3f3";
      const strap = spec.strap
        ? `<path d="M-40 -95 Q-30 -230 0 -240 Q30 -230 40 -95" fill="none" stroke="${c}" stroke-width="14" stroke-linecap="round"/><rect x="-14" y="-110" width="28" height="22" rx="5" fill="#b9bdc2"/>`
        : "";
      return `
        ${strap}
        <rect x="-95" y="-110" width="170" height="110" rx="8" fill="${peek}"/>
        <rect x="-120" y="-88" width="240" height="176" rx="16" fill="${c}"/>
        <rect x="-120" y="-88" width="240" height="176" rx="16" fill="url(#sheen)"/>
        <rect x="-110" y="-78" width="220" height="156" rx="12" fill="none" stroke="#ffffff" stroke-opacity=".3" stroke-width="2" stroke-dasharray="6 5"/>
        <path d="M-100 -30 Q0 -12 100 -30" fill="none" stroke="#00000055" stroke-width="3"/>`;
    }
    case "laptop": {
      const c = spec.color ?? "#8e9196";
      const sticker = spec.accent
        ? `<g transform="translate(95 55) rotate(-12)"><circle cx="0" cy="0" r="30" fill="${spec.accent}"/><circle cx="0" cy="-4" r="15" fill="#e8eef4"/><rect x="-10" y="-10" width="20" height="10" rx="4" fill="#2b3a55"/><rect x="-14" y="10" width="28" height="18" rx="6" fill="#e8eef4"/></g>`
        : "";
      return `
        <rect x="-200" y="-135" width="400" height="270" rx="16" fill="${c}"/>
        <rect x="-200" y="-135" width="400" height="270" rx="16" fill="url(#sheen)"/>
        <rect x="-200" y="-135" width="400" height="270" rx="16" fill="#ffffff" fill-opacity=".04" filter="url(#matte)"/>
        <circle cx="0" cy="-5" r="20" fill="#ffffff" opacity=".35"/>
        <rect x="-195" y="128" width="390" height="7" rx="3" fill="#00000033"/>
        ${sticker}`;
    }
    case "charger": {
      const c = spec.color ?? "#f2f2f0";
      return `
        <path d="M0 70 Q20 170 120 160 Q210 150 190 60 Q175 0 230 -20" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>
        <rect x="218" y="-40" width="34" height="42" rx="7" fill="#cfd2d6"/>
        <rect x="-80" y="-85" width="160" height="160" rx="22" fill="${c}" stroke="#00000022" stroke-width="2"/>
        <rect x="-80" y="-85" width="160" height="160" rx="22" fill="url(#sheen)"/>
        <rect x="-38" y="-120" width="12" height="38" rx="3" fill="#b9bdc2"/><rect x="26" y="-120" width="12" height="38" rx="3" fill="#b9bdc2"/>
        <rect x="-18" y="62" width="36" height="12" rx="5" fill="#3a3a3a"/>
        <circle cx="0" cy="-10" r="16" fill="#00000018"/>`;
    }
    case "tumbler": {
      const c = spec.color ?? "#8fd3c4";
      const band = spec.accent ?? "#2a2a2a";
      return `
        <rect x="-62" y="-150" width="124" height="44" rx="12" fill="${band}"/>
        <path d="M-68 -110 L68 -110 L56 160 Q0 172 -56 160 Z" fill="${c}"/>
        <path d="M-68 -110 L68 -110 L56 160 Q0 172 -56 160 Z" fill="url(#sheen)"/>
        <path d="M-40 -100 L-32 150" stroke="#ffffff" stroke-opacity=".35" stroke-width="12"/>
        <circle cx="0" cy="20" r="26" fill="#ffffff" opacity=".55"/><circle cx="0" cy="20" r="14" fill="${c}"/>`;
    }
    case "cap": {
      const c = spec.color ?? "#1d2b4f";
      const logo = spec.accent ?? "#ffffff";
      return `
        <ellipse cx="40" cy="70" rx="170" ry="50" fill="${c}"/>
        <ellipse cx="40" cy="62" rx="150" ry="36" fill="#00000030"/>
        <path d="M-150 60 Q-150 -120 0 -130 Q150 -120 150 60 Z" fill="${c}"/>
        <path d="M-150 60 Q-150 -120 0 -130 Q150 -120 150 60 Z" fill="url(#sheen)"/>
        <path d="M0 -130 V55 M-80 -100 Q-50 0 -60 58 M80 -100 Q50 0 60 58" fill="none" stroke="#00000044" stroke-width="3"/>
        <circle cx="0" cy="-130" r="10" fill="${c}"/>
        <path d="M-26 -30 L-26 10 M-26 -30 L10 10 M10 -30 L10 10 M22 -30 L34 -10 L46 -30 M34 -10 V10" fill="none" stroke="${logo}" stroke-width="6" stroke-linecap="round"/>`;
    }
    case "ecoBagEmpty":
      return `
        <path d="M-70 -95 Q-70 -175 -10 -175 Q40 -175 40 -95" fill="none" stroke="#cdb88f" stroke-width="15"/>
        <path d="M-125 -98 Q0 -86 125 -98 L136 150 Q0 160 -136 150 Z" fill="#d8c59f"/>
        <path d="M-125 -98 Q0 -86 125 -98 L136 150 Q0 160 -136 150 Z" fill="#ffffff" fill-opacity=".08" filter="url(#canvas)"/>
        <path d="M60 150 L136 150 L128 70 Z" fill="#e8dbbd"/>
        <path d="M-120 -86 Q0 -74 120 -86" stroke="#bfa979" stroke-width="2" stroke-dasharray="5 4" fill="none"/>`;
  }
}

export function renderSvg(spec: ImageSpec): string {
  const seed = hashString(JSON.stringify(spec));
  const rand = mulberry32(seed);
  const bg = background(spec.background, seed);
  const lightOverlay =
    spec.light >= 0
      ? `<rect width="${W}" height="${H}" fill="url(#warm)" opacity="${(spec.light * 0.45).toFixed(2)}"/>`
      : `<rect width="${W}" height="${H}" fill="#1b2a44" opacity="${(-spec.light * 0.35).toFixed(2)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${bg.defs}
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".14"/><stop offset=".5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="caseGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e2e2dc"/>
    </linearGradient>
    <linearGradient id="warm" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff4dc"/><stop offset="1" stop-color="#fff4dc" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="vignette" cx=".5" cy=".5" r=".75">
      <stop offset=".55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity=".45"/>
    </radialGradient>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="11"/>
      <feOffset dx="14" dy="18"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="privacy"><feGaussianBlur stdDeviation="1.6"/></filter>
    <filter id="matte"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed % 61}"/>
      <feColorMatrix type="saturate" values="0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <filter id="canvas"><feTurbulence type="fractalNoise" baseFrequency="0.55 0.5" numOctaves="2" seed="${seed % 59}"/>
      <feColorMatrix type="saturate" values="0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <clipPath id="cardClip"><rect x="-150" y="-95" width="300" height="190" rx="12"/></clipPath>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="1" seed="${seed % 53}"/>
      <feColorMatrix type="saturate" values="0"/></filter>
  </defs>
  ${bg.body}
  <g transform="translate(${W / 2 + spec.dx} ${H / 2 + spec.dy}) rotate(${spec.rotate}) skewX(${spec.skew}) scale(${spec.scale})" filter="url(#shadow)">
    ${object(spec, rand)}
  </g>
  ${lightOverlay}
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity=".06"/>
</svg>`;
}

export async function renderJpeg(spec: ImageSpec): Promise<Buffer> {
  return sharp(Buffer.from(renderSvg(spec))).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}
