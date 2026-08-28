// SVG annotation overlay: renders model annotations over each rendered page
// and provides the geometry mapping between page space (PDF points, y-down
// from the crop box top-left) and rendered CSS pixels.

import { pointInRect, distToSegment, escapeHtml } from './utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Matrix mapping page space -> viewport CSS px.
 * viewport.transform maps user space (y-up) -> viewport px; page space is
 * user space translated by the crop box origin with y flipped.
 */
export function pageMatrix(viewport, view) {
  const [a, b, c, d, e, f] = viewport.transform;
  const vx0 = view[0], vy1 = view[3];
  return {
    a, b: b, c: -c, d: -d,
    e: a * vx0 + c * vy1 + e,
    f: b * vx0 + d * vy1 + f,
  };
}

export function applyMatrix(m, x, y) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

export function invertMatrix(m) {
  const det = m.a * m.d - m.b * m.c;
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  return {
    a: ia, b: ib, c: ic, d: id,
    e: -(ia * m.e + ic * m.f),
    f: -(ib * m.e + id * m.f),
  };
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Bounding rect (page space) of any annotation, for selection/hit UI. */
export function annotBounds(a) {
  switch (a.type) {
    case 'highlight': case 'underline': case 'strikeout': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const q of a.quads || []) {
        minX = Math.min(minX, q.x); minY = Math.min(minY, q.y);
        maxX = Math.max(maxX, q.x + q.w); maxY = Math.max(maxY, q.y + q.h);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'ink': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const s of a.strokes || []) for (const p of s) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      const pad = (a.strokeWidth || 2) / 2 + 1;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    case 'line': case 'arrow': {
      const pad = (a.strokeWidth || 2) / 2 + 3;
      return {
        x: Math.min(a.x1, a.x2) - pad, y: Math.min(a.y1, a.y2) - pad,
        w: Math.abs(a.x2 - a.x1) + pad * 2, h: Math.abs(a.y2 - a.y1) + pad * 2,
      };
    }
    case 'note':
      return { x: a.x, y: a.y, w: 22, h: 20 };
    default:
      return a.rect ? { ...a.rect } : { x: 0, y: 0, w: 0, h: 0 };
  }
}

/** Topmost annotation at (x, y) page space, or null. */
export function hitTest(annots, x, y, tol = 3) {
  for (let i = annots.length - 1; i >= 0; i--) {
    const a = annots[i];
    switch (a.type) {
      case 'line': case 'arrow':
        if (distToSegment(x, y, a.x1, a.y1, a.x2, a.y2) <= (a.strokeWidth || 2) / 2 + tol + 2) return a;
        break;
      case 'ink': {
        const b = annotBounds(a);
        if (!pointInRect(x, y, b, tol)) break;
        for (const s of a.strokes || []) {
          for (let j = 0; j < s.length - 1; j++) {
            if (distToSegment(x, y, s[j].x, s[j].y, s[j + 1].x, s[j + 1].y)
                <= (a.strokeWidth || 2) / 2 + tol + 2) return a;
          }
        }
        break;
      }
      case 'highlight': case 'underline': case 'strikeout':
        for (const q of a.quads || []) if (pointInRect(x, y, q, tol)) return a;
        break;
      default:
        if (pointInRect(x, y, annotBounds(a), tol)) return a;
    }
  }
  return null;
}

/** Move an annotation by (dx, dy) page-space units. Returns a patch object. */
export function movePatch(a, dx, dy) {
  switch (a.type) {
    case 'highlight': case 'underline': case 'strikeout':
      return { quads: (a.quads || []).map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })) };
    case 'ink':
      return { strokes: (a.strokes || []).map((s) => s.map((p) => ({ x: p.x + dx, y: p.y + dy }))) };
    case 'line': case 'arrow':
      return { x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case 'note':
      return { x: a.x + dx, y: a.y + dy };
    default:
      return a.rect ? { rect: { ...a.rect, x: a.rect.x + dx, y: a.rect.y + dy } } : {};
  }
}

/**
 * Render the annotations of one page into its SVG overlay.
 * @param svg the page's <svg class="annotLayer">
 * @param annots model annotations for this page
 * @param matrix from pageMatrix()
 * @param widthPx/heightPx rendered page size
 * @param selectedId currently selected annotation id or null
 */
export function renderAnnotLayer(svg, annots, matrix, widthPx, heightPx, selectedId) {
  svg.setAttribute('width', widthPx);
  svg.setAttribute('height', heightPx);
  svg.textContent = '';
  const root = el('g', {
    transform: `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`,
  });
  svg.appendChild(root);

  for (const a of annots) {
    const g = el('g', { class: 'annot', 'data-id': a.id });
    drawAnnot(g, a);
    root.appendChild(g);
  }

  if (selectedId) {
    const a = annots.find((x) => x.id === selectedId);
    if (a) {
      const b = annotBounds(a);
      root.appendChild(el('rect', {
        class: 'annot-selected-box', x: b.x - 2, y: b.y - 2, width: b.w + 4, height: b.h + 4,
      }));
      const scale = Math.hypot(matrix.a, matrix.b) || 1;
      const hs = 8 / scale; // constant screen-size handles
      if (a.type === 'line' || a.type === 'arrow') {
        root.appendChild(el('circle', {
          class: 'annot-handle', 'data-handle': 'p1', cx: a.x1, cy: a.y1, r: hs / 2 + 1,
        }));
        root.appendChild(el('circle', {
          class: 'annot-handle', 'data-handle': 'p2', cx: a.x2, cy: a.y2, r: hs / 2 + 1,
        }));
      } else if (a.rect || a.type === 'note') {
        root.appendChild(el('rect', {
          class: 'annot-handle', 'data-handle': 'se',
          x: b.x + b.w - hs / 2, y: b.y + b.h - hs / 2, width: hs, height: hs,
        }));
      }
    }
  }
}

function drawAnnot(g, a) {
  const color = a.color || '#ffd400';
  const opacity = a.opacity ?? 1;
  const sw = a.strokeWidth || 2;
  switch (a.type) {
    case 'highlight':
      for (const q of a.quads || []) {
        g.appendChild(el('rect', {
          x: q.x, y: q.y, width: q.w, height: q.h,
          fill: color, opacity, style: 'mix-blend-mode: multiply',
        }));
      }
      break;
    case 'underline':
    case 'strikeout':
      for (const q of a.quads || []) {
        const th = Math.max(0.75, q.h * 0.055);
        const y = a.type === 'underline' ? q.y + q.h - th : q.y + q.h / 2 - th / 2;
        g.appendChild(el('rect', { x: q.x, y, width: q.w, height: th, fill: color, opacity }));
      }
      break;
    case 'ink':
      for (const s of a.strokes || []) {
        const d = s.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
        g.appendChild(el('path', {
          d, fill: 'none', stroke: color, 'stroke-width': sw,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity,
        }));
      }
      break;
    case 'rect':
      g.appendChild(el('rect', {
        x: a.rect.x, y: a.rect.y, width: a.rect.w, height: a.rect.h,
        fill: 'none', stroke: color, 'stroke-width': sw, opacity,
      }));
      break;
    case 'whiteout':
      g.appendChild(el('rect', {
        x: a.rect.x, y: a.rect.y, width: a.rect.w, height: a.rect.h,
        fill: '#ffffff', stroke: 'rgba(0,0,0,0.12)', 'stroke-width': 0.5,
      }));
      break;
    case 'ellipse':
      g.appendChild(el('ellipse', {
        cx: a.rect.x + a.rect.w / 2, cy: a.rect.y + a.rect.h / 2,
        rx: a.rect.w / 2, ry: a.rect.h / 2,
        fill: 'none', stroke: color, 'stroke-width': sw, opacity,
      }));
      break;
    case 'line':
    case 'arrow': {
      g.appendChild(el('line', {
        x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2,
        stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round', opacity,
      }));
      if (a.type === 'arrow') {
        const head = Math.max(8, sw * 4);
        const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
        for (const da of [Math.PI * 0.82, -Math.PI * 0.82]) {
          g.appendChild(el('line', {
            x1: a.x2, y1: a.y2,
            x2: a.x2 + head * Math.cos(ang + da), y2: a.y2 + head * Math.sin(ang + da),
            stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round', opacity,
          }));
        }
      }
      break;
    }
    case 'freetext': {
      const fo = el('foreignObject', {
        x: a.rect.x, y: a.rect.y, width: Math.max(10, a.rect.w), height: Math.max(10, a.rect.h),
      });
      const div = document.createElement('div');
      div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      div.style.cssText =
        `font-family: Helvetica, Arial, sans-serif; font-size: ${a.fontSize || 14}px;` +
        `line-height: 1.18; color: ${color}; opacity: ${opacity}; padding: 0 2px;` +
        'white-space: pre-wrap; overflow-wrap: break-word; width: 100%; height: 100%; overflow: hidden;';
      div.textContent = a.text || '';
      fo.appendChild(div);
      g.appendChild(fo);
      break;
    }
    case 'note': {
      const x = a.x, y = a.y;
      const body = el('rect', {
        x: x + 2, y: y + 2, width: 18, height: 12, rx: 2,
        fill: color, stroke: 'rgba(0,0,0,0.55)', 'stroke-width': 1, opacity,
      });
      const tail = el('path', {
        d: `M ${x + 6} ${y + 14} L ${x + 5} ${y + 19} L ${x + 11} ${y + 14} Z`,
        fill: color, stroke: 'rgba(0,0,0,0.55)', 'stroke-width': 1, opacity,
      });
      const l1 = el('line', {
        x1: x + 5, y1: y + 6, x2: x + 17, y2: y + 6,
        stroke: 'rgba(255,255,255,0.9)', 'stroke-width': 1.4,
      });
      const l2 = el('line', {
        x1: x + 5, y1: y + 10, x2: x + 17, y2: y + 10,
        stroke: 'rgba(255,255,255,0.9)', 'stroke-width': 1.4,
      });
      g.append(body, tail, l1, l2);
      if (a.text) {
        const title = el('title');
        title.textContent = a.text;
        g.appendChild(title);
      }
      break;
    }
    case 'stamp': {
      if (a.imageData) {
        g.appendChild(el('image', {
          x: a.rect.x, y: a.rect.y, width: a.rect.w, height: a.rect.h,
          href: a.imageData, preserveAspectRatio: 'none', opacity,
        }));
      } else {
        g.appendChild(el('rect', {
          x: a.rect.x, y: a.rect.y, width: a.rect.w, height: a.rect.h,
          fill: 'rgba(255,255,255,0.65)', stroke: color, 'stroke-width': 2, opacity,
        }));
        const t = el('text', {
          x: a.rect.x + a.rect.w / 2, y: a.rect.y + a.rect.h / 2,
          'text-anchor': 'middle', 'dominant-baseline': 'central',
          fill: color, 'font-weight': 'bold',
          'font-size': Math.min(24, a.rect.h * 0.55),
          'font-family': 'Helvetica, Arial, sans-serif',
          'letter-spacing': '1',
        });
        t.textContent = a.label || 'STAMP';
        g.appendChild(t);
      }
      break;
    }
    default:
      break;
  }
}

/** Small inline SVG for the comments panel swatch/icon. */
export function annotTypeLabel(a) {
  const names = {
    highlight: 'Highlight', underline: 'Underline', strikeout: 'Strikeout',
    note: 'Note', freetext: 'Text', ink: 'Drawing', rect: 'Rectangle',
    ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow', whiteout: 'Whiteout',
    stamp: 'Stamp',
  };
  return names[a.type] || a.type;
}

export { escapeHtml };
