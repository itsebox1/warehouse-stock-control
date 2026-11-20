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
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(value)) return '';
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
    const purchaseOrder = purchaseOrderRows(textRows(text), products);
    if (purchaseOrder.handled) return purchaseOrder.rows;
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

  // A customer's PO can put their own item number on the quantity row and
  // our number underneath it. Keep that block together until the next item.
  const supplierPart = /\b(?:your|supplier(?:['’]s)?|vendor(?:['’]s)?|ITS(?:\s+Europe)?)\s+(?:sku|(?:part|item|product|stock)(?:\s*(?:number|no\.?|code|#))?)(?=\s|[:#=]|$)\s*[:#=]?\s*/i;
  const supplierHeading = /^(?:your|supplier(?:['’]s)?|vendor(?:['’]s)?|ITS(?:\s+Europe)?)\s+(?:sku|(?:part|item|product|stock)(?:\s*(?:number|no\.?|code|#))?)\s*[:.]?$/i;
  const itemHeading = /^(?:(?:your|supplier(?:['’]s)?|vendor(?:['’]s)?|ITS(?:\s+Europe)?)\s+)?(?:sku|(?:item|product|stock|part)(?:\s+(?:sku|code|number|no\.?))?)\s*[:.]?$/i;
  const itemCode = /^[A-Z0-9][A-Z0-9._/-]*$/i;
  const tableEnd = /^(?:sub\s*total|grand\s*total|order\s*total|total\b|vat\b|terms\b|important\s+notice|please\b|payment\s+terms|order\s+date|delivery\s+date)/i;

  function textRows(text) {
    return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line =>
      line.split(/\s*(?:\t|\|)\s*| {2,}/).map((text, index) => ({text, x:index * 200, end:index * 200 + 100})));
  }

  function columnText(cells, headers, index) {
    const header = headers[index];
    const left = index ? (headers[index - 1].end + header.x) / 2 : -Infinity;
    const right = index + 1 < headers.length ? (header.end + headers[index + 1].x) / 2 : Infinity;
    return cells.filter(cell => (cell.x + cell.end) / 2 >= left && (cell.x + cell.end) / 2 < right)
      .map(cell => cell.text).join(' ').trim();
  }

  function catalogueTableRows(pageRows, products) {
    const catalog = new Map((products || []).filter(p => p?.sku).map(p => [skuKey(p.sku), p.sku]));
    const rows = [], notes = [];
    let qtyCell, pending;
    for (let i = 0; i < pageRows.length; i++) {
      const cells = pageRows[i];
      const heading = cells.find(cell => qtyHeading.test(cell.text.trim()));
      if (heading) {
        const nearby = pageRows.slice(Math.max(0, i - 2), i + 3).flat();
        if (nearby.some(cell => /^(?:ref(?:erence)?\.?|article|material|catalogue|description|product description|item description)$/i.test(cell.text.trim()))) {
          qtyCell = heading;
          pending = null;
          continue;
        }
      }
      if (!qtyCell) continue;
      if (cells.some(cell => /^(?:grand total|total ht|subtotal|order total|total payable)\b/i.test(cell.text)) || /^total\b/i.test(cells[0]?.text || '')) {
        qtyCell = pending = null;
        continue;
      }
      const counts = [], matches = new Set();
      for (const cell of cells) {
        const value = cell.text.trim();
        const center = (cell.x + cell.end) / 2;
        if (center >= qtyCell.x - 4 && center <= qtyCell.end + 4 && quantity(value)) {
          counts.push(quantity(value));
          continue;
        }
        for (const token of [value, ...(value.match(/[\w./-]+/g) || [])]) {
          const sku = catalog.get(skuKey(token));
          if (sku) matches.add(sku);
        }
      }
      if (matches.size) {
        pending = null;
        if (matches.size > 1) {
          notes.push('Several catalogue codes appear on one line. Check the products and quantities.');
          continue;
        }
        pending = {sku:[...matches][0], quantity:''};
        rows.push(pending);
      }
      if (pending && counts.length === 1) {
        pending.quantity = counts[0];
        pending = null;
      }
    }
    return {handled:rows.length > 0, rows, notes};
  }

  function purchaseOrderRows(pageRows, products) {
    const join = cells => cells.map(cell => cell.text).join(' ').trim();
    if (!pageRows.some(cells => supplierPart.test(join(cells)))) return catalogueTableRows(pageRows, products);
    const catalog = new Map((products || []).filter(p => p?.sku).map(p => [skuKey(p.sku), p.sku]));
    const rows = [], notes = [];
    let headers = null, skuIndex = -1, qtyIndex = -1, pending = null, flatTable = false;
    const finish = () => {
      if (!pending) return;
      const key = skuKey(pending.sku);
      if (key && (pending.explicit || catalog.has(key))) {
        rows.push({sku:catalog.get(key) || pending.sku, quantity:pending.ambiguous ? '' : pending.quantity});
        if (!catalog.has(key)) notes.push('Check Your Part No '+pending.sku+'; it was not found in the WSC catalogue.');
        if (pending.ambiguous) notes.push('More than one supplier part number was found for an order line. Check its SKU and quantity.');
      }
      pending = null;
    };
    for (let index = 0; index < pageRows.length; index++) {
      const cells = pageRows[index], text = join(cells);
      if (tableEnd.test(text)) { finish(); headers = null; flatTable = false; continue; }
      const skuColumns = cells.map((cell, i) => itemHeading.test(cell.text.trim()) ? i : -1).filter(i => i >= 0);
      const q = cells.findIndex(cell => qtyHeading.test(cell.text.trim()));
      if (skuColumns.length && q >= 0) {
        finish(); headers = cells; qtyIndex = q;
        skuIndex = skuColumns.find(i => supplierHeading.test(cells[i].text.trim())) ?? skuColumns[0];
        continue;
      }
      if (/^(?:item|product|stock|part|sku)\b/i.test(text) && /\b(?:qty\.?|quantity)\b/i.test(text) && /\b(?:price|amount|total)\b/i.test(text)) {
        finish(); flatTable = true; continue;
      }
      const label = supplierPart.exec(text);
      if (!headers && !flatTable && !label) {
        const labelled = explicit.exec(text), after = countAfter.exec(text), before = countBefore.exec(text);
        const code = labelled?.[1] || after?.[1] || before?.[2];
        const count = labelled?.[2] || after?.[2] || before?.[1];
        if (code && catalog.has(skuKey(code))) {
          finish(); rows.push({sku:catalog.get(skuKey(code)), quantity:quantity(count)}); continue;
        }
      }
      const remainder = label ? text.slice(label.index + label[0].length).trim() : '';
      const labelledQty = /\b(?:qty\.?|quantity)\s*[:#=]?\s*([\d,.]+)(?=\s|$)/i.exec(text);
      let explicitSku = '';
      if (label) {
        const candidates = [...catalog.keys()].sort((a, b) => b.length - a.length);
        const upper = skuKey(remainder);
        const known = candidates.find(key => upper === key || upper.startsWith(key + ' ') || upper.startsWith(key + ','));
        explicitSku = known ? catalog.get(known) : (/^([A-Z0-9][A-Z0-9._/-]*)(?=\s|$)/i.exec(remainder)?.[1] || '');
        if (!explicitSku && !remainder) {
          const next = pageRows[index + 1];
          const value = next && join(next);
          if (value && itemCode.test(value) && /\d/.test(value)) { explicitSku = value; index++; }
        }
        if (!/\d/.test(explicitSku)) explicitSku = '';
      }
      let sku = '', count = '';
      if (headers) {
        sku = columnText(cells, headers, skuIndex);
        count = quantity(columnText(cells, headers, qtyIndex));
      } else if (flatTable) {
        sku = /^([A-Z0-9][A-Z0-9._/-]*)\b/i.exec(text)?.[1] || '';
        // Anchor to the money columns; digits in descriptions (e.g. PK.30)
        // must never become ordered quantities.
        count = quantity(/\s(\d[\d,]*(?:\.0+)?)\s+[£€$]?[\d,]+\.\d{2}\s+[£€$]?[\d,]+\.\d{2}\s*$/.exec(text)?.[1] || '');
      }
      const startsItem = itemCode.test(sku) && /\d/.test(sku) && !label;
      if (startsItem) {
        if (pending?.orphan && pending.explicit && !pending.quantity) { pending.quantity = count; pending.orphan = false; }
        else { finish(); pending = {sku, quantity:count, explicit:false}; }
        if (supplierHeading.test(headers?.[skuIndex]?.text || '')) pending.explicit = true;
      }
      if (label) {
        if (!pending) pending = {sku:'', quantity:'', explicit:false, orphan:true};
        if (explicitSku) {
          if (pending.explicit && skuKey(pending.sku) !== skuKey(explicitSku)) pending.ambiguous = true;
          pending.sku = explicitSku; pending.explicit = true;
        } else {
          // An unreadable explicit number must not fall back to the buyer's code.
          pending.sku = ''; pending.explicit = true;
          notes.push('A Your Part No value could not be read. Check this product line manually.');
        }
        if (labelledQty || count) pending.quantity = quantity(labelledQty?.[1] || count);
      } else if (pending && !startsItem && labelledQty && !pending.quantity) {
        pending.quantity = quantity(labelledQty[1]);
      }
    }
    finish();
    return {handled:true, rows, notes:[...new Set(notes)]};
  }

  const deliveryLabel = /^(?:(?:delivery|shipping|ship[ -]?to)\s+address|(?:ship|deliver(?:y)?)\s+to|delivery\s+details)(?:\s*[:#]\s*|\s{2,}|$)(.*)$/i;
  const partyLabel = /^(?:supplier|vendor|seller|customer|buyer|purchaser|sold\s+to|bill\s+to|invoice\s+to|company)(?:\s+(?:name|address|details))?(?:\s*[:#]\s*|$)/i;
  const metadata = /^(?:purchase\s+order|order\s+(?:no\.?|number|date)|delivery\s+date|supplier\s+(?:no\.?|number|contact)|payment\s+terms|page|item\s+(?:no\.?|description)|qty\.?|quantity|important\s+notice)\b/i;
  const ukPostcode = /\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i;

  function deliveryAddresses(pages) {
    const found = [];
    for (const rows of pages || []) {
      for (let i = 0; i < rows.length; i++) {
        for (const [j, cell] of rows[i].entries()) {
          const match = deliveryLabel.exec(cell.text.trim());
          if (!match) continue;
          const lines = [], next = rows[i][j + 1];
          const left = cell.x - 15;
          const right = next && (partyLabel.test(next.text) || metadata.test(next.text)) ? next.x - 15 : Infinity;
          if (match[1]) lines.push(match[1].trim());
          if (!match[1] && next && next.x - cell.end < 70 && !partyLabel.test(next.text) && !metadata.test(next.text)) lines.push(next.text.trim());
          for (const row of rows.slice(i + 1, i + 13)) {
            const first = row.find(part => part.x >= left && part.x <= cell.x + 70 && part.x < right);
            if (!first) continue;
            if (deliveryLabel.test(first.text) || partyLabel.test(first.text) || metadata.test(first.text) || tableEnd.test(first.text)) break;
            let value = first.text.trim(), end = first.end;
            for (const part of row.slice(row.indexOf(first) + 1)) {
              if (part.x >= right || part.x - end > 65 || metadata.test(part.text) || partyLabel.test(part.text)) break;
              value += ' ' + part.text.trim(); end = part.end;
            }
            if (!value || /@|https?:\/\/|\b(?:telephone|phone|fax)\b/i.test(value)) break;
            lines.push(value);
            if (/^(?:united\s+kingdom|uk|great\s+britain|england|scotland|wales|northern\s+ireland|ireland|france|germany|united\s+states|usa)$/i.test(value)) break;
          }
          if (lines.length < 2) continue;
          const postcodeLine = lines.findIndex(line => ukPostcode.test(line));
          const postcode = postcodeLine < 0 ? '' : lines[postcodeLine].match(ukPostcode)[0].toUpperCase().replace(/\s/g, '').replace(/(.{3})$/, ' $1');
          const countryLine = lines.findIndex(line => /^(?:united\s+kingdom|uk|great\s+britain|england|scotland|wales|northern\s+ireland|ireland|france|germany|united\s+states|usa)$/i.test(line));
          const address = {lines:lines.filter((_, k) => k !== countryLine).map(line => postcode ? line.replace(ukPostcode, '').trim().replace(/,$/, '') : line).filter(Boolean), city:'', region:'', postcode, country:countryLine >= 0 ? lines[countryLine] : postcode ? 'United Kingdom' : ''};
          const first = lines[0];
          const company = /[\p{L}]/u.test(first) && !/^\d|^(?:unit|building|warehouse|floor|suite|c\/o|attn|attention)\b/i.test(first) && !ukPostcode.test(first) ? first : '';
          const entry = {company, address};
          if (!found.some(old => JSON.stringify(old.address) === JSON.stringify(address))) found.push(entry);
        }
      }
    }
    return found;
  }

  function purchaseOrderReferences(pages) {
    const values = [];
    const labelled = /\b(?:purchase\s+order(?:\s+(?:number|no\.?|ref(?:erence)?))?|p\.?\s*o\.?(?:\s+(?:number|no\.?|ref(?:erence)?))?)\s*[:#]\s*([A-Z0-9][A-Z0-9._/-]*)(?=\s|$)/i;
    const heading = /^(?:purchase\s+order\s+(?:number|no\.?|ref(?:erence)?)|p\.?\s*o\.?(?:\s+(?:number|no\.?|ref(?:erence)?))?)\s*[:#]?\s*$/i;
    for (const rows of pages || []) {
      for (const [index, cells] of rows.entries()) {
        const inline = labelled.exec(cells.map(cell => cell.text).join(' '));
        if (inline) { values.push(inline[1]); continue; }
        for (const [column, cell] of cells.entries()) {
          if (!heading.test(cell.text.trim())) continue;
          const next = cells.slice(column + 1).find(part => part.text.trim() !== ':');
          const below = rows[index + 1]?.find(part => Math.abs(part.x - cell.x) < 50);
          const value = (next?.text || below?.text || '').trim().replace(/^[:#]\s*/, '');
          if (itemCode.test(value) && /\d/.test(value)) values.push(value);
        }
      }
    }
    return [...new Set(values)];
  }

  root.WSCBatchOCR = Object.freeze({readPage, productRows, purchaseOrderRows, deliveryAddresses, purchaseOrderReferences, textRows});
})(typeof window === 'undefined' ? globalThis : window);
