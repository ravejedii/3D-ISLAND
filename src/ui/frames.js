// Authored UI artwork — hand-drawn SVG, not CSS primitives.
//
// Everything here is faceted rather than smooth, so the interface belongs to
// the same low-poly world as the terrain and the knight. Shapes are drawn once
// and reused; corner pieces are fixed-size so they never stretch, while the
// plates they sit on are cut with clip-path and scale freely.

// The game's emblem: a faceted sky-crystal carried by two angular wings over a
// banner. Used on the title lockup and the win screen.
export function crestEmblem(size = 132) {
  return `
<svg class="frame emblem" viewBox="0 0 120 124" width="${size}" height="${size * 124 / 120}" aria-hidden="true">
  <defs>
    <linearGradient id="cr-gem" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#d8fbff"/><stop offset="0.45" stop-color="#7fd6ff"/><stop offset="1" stop-color="#2f74d8"/>
    </linearGradient>
    <linearGradient id="cr-gold" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#fff6d5"/><stop offset="0.4" stop-color="#e8c96a"/><stop offset="1" stop-color="#9c7529"/>
    </linearGradient>
    <linearGradient id="cr-wing" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6e6b4"/><stop offset="1" stop-color="#b08c37"/>
    </linearGradient>
  </defs>
  <g class="crest-wing">
    <path d="M34,44 L4,30 L13,48 L0,45 L12,62 L27,60 L34,54 Z" fill="url(#cr-wing)" opacity="0.95"/>
    <path d="M34,44 L13,48 L27,60 L34,54 Z" fill="#8f6f2c" opacity="0.45"/>
  </g>
  <g class="crest-wing" transform="translate(120,0) scale(-1,1)">
    <path d="M34,44 L4,30 L13,48 L0,45 L12,62 L27,60 L34,54 Z" fill="url(#cr-wing)" opacity="0.95"/>
    <path d="M34,44 L13,48 L27,60 L34,54 Z" fill="#8f6f2c" opacity="0.45"/>
  </g>
  <path d="M60,10 L88,48 L60,106 L32,48 Z" fill="url(#cr-gem)"/>
  <path d="M60,10 L88,48 L60,48 Z" fill="#ffffff" opacity="0.42"/>
  <path d="M32,48 L60,48 L60,106 Z" fill="#0d2a52" opacity="0.34"/>
  <path d="M60,10 L88,48 L60,106 L32,48 Z" fill="none" stroke="url(#cr-gold)" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M26,104 L94,104 L86,117 L34,117 Z" fill="#141d33"/>
  <path d="M26,104 L94,104 L86,117 L34,117 Z" fill="none" stroke="url(#cr-gold)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M60,107 L64,111 L60,115 L56,111 Z" fill="url(#cr-gold)"/>
</svg>`;
}

// A filigree corner piece. Four of these pin the corners of a cut plate; they
// are fixed-size so the ornament never distorts as the plate resizes.
export function cornerPiece() {
  return `
<svg class="frame corner-piece" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
  <path d="M2,14 L2,6 L6,2 L14,2" fill="none" stroke="var(--gold-2)" stroke-width="2" stroke-linecap="square"/>
  <path d="M7,7 L11,7 M7,7 L7,11" fill="none" stroke="var(--gold-1)" stroke-width="1.4" opacity="0.85"/>
  <path d="M4,4 L8,4 L4,8 Z" fill="var(--gold-2)" opacity="0.9"/>
</svg>`;
}

// Wraps the four corner pieces for a plate.
export function plateCorners() {
  return `<div class="plate-corners" aria-hidden="true">${cornerPiece()}${cornerPiece()}${cornerPiece()}${cornerPiece()}</div>`;
}

// An ornamental rule: tapered gold bars meeting a faceted lozenge.
export function ornamentRule(width = 260) {
  return `
<svg class="frame rule-orn" viewBox="0 0 ${width} 14" width="${width}" height="14" aria-hidden="true" preserveAspectRatio="none">
  <path d="M0,7 L${width / 2 - 16},5 L${width / 2 - 16},9 Z" fill="var(--gold-2)" opacity="0.75"/>
  <path d="M${width},7 L${width / 2 + 16},5 L${width / 2 + 16},9 Z" fill="var(--gold-2)" opacity="0.75"/>
  <path d="M${width / 2},0 L${width / 2 + 9},7 L${width / 2},14 L${width / 2 - 9},7 Z" fill="var(--gold-1)"/>
  <path d="M${width / 2},0 L${width / 2 + 9},7 L${width / 2},7 Z" fill="#ffffff" opacity="0.5"/>
</svg>`;
}

// The crystal pip used in the HUD counter and toasts — faceted to read at 18px.
export function crystalPip(size = 18) {
  return `
<svg class="pip" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
  <defs><linearGradient id="pipg" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#d8fbff"/><stop offset="0.5" stop-color="#6cc8ff"/><stop offset="1" stop-color="#2f74d8"/>
  </linearGradient></defs>
  <path d="M12 1.5 20.5 9 12 22.5 3.5 9Z" fill="url(#pipg)"/>
  <path d="M12 1.5 20.5 9 12 9Z" fill="#ffffff" opacity="0.5"/>
  <path d="M3.5 9 12 9 12 22.5Z" fill="#0d2a52" opacity="0.3"/>
  <path d="M12 1.5 20.5 9 12 22.5 3.5 9Z" fill="none" stroke="#eaf6ff" stroke-width="1" opacity="0.55" stroke-linejoin="round"/>
</svg>`;
}
