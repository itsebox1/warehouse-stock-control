(function (root) {
  'use strict';

  const skuKey = value => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

  function visionWords(annotation) {
    const words = [];
    for (const page of annotation?.pages || []) {
      for (const block of page.blocks || []) {
        for (const paragraph of block.paragraphs || []) {
          for (const word of paragraph.words || []) {
            const box = word.boundingBox;
            const vertices = box?.vertices?.length ? box.vertices : box?.normalizedVertices;
            if (!vertices?.length) continue;
            const absolute = vertices === box.vertices;
            const xs = vertices.map(vertex => (vertex.x ?? 0) * (absolute ? 1 : page.width));
            const ys = vertices.map(vertex => (vertex.y ?? 0) * (absolute ? 1 : page.height));
            const x = Math.min(...xs), y = Math.min(...ys);
            words.push({
              text: (word.symbols || []).map(symbol => symbol.text || '').join(''),
              x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y,
            });
          }
        }
      }
    }
    return words;
  }

  function readPage(result) {
    const response = result?.responses?.[0] || result;
    const annotation = response?.fullTextAnnotation || response;
    const rawWords = Array.isArray(response?.words) ? response.words : visionWords(annotation);
    const text = String(typeof response === 'string' ? response : response?.text || annotation?.text || response?.textAnnotations?.[0]?.description || '').trim();
    const words = rawWords.filter(word => word && typeof word.text === 'string' && word.text.trim() &&
      [word.x, word.y, word.width, word.height].every(Number.isFinite) && word.width > 0 && word.height > 0);
    const lines = [];
    for (const word of words.sort((a, b) => a.y - b.y || a.x - b.x)) {
      const centre = word.y + word.height / 2;
      const line = lines.find(candidate => Math.abs(candidate.centre - centre) <= Math.min(candidate.height, word.height) * 0.45);
      if (line) {
        line.centre = (line.centre * line.words.length + centre) / (line.words.length + 1);
        line.words.push(word);
      } else {
        lines.push({centre, height: word.height, words: [word]});
      }
    }

    const rows = lines.sort((a, b) => a.centre - b.centre).map(line => {
      const cells = [];
      for (const word of line.words.sort((a, b) => a.x - b.x)) {
        const last = cells[cells.length - 1];
        const end = word.x + word.width;
        const gap = word.x - (last?.end ?? 0);
        if (last && gap <= word.height * 0.6) {
          last.text += (gap > word.height * 0.12 ? ' ' : '') + word.text.trim();
          last.end = Math.max(last.end, end);
        } else {
          cells.push({x: word.x, end, text: word.text.trim()});
        }
      }
      return cells;
    });

    return {rows, text: text || rows.map(row => row.map(cell => cell.text).join('  ')).join('\n'), positioned: rows.length > 0};
  }

  const skuHeading = /^(?:sku|(?:item|product|stock|part)(?:\s+(?:sku|code|no\.?|number))?)$/i;
  const qtyHeading = /^(?:(?:order(?:ed)?\s+)?(?:qty\.?|quantity)|(?:qty\.?|quantity)\s+ordered)$/i;
  const skuLabel = '(?:sku|(?:item|product|stock|part)\\s+(?:code|no\\.?|number))';
  const qtyLabel = '(?:qty\\.?|quantity)';
  const explicit = new RegExp('^' + skuLabel + '\\s*[:#=]?\\s*(.+?)\\s*(?:[,;]\\s*|\\s+)' + qtyLabel + '\\s*[:#=]?\\s*([\\d,.]+)(?=\\s|$)', 'i');
  const skuOnly = new RegExp('^' + skuLabel + '\\s*[:#=]\\s*(.+)$', 'i');
  const qtyOnly = new RegExp('^' + qtyLabel + '\\s*[:#=]?\\s*([\\d,.]+)\\s*$', 'i');
  const countAfter = /^(.+?)\s*[×x]\s*(\d[\d,]*)$/i;
  const countBefore = /^(\d[\d,]*)\s*[×x]\s*(.+)$/i;
  const summary = /^(?:sub\s*total|grand\s*total|order\s*total|total|vat|terms|invoice|purchase\s+order|order\s+(?:date|number|no\.?|reference)|date)\b/i;

  function quantity(value) {
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) return '';
    const count = Number(value.replace(/,/g, ''));
    return Number.isSafeInteger(count) && count > 0 ? String(count) : '';
  }

  function tableHeader(line, cells) {
    const sku = cells.findIndex(cell => skuHeading.test(cell));
    const qty = cells.findIndex(cell => qtyHeading.test(cell));
    if (sku >= 0 && qty >= 0) return {sku, qty, width: cells.length};
    const skuFirst = /^(?:sku|(?:item|product|stock|part)(?:\s+(?:sku|code|no\.?|number))?)\b/i.exec(line);
    const qtyFirst = /^(?:qty\.?|quantity)\b/i.exec(line);
    if (skuFirst && /\b(?:qty\.?|quantity)\b/i.test(line.slice(skuFirst[0].length))) {
      return {sku: 0, qty: /^\s+(?:qty\.?|quantity)\b/i.test(line.slice(skuFirst[0].length)) ? 1 : null};
    }
    if (qtyFirst && /^\s+(?:sku|item|product|stock|part)\b/i.test(line.slice(qtyFirst[0].length))) return {sku: 1, qty: 0};
    return null;
  }

  function productRows(text, products) {
    const catalog = new Map((products || []).filter(product => product?.sku).map(product => [skuKey(product.sku), product.sku]));
    const keys = [...catalog.keys()].sort((a, b) => b.length - a.length);
    const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const rows = [];
    const add = (sku, count) => {
      const verified = catalog.get(skuKey(sku));
      if (!verified) return false;
      rows.push({sku: verified, quantity: quantity(count)});
      return true;
    };
    let table = null;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const cells = line.split(/\s*(?:\t|\|)\s*| {2,}/).map(cell => cell.trim());
      const labelled = explicit.exec(line);
      if (labelled) {
        add(labelled[1], labelled[2]);
        continue;
      }
      const heading = tableHeader(line, cells);
      if (heading) {
        table = heading;
        continue;
      }
      if (summary.test(line)) {
        table = null;
        continue;
      }
      const after = countAfter.exec(line), before = countBefore.exec(line);
      if ((after && add(after[1], after[2])) || (before && add(before[2], before[1]))) continue;
      const single = skuOnly.exec(line);
      if (single) {
        const count = qtyOnly.exec(lines[index + 1] || '');
        if (add(single[1], count?.[1] || '')) {
          if (count) index++;
          continue;
        }
      }
      if (!table) continue;
      if (cells.length === table.width && add(cells[table.sku], cells[table.qty])) continue;

      // With flattened columns, an adjacent Qty column can be recovered. A
      // number after an unbounded description could be part of the description.
      const firstQty = table.qty === 0 && /^(\d[\d,]*)\s+/.exec(line);
      const skuAndRest = skuKey(firstQty ? line.slice(firstQty[0].length) : line);
      const sku = keys.find(key => skuAndRest === key || skuAndRest.startsWith(key + ' '));
      if (!sku) continue;
      const rest = skuAndRest.slice(sku.length).trim();
      const adjacentQty = table.sku === 0 && table.qty === 1 && /^(\d[\d,]*)(?=\s|$)(?!\s+(?:ML|CL|L|G|KG|MM|CM|M|MG|OZ|LB|LITRES?|LITERS?|X|×)\b)/.exec(rest);
      add(sku, firstQty?.[1] || adjacentQty?.[1] || '');
    }
    return rows;
  }

  root.WSCBatchOCR = Object.freeze({readPage, productRows});
})(typeof window === 'undefined' ? globalThis : window);
