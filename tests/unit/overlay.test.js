import { describe, it, expect } from 'vitest';
import { pageMatrix, applyMatrix, invertMatrix, annotBounds, hitTest, movePatch } from '../../src/overlay.js';
import { findMatches } from '../../src/engine.js';
import { normRect, hexToRgb01, rgbToHex, distToSegment } from '../../src/utils.js';

describe('page matrix', () => {
  // A viewport like pdf.js produces for scale 2, rotation 0, view [0,0,612,792]:
  // user (x,y) -> px (2x, 2*(792-y))
  const viewport = { transform: [2, 0, 0, -2, 0, 1584] };
  const view = [0, 0, 612, 792];

  it('maps page space (y-down) to viewport px', () => {
    const m = pageMatrix(viewport, view);
    // page-space top-left -> pixel origin
    expect(applyMatrix(m, 0, 0)).toEqual({ x: 0, y: 0 });
    // page-space bottom-right -> full pixel extent
    expect(applyMatrix(m, 612, 792)).toEqual({ x: 1224, y: 1584 });
    // 100pt from top-left
    expect(applyMatrix(m, 50, 100)).toEqual({ x: 100, y: 200 });
  });

  it('inverts correctly', () => {
    const m = pageMatrix(viewport, view);
    const inv = invertMatrix(m);
    const p = applyMatrix(inv, 100, 200);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(100);
  });

  it('handles offset crop boxes', () => {
    const view2 = [10, 20, 622, 812]; // same size, shifted origin
    const vp2 = { transform: [2, 0, 0, -2, -20, 1624] }; // pdf.js compensates offsets
    const m = pageMatrix(vp2, view2);
    expect(applyMatrix(m, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('annotBounds & hitTest', () => {
  const annots = [
    { id: 'r1', type: 'rect', rect: { x: 10, y: 10, w: 100, h: 50 }, strokeWidth: 2 },
    { id: 'l1', type: 'line', x1: 200, y1: 200, x2: 300, y2: 260, strokeWidth: 2 },
    { id: 'h1', type: 'highlight', quads: [{ x: 400, y: 40, w: 80, h: 14 }] },
    { id: 'i1', type: 'ink', strokes: [[{ x: 50, y: 300 }, { x: 90, y: 340 }]], strokeWidth: 3 },
  ];

  it('computes bounds for quad and stroke annots', () => {
    expect(annotBounds(annots[2])).toEqual({ x: 400, y: 40, w: 80, h: 14 });
    const ib = annotBounds(annots[3]);
    expect(ib.x).toBeLessThan(50);
    expect(ib.w).toBeGreaterThan(40);
  });

  it('hits rects on the surface, lines near the segment, and misses elsewhere', () => {
    expect(hitTest(annots, 50, 30, 3)?.id).toBe('r1');
    expect(hitTest(annots, 250, 230, 3)?.id).toBe('l1');
    expect(hitTest(annots, 440, 47, 3)?.id).toBe('h1');
    expect(hitTest(annots, 70, 320, 3)?.id).toBe('i1');
    expect(hitTest(annots, 550, 500, 3)).toBeNull();
    // near but not on the line, beyond tolerance
    expect(hitTest(annots, 250, 200, 1)).toBeNull();
  });

  it('prefers the topmost (last drawn) annotation', () => {
    const overlapping = [
      { id: 'bottom', type: 'rect', rect: { x: 0, y: 0, w: 50, h: 50 } },
      { id: 'top', type: 'rect', rect: { x: 0, y: 0, w: 50, h: 50 } },
    ];
    expect(hitTest(overlapping, 25, 25, 2)?.id).toBe('top');
  });
});

describe('movePatch', () => {
  it('moves every geometry kind', () => {
    expect(movePatch({ type: 'note', x: 5, y: 6 }, 2, 3)).toEqual({ x: 7, y: 9 });
    expect(movePatch({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 10 }, 1, 1))
      .toEqual({ x1: 1, y1: 1, x2: 11, y2: 11 });
    const q = movePatch({ type: 'highlight', quads: [{ x: 1, y: 2, w: 3, h: 4 }] }, 10, 20);
    expect(q.quads[0]).toEqual({ x: 11, y: 22, w: 3, h: 4 });
    const s = movePatch({ type: 'ink', strokes: [[{ x: 0, y: 0 }]] }, 5, 5);
    expect(s.strokes[0][0]).toEqual({ x: 5, y: 5 });
    const r = movePatch({ type: 'rect', rect: { x: 0, y: 0, w: 5, h: 5 } }, -2, -3);
    expect(r.rect).toEqual({ x: -2, y: -3, w: 5, h: 5 });
  });
});

describe('findMatches (search)', () => {
  const extracted = {
    text: 'The quick brown fox\njumps over the lazy dog',
    items: [
      { str: 'The quick brown fox', start: 0, x: 72, y: 700, w: 190, h: 12 },
      { str: 'jumps over the lazy dog', start: 20, x: 72, y: 680, w: 230, h: 12 },
    ],
  };

  it('finds case-insensitive matches with geometry', () => {
    const m = findMatches(extracted, 'QUICK');
    expect(m).toHaveLength(1);
    expect(m[0].rects).toHaveLength(1);
    expect(m[0].rects[0].x).toBeGreaterThan(72);
    expect(m[0].rects[0].w).toBeGreaterThan(10);
  });

  it('finds matches spanning items', () => {
    const m = findMatches(extracted, 'fox jumps');
    expect(m).toHaveLength(1);
    expect(m[0].rects.length).toBe(2);
  });

  it('finds all occurrences', () => {
    expect(findMatches(extracted, 'the')).toHaveLength(2);
    expect(findMatches(extracted, 'zebra')).toHaveLength(0);
    expect(findMatches(extracted, '')).toHaveLength(0);
  });
});

describe('utils', () => {
  it('normRect normalizes negative drags', () => {
    expect(normRect(10, 10, 5, 2)).toEqual({ x: 5, y: 2, w: 5, h: 8 });
  });
  it('hex <-> rgb round trip', () => {
    expect(hexToRgb01('#ff8000')).toEqual({ r: 1, g: expect.closeTo(0.502, 2), b: 0 });
    expect(rgbToHex({ r: 1, g: 0, b: 0 })).toBe('#ff0000');
    expect(rgbToHex(new Uint8ClampedArray([255, 128, 0]))).toBe('#ff8000');
    expect(rgbToHex([0, 0.5, 1])).toBe('#0080ff');
  });
  it('distToSegment', () => {
    expect(distToSegment(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(distToSegment(-5, 0, 0, 0, 10, 0)).toBe(5);
    expect(distToSegment(5, 0, 0, 0, 10, 0)).toBe(0);
  });
});
