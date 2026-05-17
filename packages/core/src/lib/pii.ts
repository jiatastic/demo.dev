/**
 * PII blur init-script. Injected into every page before navigation so agent-driven
 * captures don't leak emails or credit-card numbers in screen recordings.
 *
 * The script applies CSS `filter: blur(...)` to:
 *  - input fields likely to hold the targeted PII (by type/name/autocomplete)
 *  - text nodes whose content matches the PII regex (wrapped in a span)
 *
 * Conservative on purpose — false negatives are expected. For high-stakes demos
 * users should also use --output-dir scrub or page-level redaction.
 */

export interface PiiBlurOptions {
  emails?: boolean;
  creditCards?: boolean;
  blurRadiusPx?: number;
}

export const buildPiiBlurScript = (options: PiiBlurOptions): string => {
  const radius = options.blurRadiusPx ?? 8;
  const wantEmails = options.emails === true;
  const wantCC = options.creditCards === true;

  return `
(() => {
  const RADIUS = ${radius};
  const WANT_EMAIL = ${wantEmails};
  const WANT_CC = ${wantCC};
  const STYLE_ID = "__demo_dev_pii_style__";

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    const selectors = [];
    if (WANT_EMAIL) {
      selectors.push('input[type="email"]');
      selectors.push('input[autocomplete~="email"]');
      selectors.push('input[name*="email" i]');
      selectors.push('[data-pii="email"]');
    }
    if (WANT_CC) {
      selectors.push('input[autocomplete~="cc-number"]');
      selectors.push('input[name*="card" i]');
      selectors.push('[data-pii="card"]');
    }
    if (selectors.length > 0) {
      style.textContent = selectors.join(",") + " { filter: blur(" + RADIUS + "px) !important; }";
      document.head.appendChild(style);
    }
  }

  if (!WANT_EMAIL && !WANT_CC) return;

  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g;
  // 13–19 digit groups, allowing spaces/dashes — common Luhn-ish lengths
  const CC_RE = /\\b(?:\\d[ -]?){12,18}\\d\\b/g;

  const wrap = (text) => {
    const span = document.createElement("span");
    span.style.cssText = "filter: blur(" + RADIUS + "px); display: inline-block;";
    span.textContent = text;
    return span;
  };

  const scan = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const targets = [];
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || "";
      if (!value.trim()) continue;
      let matched = false;
      if (WANT_EMAIL && EMAIL_RE.test(value)) matched = true;
      EMAIL_RE.lastIndex = 0;
      if (!matched && WANT_CC && CC_RE.test(value)) matched = true;
      CC_RE.lastIndex = 0;
      if (matched) targets.push(node);
    }
    targets.forEach((textNode) => {
      const value = textNode.nodeValue || "";
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      const combined = [];
      if (WANT_EMAIL) {
        let m;
        while ((m = EMAIL_RE.exec(value)) !== null) combined.push([m.index, m.index + m[0].length, m[0]]);
        EMAIL_RE.lastIndex = 0;
      }
      if (WANT_CC) {
        let m;
        while ((m = CC_RE.exec(value)) !== null) combined.push([m.index, m.index + m[0].length, m[0]]);
        CC_RE.lastIndex = 0;
      }
      combined.sort((a, b) => a[0] - b[0]);
      combined.forEach(([start, end, text]) => {
        if (start < lastIndex) return;
        if (start > lastIndex) frag.appendChild(document.createTextNode(value.slice(lastIndex, start)));
        frag.appendChild(wrap(text));
        lastIndex = end;
      });
      if (lastIndex < value.length) frag.appendChild(document.createTextNode(value.slice(lastIndex)));
      textNode.parentNode && textNode.parentNode.replaceChild(frag, textNode);
    });
  };

  const run = () => {
    try { scan(document.body); } catch (_) {}
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    run();
  } else {
    document.addEventListener("DOMContentLoaded", run);
  }
  // Re-scan on DOM mutations (SPA updates)
  const observer = new MutationObserver(() => run());
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
})();
`.trim();
};
