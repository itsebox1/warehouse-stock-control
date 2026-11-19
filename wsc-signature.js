// Build an email-safe fragment before any clipboard markup enters the live editor.
window.wscRichSignature = (() => {
  const tags = new Set(('a b big blockquote br caption center code col colgroup del div em font h1 h2 h3 h4 h5 h6 hr i img ins li ol p pre s small span strike strong sub sup table tbody td tfoot th thead tr u ul').split(' '));
  const discard = new Set(('audio base button canvas embed form iframe input link math meta noscript object script source style svg template textarea video').split(' '));
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
  function cleanHtml(html, resolveImage) {
    if (html.length > 18 * 1024 * 1024 || (html.length > 1024 * 1024 && !/data:image\//i.test(html))) throw new Error('Paste a smaller signature.');
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
            if (resolveImage) resolveImage(raw,target,node);
            else {
              parent.append(document.createTextNode(node.getAttribute('alt') || ''));
              return;
            }
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
  function restore(html, images = []) {
    return cleanHtml(html, (raw,target) => {
      const image = images.find(a => raw === 'cid:'+a.cid);
      if (image && /^image\/(png|jpeg|gif)$/.test(image.mimeType)) {
        const url = 'data:'+image.mimeType+';base64,'+image.base64;
        if (window.wscSignatureImages?.asset(url)) { target.src=url; return; }
      }
      target.dataset.wscMissing = '';
      target.alt = 'Signature image';
    });
  }
  const pendingImages = new WeakMap();
  const openPickers = new WeakMap();
  const missingSelector = 'img[data-wsc-missing]:not([src]):not([data-wsc-loading])';
  const missingCount = editor => editor.querySelectorAll(missingSelector).length;
  function removeMissing(editor) {
    const missing = Array.from(editor.querySelectorAll(missingSelector));
    for (const picture of missing) picture.remove();
    if (missing.length) editor.dispatchEvent(new Event('input',{bubbles:true}));
    return missing.length;
  }
  function isPreparing(editor) {
    const picker = openPickers.get(editor);
    return !!(picker?.active() || editor.querySelector('img[data-wsc-loading]'));
  }
  function waitForPicker(picker) {
    // A browser without a file-dialog cancellation event may leave a picker outstanding.
    // Retain the draft and offer a retry instead of submitting a previous image.
    return new Promise((resolve,reject) => {
      const timeout = setTimeout(() => reject(Error('Finish choosing the picture, or open Add image and choose the file again.')), 4000);
      picker.done.then(() => { clearTimeout(timeout); resolve(); });
    });
  }
  function checkPictures(editor) {
    const pictures = Array.from(editor.querySelectorAll('img'));
    const index = pictures.findIndex(img => img.hasAttribute('data-wsc-image-error') || img.hasAttribute('data-wsc-missing'));
    if (index < 0) return;
    const img = pictures[index];
    const which = pictures.length > 1 ? 'Picture ' + (index + 1) + ' of ' + pictures.length : 'Picture';
    const label = img.alt && img.alt !== 'Choose signature image' ? ' (' + img.alt.slice(0,80) + ')' : '';
    const reason = img.dataset.wscImageError || 'The picture file is missing.';
    throw Error(which + label + ': ' + reason + ' Select this picture and use Add image to replace it, or remove it from the signature.');
  }
  async function ready(editor, active = () => true) {
    while (active()) {
      const picker = openPickers.get(editor);
      if (picker && picker.active()) { await waitForPicker(picker); continue; }
      const jobs = Array.from(editor.querySelectorAll('img'), img => pendingImages.get(img)).filter(Boolean);
      if (!jobs.length) {
        checkPictures(editor);
        return;
      }
      await Promise.race(jobs.map(job => job.done));
    }
    throw Error('The signature editor has closed.');
  }
  function pack(editor) {
    if (editor.querySelector('img[data-wsc-loading]')) throw Error('The signature picture is still loading.');
    checkPictures(editor);
    const signatureImages = [];
    const clean = cleanHtml(editor.innerHTML, (raw,target) => {
      target.setAttribute('src',window.wscSignatureImages.pack(raw,signatureImages));
    });
    const xml = new XMLSerializer();
    const signatureHtml = Array.from(clean.childNodes, node => xml.serializeToString(node)).join('')
      .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
    return {signatureHtml,signatureImages};
  }
  function editorRange(editor) {
    const selection = window.getSelection();
    if (selection.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer))
      return selection.getRangeAt(0).cloneRange();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  }
  function insert(editor,fragment,range) {
    const last = fragment.lastChild;
    if (!last) return;
    range.deleteContents();
    range.insertNode(fragment);
    range.setStartAfter(last);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function isEmptySpacer(img) {
    const tiny = size => /^(?:0|1)(?:px)?$/i.test(String(size || '').trim());
    return (!img.alt || img.alt === 'Choose signature image') &&
      tiny(img.style.width || img.getAttribute('width')) && tiny(img.style.height || img.getAttribute('height'));
  }
  function bindPaste(editor, notice, options = {}) {
    const images = window.wscSignatureImages;
    const current = options.current || (() => editor.isContentEditable);
    const valid = (key,target) => key && current() === key && editor.isContentEditable && editor.contains(target);
    const missing = 'The clipboard did not include this picture. Use Add image to choose the original file.';
    const mark = img => {
      img.removeAttribute('src');
      img.dataset.wscMissing = '';
      if (!img.alt) img.alt = 'Choose signature image';
    };
    async function fill(target, source, key) {
      const previous = pendingImages.get(target);
      if (previous) previous.finish();
      const job = {};
      job.done = new Promise(resolve => { job.finish = resolve; });
      pendingImages.set(target,job);
      target.dataset.wscLoading = '';
      delete target.dataset.wscImageError;
      const active = () => valid(key,target) && pendingImages.get(target) === job;
      // Replacing an existing picture also makes the draft savable immediately.
      editor.dispatchEvent(new Event('input',{bubbles:true}));
      try {
        const url = await images.fit(typeof source === 'string' ? source : await images.fromFile(source));
        if (!active()) return;
        target.src = url;
        delete target.dataset.wscMissing;
        editor.dispatchEvent(new Event('input',{bubbles:true}));
      } catch (e) {
        if (active()) {
          target.dataset.wscImageError = e.message || 'Could not load the selected file.';
          notice(target.dataset.wscImageError);
        }
      } finally {
        if (pendingImages.get(target) === job) {
          pendingImages.delete(target);
          delete target.dataset.wscLoading;
          if (valid(key,target) && !editor.querySelector('img[data-wsc-loading]')) {
            try { checkPictures(editor); } catch (e) { notice(e.message); }
          }
        }
        job.finish();
      }
    }
    let clickedImage;
    function finishPicker(picker) {
      if (!picker) return;
      if (openPickers.get(editor) === picker) openPickers.delete(editor);
      picker.finish();
    }
    editor.addEventListener('click',event => { clickedImage = event.target.closest?.('img'); });
    options.button?.addEventListener('mousedown',event=>event.preventDefault());
    options.button?.addEventListener('click',() => {
      const key=current();
      if (!key || !editor.isContentEditable) return;
      finishPicker(openPickers.get(editor));
      const picker={key, active:() => current() === key, range:editorRange(editor),
        target:editor.contains(clickedImage) ? clickedImage : editor.querySelector(missingSelector)};
      picker.done = new Promise(resolve => { picker.finish = resolve; });
      openPickers.set(editor,picker);
      options.fileInput.value='';
      options.fileInput.click();
    });
    options.fileInput?.addEventListener('cancel',() => finishPicker(openPickers.get(editor)));
    options.fileInput?.addEventListener('change',() => {
      const request=openPickers.get(editor);
      finishPicker(request);
      const file=options.fileInput.files?.[0];
      if (!request || current()!==request.key || !editor.isContentEditable || !file) return;
      let target=request.target;
      if (!target || !editor.contains(target)) {
        target=document.createElement('img'); mark(target);
        const frag=document.createDocumentFragment(); frag.append(target);
        insert(editor,frag,editor.contains(request.range.commonAncestorContainer) ? request.range : editorRange(editor));
      }
      clickedImage=null;
      void fill(target,file,request.key);
    });
    editor.addEventListener('drop', event => event.preventDefault());
    editor.addEventListener('paste', event => {
      event.preventDefault();
      const key = current(), clipboard = event.clipboardData;
      if (!key || !editor.isContentEditable || !clipboard) return;
      clickedImage = null;
      try {
        const rich = clipboard.getData('text/html');
        const tasks = [], unresolved = [];
        const fragment = rich ? cleanHtml(rich,(raw,target) => {
          const embedded = images?.asset(raw);
          if (embedded && images.bytes(embedded.base64) <= images.maxBytes) target.setAttribute('src',raw);
          else {
            mark(target);
            if (embedded) tasks.push([target,raw]);
            else unresolved.push({raw,target});
          }
        }) : plainText(clipboard.getData('text/plain'));
        if (images) {
          let files=images.readFiles(clipboard);
          if (!files.length && window.wscSignatureRtfPictures)
            files=window.wscSignatureRtfPictures(clipboard.getData('text/rtf') || clipboard.getData('application/rtf') || '');
          // Outlook Web sometimes pastes an authenticated image URL alongside its actual bytes.
          const imgs = fragment.querySelectorAll('img');
          if (imgs.length === 1 && files.length === 1 && /^https:/i.test(imgs[0].getAttribute('src') || '')) {
            tasks.push([imgs[0], files.shift()]);
          }
          const assigned = new Map();
          for (const {raw,target} of unresolved) {
            let file = raw && assigned.get(raw);
            if (!file && files.length) {
              const name=raw.split(/[\\/]/).pop().replace(/^cid:/i,'').split('@')[0].toLowerCase();
              const i = files.findIndex(f=>f.name.toLowerCase()===name);
              file = files.splice(i<0?0:i,1)[0];
              if (raw) assigned.set(raw,file);
            }
            if (file) tasks.push([target,file]);
            else if (isEmptySpacer(target)) target.remove();
          }
          if (!fragment.querySelector('img')) for (const file of files) {
            const target=document.createElement('img'); mark(target); fragment.append(target);
            tasks.push([target,file]);
          }
        }
        insert(editor,fragment,editorRange(editor));
        if (editor.querySelector('img[data-wsc-missing]')) notice(tasks.length ? 'Loading signature image…' : missing);
        for (const [target,source] of tasks) void fill(target,source,key);
      } catch (e) { notice(e.message || 'Could not paste this signature. Try copying just the signature block.'); }
    });
  }
  const serialize = editor => pack(editor).signatureHtml;
  return {cleanHtml, plainText, restore, ready, isPreparing, missingCount, removeMissing, pack, serialize, bindPaste};
})();
