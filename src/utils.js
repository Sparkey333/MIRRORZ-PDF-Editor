// Small shared helpers. All geometry is in "page space": PDF points with the
// origin at the top-left of the page's crop box, y increasing downward.
// (Converted to PDF user space — y up, absolute coords — only when saving.)

let idCounter = 0;
export function uid(prefix = 'a') {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}_${Math.floor(performance.now() * 1000).toString(36)}`;
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** '#rrggbb' -> {r,g,b} in 0..1 */
export function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** {r,g,b} 0..1 or array [r,g,b] 0..255 -> '#rrggbb' */
export function rgbToHex(c) {
  let r, g, b;
  if (Array.isArray(c) || c instanceof Uint8ClampedArray || c instanceof Float32Array) {
    // pdf.js color arrays are 0..255 ints (Uint8ClampedArray) — treat >1 as 0..255
    const arr = Array.from(c);
    const scale = arr.some((v) => v > 1) ? 1 : 255;
    [r, g, b] = arr.map((v) => Math.round(v * scale));
  } else {
    r = Math.round(c.r * 255); g = Math.round(c.g * 255); b = Math.round(c.b * 255);
  }
  const to2 = (v) => clamp(v, 0, 255).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function normRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function pointInRect(px, py, r, pad = 0) {
  return px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
}

export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function downloadBlob(bytes, filename, mime = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** PDF date string like D:20260827120000Z */
export function pdfDateNow() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Replace filename extension */
export function withSuffix(name, suffix) {
  const base = (name || 'document.pdf').replace(/\.pdf$/i, '');
  return `${base}${suffix}.pdf`;
}
