// Build an email-safe fragment before any clipboard markup enters the live editor.
window.wscRichSignature = (() => {
  const tags = new Set(('a b big blockquote br caption center code col colgroup del div em font h1 h2 h3 h4 h5 h6 hr i img ins li ol p pre s small span strike strong sub sup table tbody td tfoot th thead tr u ul').split(' '));
  const discard = new Set(('audio base button canvas embed form iframe input link math meta noscript object picture script source style svg template textarea video').split(' '));
  const attributes = new Set('align bgcolor border cellpadding cellspacing color colspan dir face height lang rowspan size start title type valign width'.split(' '));
  const css = /^(?:background-color|border(?:-(?:top|right|bottom|left))?(?:-(?:color|style|width))?|border-(?:collapse|spacing|radius)|color|direction|display|font(?:-family|-size|-style|-variant|-weight)?|height|letter-spacing|line-height|list-style-type|overflow-wrap|word-break|(?:margin|padding)(?:-(?:top|right|bottom|left))?|(?:max-|min-)?(?:height|width)|table-layout|text-align|text-decoration(?:-color|-line|-style)?|text-indent|text-transform|vertical-align|white-space|word-spacing)$/;
  function copyStyles(target, style) {
    for (const prop of Array.from(style)) {
      if (!css.test(prop)) continue;
      const value = style.getPropertyValue(prop);
      // Allow colour functions. No remote resources, escapes or active CSS functions.
      if (/[\\<>\u0000-\u001f]/.test(value) || /[()]/.test(value.replace(/(?:rgb|hsl)a?\([\d\s.,%/+\-]+\)/gi, ''))) continue;
      if (prop === 'display' && !/^(inline|inline-block|block|table(?:-row|-cell)?)$/.test(value)) continue;
      target.style.setProperty(prop, value);
    }
  }
  function cleanHtml(html) {
    if (html.length > 1024 * 1024) throw new Error('Paste a smaller signature.');
    const source = document.createElement('template');
    source.innerHTML = html;
    // Outlook and Word can supply class-based rules instead of inline formatting.
    const rules = [];
    for (const style of source.content.querySelectorAll('style')) {
      if (typeof CSSStyleSheet !== 'function' || !CSSStyleSheet.prototype.replaceSync) break;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(style.textContent.replace(/<!--|-->/g, ''));
      for (const rule of sheet.cssRules) {
        if (!rule.selectorText || !rule.style) continue;
        for (const selector of rule.selectorText.split(',')) {
          const sel = selector.trim();
          if (!/^[\w.*#\s>\-]+$/.test(sel)) continue;
          const rank = [(sel.match(/#/g) || []).length, (sel.match(/\./g) || []).length,
            (sel.match(/(?:^|[\s>])[a-z]\w*/gi) || []).length];
          if (rules.length < 500) rules.push({sel, rank, style:rule.style});
        }
      }
    }
    rules.sort((a,b) => a.rank[0]-b.rank[0] || a.rank[1]-b.rank[1] || a.rank[2]-b.rank[2]);
    const result = source.content.ownerDocument.createDocumentFragment();
    function copy(node, parent) {
      if (node.nodeType === Node.TEXT_NODE) {
        parent.append(document.createTextNode(node.data));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.localName;
      if (discard.has(tag) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
      let target = parent;
      if (tags.has(tag)) {
        // Create in the inert template document, including remote images.
        target = source.content.ownerDocument.createElement(tag);
        for (const attr of node.attributes) {
          if (attributes.has(attr.name) && attr.value.length < 500) target.setAttribute(attr.name, attr.value);
        }
        if (tag === 'a' || tag === 'img') {
          const attr = tag === 'a' ? 'href' : 'src';
          const raw = (node.getAttribute(attr) || '').trim();
          let url;
          try { url = new URL(raw); } catch {}
          if (url && (tag === 'a' ? ['https:','http:','mailto:','tel:'] : ['https:']).includes(url.protocol)) {
            target.setAttribute(attr, url.href);
          } else if (tag === 'img') {
            parent.append(document.createTextNode(node.getAttribute('alt') || ''));
            return;
          }
          if (tag === 'img' && node.hasAttribute('alt')) target.setAttribute('alt', node.alt);
        }
        for (const rule of rules) {
          try { if (node.matches(rule.sel)) copyStyles(target, rule.style); } catch {}
        }
        copyStyles(target, node.style);
        parent.append(target);
      }
      for (const child of node.childNodes) copy(child, target);
    }
    for (const node of source.content.childNodes) copy(node, result);
    return result;
  }
  function plainText(text) {
    const fragment = document.createDocumentFragment();
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line, i) => {
      if (i) fragment.append(document.createElement('br'));
      fragment.append(document.createTextNode(line));
    });
    return fragment;
  }
  function serialize(editor) {
    const clean = cleanHtml(editor.innerHTML);
    const xml = new XMLSerializer();
    return Array.from(clean.childNodes, node => xml.serializeToString(node)).join('')
      .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
  }
  function bindPaste(editor, notice) {
    editor.addEventListener('drop', event => event.preventDefault());
    editor.addEventListener('paste', event => {
      event.preventDefault();
      if (!editor.isContentEditable || !event.clipboardData) return;
      const rich = event.clipboardData.getData('text/html');
      try {
        const fragment = rich ? cleanHtml(rich) : plainText(event.clipboardData.getData('text/plain'));
        const selection = window.getSelection();
        const range = selection.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)
          ? selection.getRangeAt(0) : document.createRange();
        if (!editor.contains(range.commonAncestorContainer)) { range.selectNodeContents(editor); range.collapse(false); }
        const last = fragment.lastChild;
        if (!last) return;
        range.deleteContents();
        range.insertNode(fragment);
        range.setStartAfter(last);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        editor.dispatchEvent(new Event('input', {bubbles:true}));
      } catch { notice('Could not paste this signature. Try copying just the signature block.'); }
    });
  }
  return {cleanHtml, plainText, serialize, bindPaste};
})();
