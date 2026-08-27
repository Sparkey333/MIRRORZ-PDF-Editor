import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../../src/store.js';

function makeStore(pageCount = 3) {
  const store = new Store();
  store.addSource('d1', new Uint8Array([1]), 'test.pdf', null);
  store.addPagesFromSource('d1', pageCount);
  return store;
}

describe('Store pages', () => {
  let store;
  beforeEach(() => { store = makeStore(); });

  it('creates page entries for a source', () => {
    expect(store.state.pages).toHaveLength(3);
    expect(store.state.pages.every((p) => p.docId === 'd1')).toBe(true);
    expect(store.state.pages.map((p) => p.srcIndex)).toEqual([0, 1, 2]);
  });

  it('moves pages', () => {
    const [a, b, c] = store.state.pages.map((p) => p.id);
    store.movePages([c], 0);
    expect(store.state.pages.map((p) => p.id)).toEqual([c, a, b]);
  });

  it('rotates pages with wraparound', () => {
    const id = store.state.pages[0].id;
    store.rotatePages([id], 90);
    store.rotatePages([id], 90);
    store.rotatePages([id], 90);
    store.rotatePages([id], 90);
    expect(store.state.pages[0].rotation).toBe(0);
    store.rotatePages([id], -90);
    expect(store.state.pages[0].rotation).toBe(270);
  });

  it('deletes pages and their annotations, but never the last page', () => {
    const [a, b, c] = store.state.pages.map((p) => p.id);
    store.addAnnotation({ pageId: b, type: 'note', x: 1, y: 1, text: 'x' });
    expect(store.deletePages([b])).toBe(true);
    expect(store.state.pages.map((p) => p.id)).toEqual([a, c]);
    expect(store.state.annotations).toHaveLength(0);
    expect(store.deletePages([a, c])).toBe(false);
    expect(store.state.pages).toHaveLength(2);
  });

  it('duplicates pages right after the original', () => {
    const [a] = store.state.pages.map((p) => p.id);
    store.duplicatePages([a]);
    expect(store.state.pages).toHaveLength(4);
    expect(store.state.pages[1].srcIndex).toBe(0);
    expect(store.state.pages[1].id).not.toBe(a);
  });

  it('inserts blank pages', () => {
    store.insertBlankPage(1, 400, 500);
    expect(store.state.pages).toHaveLength(4);
    expect(store.state.pages[1].docId).toBeNull();
    expect(store.state.pages[1].blank).toEqual({ width: 400, height: 500 });
  });
});

describe('Store annotations & history', () => {
  let store;
  beforeEach(() => { store = makeStore(1); });

  it('adds, updates and deletes annotations', () => {
    const pid = store.state.pages[0].id;
    const a = store.addAnnotation({ pageId: pid, type: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 }, color: '#ff0000' });
    expect(store.annotationsForPage(pid)).toHaveLength(1);
    store.updateAnnotation(a.id, { color: '#00ff00' });
    expect(store.state.annotations[0].color).toBe('#00ff00');
    expect(store.deleteAnnotation(a.id)).toBe(true);
    expect(store.state.annotations).toHaveLength(0);
  });

  it('undo/redo restores annotation state', () => {
    const pid = store.state.pages[0].id;
    store.addAnnotation({ pageId: pid, type: 'note', x: 5, y: 5, text: 'hello' });
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.state.annotations).toHaveLength(0);
    expect(store.canRedo).toBe(true);
    store.redo();
    expect(store.state.annotations).toHaveLength(1);
    expect(store.state.annotations[0].text).toBe('hello');
  });

  it('undo/redo restores page order', () => {
    const more = makeStore(3);
    const ids = more.state.pages.map((p) => p.id);
    more.movePages([ids[0]], 2);
    expect(more.state.pages[2].id).toBe(ids[0]);
    more.undo();
    expect(more.state.pages.map((p) => p.id)).toEqual(ids);
  });

  it('new actions clear the redo stack', () => {
    const pid = store.state.pages[0].id;
    store.addAnnotation({ pageId: pid, type: 'note', x: 1, y: 1, text: 'a' });
    store.undo();
    store.addAnnotation({ pageId: pid, type: 'note', x: 2, y: 2, text: 'b' });
    expect(store.canRedo).toBe(false);
    expect(store.state.annotations[0].text).toBe('b');
  });

  it('caps the undo stack at 60 entries', () => {
    const pid = store.state.pages[0].id;
    for (let i = 0; i < 80; i++) {
      store.addAnnotation({ pageId: pid, type: 'note', x: i, y: i, text: String(i) });
    }
    expect(store.undoStack.length).toBeLessThanOrEqual(60);
  });
});
