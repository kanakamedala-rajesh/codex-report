'use strict';
const assert = require('node:assert/strict');

// A bounded technical audit, not an automated claim of full WCAG conformance.
// Called by browser-smoke with the same fixture/live mode as that test.
async function auditSurface(page, name) {
  const evidence = await page.evaluate(() => {
    const visible = (n) => n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    function rgba(s) {
      const values = s.match(/[\d.]+/g)?.map(Number);
      return values && values.length >= 3
        ? [values[0], values[1], values[2], values[3] ?? 1]
        : [0, 0, 0, 0];
    }
    function behind(n) {
      if (!n) return [255, 255, 255, 1];
      const color = rgba(getComputedStyle(n).backgroundColor);
      if (color[3] >= 1) return color;
      const base = behind(n.parentElement);
      return [0, 1, 2].map((i) => color[i] * color[3] + base[i] * (1 - color[3])).concat(1);
    }
    const luminance = (rgb) => {
      const c = rgb.slice(0, 3).map((n) => {
        const v = n / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    };
    const contrast = [];
    const selectors =
      'h1,h2,h3,p,label,button,summary,.badge,.value,.label,.num,.sub,.task-date,th,td,#connection,.fine,.period-info,.model-meta,.model-name';
    let checkedText = 0;
    for (const node of document.querySelectorAll(selectors)) {
      if (!visible(node) || node.matches(':disabled') || !node.textContent.trim()) continue;
      const styles = getComputedStyle(node);
      const fg = luminance(rgba(styles.color));
      const bg = luminance(behind(node));
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      const font = parseFloat(styles.fontSize);
      const required =
        font >= 24 || (font >= 18.66 && parseInt(styles.fontWeight, 10) >= 700) ? 3 : 4.5;
      checkedText++;
      if (ratio < required)
        contrast.push({
          text: node.textContent.trim().slice(0, 60),
          ratio: Number(ratio.toFixed(2)),
          required,
        });
    }
    const smallTargets = [];
    const unnamed = [];
    for (const node of document.querySelectorAll(
      'button,input:not([type=hidden]),select,summary',
    )) {
      if (!visible(node)) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5)
        smallTargets.push({
          id: node.id,
          text: node.textContent.trim().slice(0, 40),
          width: r.width,
          height: r.height,
        });
      const labelled =
        node.getAttribute('aria-label') ||
        node.getAttribute('aria-labelledby') ||
        node.textContent.trim() ||
        node.labels?.length;
      if (!labelled) unnamed.push(node.id || node.tagName);
    }
    const ids = Array.from(document.querySelectorAll('[id]')).map((n) => n.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    return {
      viewport: window.innerWidth,
      theme: document.documentElement.dataset.theme,
      checkedText,
      contrast,
      smallTargets,
      unnamed,
      duplicates,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      h1: document.querySelectorAll('h1').length,
    };
  });
  assert.deepEqual(evidence.contrast, [], `${name}: text contrast`);
  assert.deepEqual(evidence.smallTargets, [], `${name}: 44px interaction targets`);
  assert.deepEqual(evidence.unnamed, [], `${name}: accessible control names`);
  assert.deepEqual(evidence.duplicates, [], `${name}: unique DOM identifiers`);
  assert.equal(evidence.overflow, false, `${name}: no horizontal page overflow`);
  assert.equal(evidence.h1, 1, `${name}: one page heading`);
  return {
    surface: name,
    viewport: evidence.viewport,
    theme: evidence.theme,
    checkedText: evidence.checkedText,
  };
}
module.exports = { auditSurface };
