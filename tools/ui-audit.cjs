'use strict';
const assert = require('node:assert/strict');

// Direct technical checks for the Impeccable audit. This is not its binary
// detector or a WCAG certification. The user-scoped targets are computer windows.
async function auditDesktop(page, name) {
  const result = await page.evaluate(() => {
    const visible = (node) => {
      if (!(node instanceof HTMLElement) || node.closest('[hidden]')) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        !node.closest('.sr-only')
      );
    };
    const rgba = (value) => {
      const nums = value.match(/[\d.]+/g)?.map(Number) || [];
      return [nums[0] || 0, nums[1] || 0, nums[2] || 0, nums[3] ?? 1];
    };
    const over = (front, back) =>
      [0, 1, 2].map((i) => front[i] * front[3] + back[i] * (1 - front[3]));
    const background = (node) => {
      const layers = [];
      for (let parent = node; parent; parent = parent.parentElement)
        layers.unshift(rgba(getComputedStyle(parent).backgroundColor));
      return layers.reduce((color, layer) => over(layer, color), [255, 255, 255]);
    };
    const luminance = (color) =>
      color
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const texts = [...document.querySelectorAll('body *')].filter(
      (node) =>
        visible(node) &&
        !['SCRIPT', 'STYLE', 'OPTION', 'SVG', 'PATH'].includes(node.tagName) &&
        [...node.childNodes].some(
          (child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim(),
        ),
    );
    const small = [],
      contrast = [];
    let smallest = Infinity;
    for (const node of texts) {
      const style = getComputedStyle(node);
      const size = parseFloat(style.fontSize);
      smallest = Math.min(smallest, size);
      const label = `${node.tagName}#${node.id}.${node.className}: ${node.textContent.trim().slice(0, 70)}`;
      if (size < 15.9) small.push({ label, size });
      if (node.closest('button:disabled,input:disabled,select:disabled')) continue;
      const bg = background(node);
      const fg = over(rgba(style.color), bg);
      const a = luminance(bg),
        b = luminance(fg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const large = size >= 24 || (size >= 18.66 && parseFloat(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) contrast.push({ label, ratio: Number(ratio.toFixed(2)) });
    }
    const badControls = [];
    for (const node of document.querySelectorAll(
      'button, input:not([type=hidden]), select, summary',
    )) {
      if (!visible(node)) continue;
      const rect = node.getBoundingClientRect();
      const named =
        node.getAttribute('aria-label') ||
        node.getAttribute('aria-labelledby') ||
        node.textContent.trim() ||
        (node.labels && [...node.labels].some((label) => label.textContent.trim()));
      if (!named || rect.height < 43.9)
        badControls.push({
          id: node.id || node.tagName,
          height: rect.height,
          named: Boolean(named),
        });
    }
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      smallestText: smallest,
      textNodesChecked: texts.length,
      small,
      contrast,
      badControls,
      duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
      headings: [...document.querySelectorAll('h1')].filter(visible).length,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  assert.equal(result.headings, 1, `${name}: one visible page heading`);
  assert.deepEqual(result.duplicateIds, [], `${name}: unique IDs`);
  assert.deepEqual(result.small, [], `${name}: minimum readable text`);
  assert.deepEqual(result.contrast, [], `${name}: sampled text contrast`);
  assert.deepEqual(result.badControls, [], `${name}: named and comfortably sized controls`);
  assert.equal(result.pageOverflow, false, `${name}: page must not overflow`);
  return { name, ...result };
}
module.exports = { auditDesktop };
