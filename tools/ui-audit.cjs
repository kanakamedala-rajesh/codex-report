'use strict';
const assert = require('node:assert/strict');
async function auditPage(page, name) {
  const result = await page.evaluate(() => {
    const visible = (node) =>
      node.getClientRects().length > 0 && !node.closest('[hidden],.hidden,.sr-only');
    const rgb = (value) => {
      const n = value.match(/[\d.]+/g);
      return n ? n.map(Number) : [0, 0, 0, 0];
    };
    const luminance = (values) =>
      values
        .slice(0, 3)
        .map((v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        })
        .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
    const background = (node) => {
      for (let p = node; p; p = p.parentElement) {
        const c = rgb(getComputedStyle(p).backgroundColor);
        if (c.length === 3 || c[3] === 1) return c;
      }
      return rgb(getComputedStyle(document.body).backgroundColor);
    };
    const problems = [];
    let textCount = 0;
    let lowestContrast = Infinity;
    for (const node of document.body.querySelectorAll('*')) {
      if (
        !visible(node) ||
        node.tagName === 'OPTION' ||
        node.tagName === 'SCRIPT' ||
        node.tagName === 'STYLE'
      )
        continue;
      if ([...node.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) {
        textCount++;
        const style = getComputedStyle(node),
          fg = rgb(style.color),
          bg = background(node);
        const a = luminance(fg),
          b = luminance(bg),
          contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const large =
          parseFloat(style.fontSize) >= 24 ||
          (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
        if (!node.matches(':disabled')) {
          lowestContrast = Math.min(lowestContrast, contrast);
          if (contrast + 0.03 < (large ? 3 : 4.5))
            problems.push({
              kind: 'contrast',
              text: node.textContent.slice(0, 70),
              ratio: contrast,
            });
        }
      }
    }
    for (const control of document.querySelectorAll('button,input,select,textarea,summary')) {
      if (!visible(control)) continue;
      const label =
        control.getAttribute('aria-label') ||
        control.textContent.trim() ||
        [...(control.labels || [])].map((n) => n.textContent).join(' ') ||
        control.getAttribute('aria-labelledby');
      if (!label) problems.push({ kind: 'unnamed-control', id: control.id });
      const box = control.getBoundingClientRect();
      if (
        !control.matches('summary') &&
        !control.closest('dialog:not([open])') &&
        box.height < 43.8
      )
        problems.push({ kind: 'short-control', id: control.id, height: box.height });
    }
    const ids = [...document.querySelectorAll('[id]')].map((n) => n.id);
    if (new Set(ids).size !== ids.length) problems.push({ kind: 'duplicate-id' });
    if (document.querySelectorAll('h1').length !== 1) problems.push({ kind: 'heading-count' });
    if (document.documentElement.scrollWidth > window.innerWidth + 1)
      problems.push({
        kind: 'page-overflow',
        width: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      });
    return { textCount, lowestContrast, problems };
  });
  assert.deepEqual(result.problems, [], `${name}: ${JSON.stringify(result.problems)}`);
  return { name, ...result };
}
async function auditScale(page, name) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const before = root.dataset.fontSize;
    const nodes = [...document.body.querySelectorAll('*')].filter(
      (n) =>
        !n.closest('.sr-only,script,style') &&
        ([...n.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent.trim()) ||
          n.matches('input,select')),
    );
    root.dataset.fontSize = '14';
    const small = nodes.map((n) => parseFloat(getComputedStyle(n).fontSize));
    root.dataset.fontSize = '24';
    const large = nodes.map((n) => parseFloat(getComputedStyle(n).fontSize));
    const failures = nodes.flatMap((n, i) =>
      Math.abs(large[i] / small[i] - 24 / 14) > 0.005
        ? [{ text: n.textContent.slice(0, 45), tag: n.tagName, small: small[i], large: large[i] }]
        : [],
    );
    root.dataset.fontSize = before;
    return { observations: nodes.length, failures };
  });
  assert.deepEqual(result.failures, [], `${name} global scale: ${JSON.stringify(result.failures)}`);
  return { name, ...result };
}
module.exports = { auditPage, auditScale };
