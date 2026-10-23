import { describe, expect, it } from 'vitest';
import { NO_GUTTERS, pageBreaks, previewScale, previewStatus, stablePaneWidth } from './previewMath';

describe('stablePaneWidth', () => {
  const well = { outerWidth: 820, borderX: 0, paddingX: 8, scrolls: true, windowBar: 0 };

  it('takes the well scrollbar off whether or not it shows, and remembers it', () => {
    const withBar = stablePaneWidth({ ...well, clientWidth: 805 });
    expect(withBar.width).toBe(797);
    // The bar went away: the width does not grow back (that loop is the shake).
    const without = stablePaneWidth({ ...well, clientWidth: 820 }, withBar.gutters);
    expect(without.width).toBe(797);
  });

  it('ignores a rounding difference', () => {
    expect(stablePaneWidth({ ...well, clientWidth: 819 }).width).toBe(812);
  });

  it('allows for the window scrollbar in the narrow layout', () => {
    const first = stablePaneWidth({ ...well, scrolls: false, clientWidth: 820, windowBar: 15 });
    expect(first.width).toBe(812);
    const later = stablePaneWidth({ ...well, scrolls: false, clientWidth: 820, windowBar: 0 }, first.gutters);
    expect(later.width).toBe(797);
    expect(stablePaneWidth({ ...well, scrolls: false, clientWidth: 820 }, NO_GUTTERS).width).toBe(812);
  });
});

describe('previewScale', () => {
  it('shrinks to the pane, never enlarges, and waits for a measure', () => {
    expect(previewScale(397, 794)).toBe(0.5);
    expect(previewScale(2000, 794)).toBe(1);
    expect(previewScale(0, 794)).toBe(0);
  });
});

describe('pageBreaks', () => {
  const page = { heightPx: 1123, contentHeightPx: 1027 };
  it('puts a line after each content box past the top margin', () => {
    expect(pageBreaks({ height: 2300, padTop: 48, padBottom: 48 }, page)).toEqual([1075, 2102]);
  });
  it('draws none for a one-page document or an unknown box', () => {
    expect(pageBreaks({ height: 1123, padTop: 48, padBottom: 48 }, page)).toEqual([]);
    expect(pageBreaks(null, page)).toEqual([]);
    expect(pageBreaks({ height: 3000, padTop: 0, padBottom: 0 }, { heightPx: 1123, contentHeightPx: 50 })).toEqual([]);
  });
});

describe('previewStatus', () => {
  const base = { failed: false, shown: true, requestKey: 'k', renderedKey: 'k', frontId: 2, newestId: 2 };
  it('is current only when the newest answer for this draft is on screen', () => {
    expect(previewStatus(base)).toBe('current');
    expect(previewStatus({ ...base, requestKey: 'k2' })).toBe('updating');
    expect(previewStatus({ ...base, frontId: 1 })).toBe('updating');
    expect(previewStatus({ ...base, shown: false })).toBe('waiting');
    expect(previewStatus({ ...base, failed: true })).toBe('error');
  });
});
