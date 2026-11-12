(function (root) {
  'use strict';

  // PandP Data guide, with capacities for each box and goods-weight ranges in grams.
  const types = ['bottles', 'blue', 'black'];
  const labels = {bottles: 'bottles', blue: 'blue kits', black: 'large black kits'};
  const weights = {bottles: [32, 40], blue: [700, 900], black: [1000, 1800]};
  const dimensions = {
    Poolcase: [22, 24, 10], Red: [26, 21, 16], Blue: [23, 23, 23], Green: [31, 23, 23],
    Orange: [33, 26, 32], Yellow: [43, 32, 27], Grey: [43, 24, 37], Purple: [51, 38, 36],
    Pink: [61, 31, 46], 'iDip Box': [50, 33, 55], K7: [45, 35, 11], 'Black Case': [62, 37, 53]
  };
  const kitGuides = bands => bands.flatMap(([end, name], index) => {
    const previous = bands[index - 1]?.[0] || 0;
    return Array.from({length: end - previous}, (_, offset) => [String(previous + offset + 1), name]);
  });
  const guides = {
    bottles: [['25', 'Poolcase'], ['36', 'Red'], ['40', 'Blue'], ['50', 'Blue'], ['60', 'Blue'],
      ['80', 'Green'], ['130', 'Orange'], ['200 SW', 'Yellow'], ['200 DW', 'Grey'], ['360', 'Purple'], ['400', 'Pink']],
    blue: kitGuides([[2, 'Green'], [4, 'Orange'], [5, 'Yellow'], [8, 'Purple'], [12, 'iDip Box'], [25, 'Pink']]),
    black: kitGuides([[1, 'K7'], [2, 'Orange'], [4, 'Grey'], [7, 'Purple'], [14, 'Black Case']])
  };
  const maxBoxes = 25;
  const mediumDimensions = [61, 46, 46];
  const isUK = country => country === 'GBR' || country === 'IMN';
  const weightLimit = country => ['CUB', 'GMB', 'CYM'].includes(country) ? 10000 : 20000;
  const fits = (sides, limits) => sides.every((side, i) => side <= limits[i]);
  const sortedSides = sides => [...sides].sort((a, b) => b - a);

  const boxes = Object.entries(dimensions).map(([name, sides]) => {
    const capacity = Object.fromEntries(types.map(type => [type, Math.max(0, ...guides[type]
      .filter(row => row[1] === name).map(row => parseInt(row[0], 10)))]));
    const [length, width, height] = sides;
    // There are no measured empty-box weights in the guide. Allow 0.9 kg/m²
    // for carton and filler, rounded up to the next 100 g.
    const packingGrams = Math.ceil(2 * (length * width + length * height + width * height) * 0.0009) * 100;
    return {name, sides, capacity, packingGrams, volume: length * width * height};
  }).filter(box => fits(sortedSides(box.sides), mediumDimensions));

  const priorities = [types, ['bottles', 'black', 'blue'], ['blue', 'bottles', 'black'],
    ['blue', 'black', 'bottles'], ['black', 'bottles', 'blue'], ['black', 'blue', 'bottles']];

  function goodsWeight(counts) {
    if (counts.some(n => !Number.isSafeInteger(n) || n < 0)) return null;
    return [0, 1].map(end => counts.reduce((total, n, i) => total + n * weights[types[i]][end], 0) / 1000);
  }

  function contents(counts) {
    return types.filter(type => counts[type]).map(type => {
      const quantity = counts[type], label = labels[type];
      return quantity + ' ' + (quantity === 1 ? label.slice(0, -1) : label);
    }).join(' · ');
  }

  function fillBox(box, remaining, gramsLimit) {
    let space = 1;
    let grams = box.packingGrams;
    const assigned = remaining.map(item => {
      const capacity = box.capacity[item.type];
      if (!capacity) return 0;
      const count = Math.min(item.quantity, Math.floor(space * capacity + 1e-8),
        Math.floor((gramsLimit - grams) / item.grams));
      space -= count / capacity;
      grams += count * item.grams;
      return count;
    });
    return {box, grams, assigned};
  }

  function suggest(lines, country = '') {
    if (!lines.length || lines.some(line => !types.includes(line.type) ||
      !Number.isSafeInteger(line.quantity) || line.quantity <= 0)) return [];

    const limit = weightLimit(country);
    const grouped = new Map();
    for (const line of lines) {
      const grams = line.grams || weights[line.type][1];
      if (!Number.isSafeInteger(grams) || grams <= 0 || grams >= limit) return [];
      const key = line.type + ':' + grams;
      const group = grouped.get(key) || {type: line.type, quantity: 0, grams};
      group.quantity += line.quantity;
      grouped.set(key, group);
    }
    const products = [...grouped.values()];
    if (products.reduce((total, item) => total + item.quantity * item.grams, 0) > limit * maxBoxes) return [];

    const largest = Object.fromEntries(types.map(type => [type, Math.max(...boxes.map(box => box.capacity[type]))]));
    let best = [], bestVolume = Infinity;
    for (const priority of products.every(item => item.type === products[0].type) ? [types] : priorities) {
      const remaining = products.map(item => ({...item})).sort((a, b) =>
        priority.indexOf(a.type) - priority.indexOf(b.type) || b.grams - a.grams);
      const plan = [];
      let volume = 0;
      while (remaining.some(item => item.quantity > 0) && plan.length < (best.length || maxBoxes)) {
        const candidates = boxes.map(box => fillBox(box, remaining, limit));
        const complete = candidates.filter(candidate =>
          candidate.assigned.every((count, i) => count === remaining[i].quantity));
        const score = candidate => candidate.assigned.reduce((sum, count, i) =>
          sum + count / largest[remaining[i].type], 0);
        const chosen = complete.length
          ? complete.sort((a, b) => a.box.volume - b.box.volume)[0]
          : candidates.sort((a, b) => score(b) - score(a) || a.box.volume - b.box.volume)[0];
        if (!chosen.assigned.some(Boolean)) break;
        const counts = {};
        chosen.assigned.forEach((count, i) => {
          remaining[i].quantity -= count;
          if (count) counts[remaining[i].type] = (counts[remaining[i].type] || 0) + count;
        });
        plan.push({name: chosen.box.name, dimensions: [...chosen.box.sides], weight: chosen.grams / 1000, counts});
        volume += chosen.box.volume;
      }
      if (remaining.some(item => item.quantity > 0)) continue;
      if (!best.length || plan.length < best.length || (plan.length === best.length && volume < bestVolume)) {
        best = plan;
        bestVolume = volume;
      }
    }
    return best;
  }

  function suggestFormat(sizes, weight, country) {
    if (sizes.length !== 3 || sizes.some(side => !Number.isFinite(side) || side <= 0) ||
        !Number.isFinite(weight) || weight <= 0 || !/^[A-Z]{3}$/.test(country)) {
      return {format: '', message: 'Enter the parcel dimensions, packed weight and delivery country.'};
    }
    const sides = sortedSides(sizes), uk = isUK(country);
    let format = '';
    if (weight * 1000 > weightLimit(country)) {
      return {format, message: 'This parcel exceeds the weight limit for the destination. Check the weight or split the contents.'};
    }
    if (fits(sides, [24, 16.5, 0.5]) && weight <= 0.1) format = 'Letter';
    else if (fits(sides, [35.3, 25, 2.5]) && weight <= (uk ? 1 : 0.75)) format = 'LargeLetter';
    else if (weight <= 2 && (uk ? fits(sides, [45, 35, 16]) :
      sides[0] <= 60 && sides.reduce((sum, side) => sum + side, 0) < 90)) format = 'SmallParcel';
    else if (fits(sides, mediumDimensions)) format = 'MediumParcel';

    const message = format ? 'Suggested from the parcel dimensions, weight and destination.' :
      'No standard Royal Mail format fits these dimensions and weight.';
    return {format, message};
  }

  // Explicit bottle and strip products from the shipping catalogue. A weight
  // below the PandP allowance never reduces the estimated goods weight.
  const bottleSkus = {
    45: '480001 480002-BU 480005 480009 480014 480015 480018 480022 480023 480024 480025 480031 480036 480042 480044 480047 480048 480049 480064 480065 480066 480067 480124 480309 481025 481026 481027 481028 481046 481068 481104 481138 481234 481328 481330 481335-BU 481336 481338 481339-BU 481340 481341 481343 481344 481345 481347 481348 481349 486636',
    60: '480008 480010 480026 480033 481015 481652-III 482028 482029 484014 486608 486609 486614 486616 486623 486624 486626 486629 486630 486632 486633 486634 486637 486638 486639 486639-II 486641 486644 486648 486650 486655 486656 486659 486665 486666 486670 486672 486674 486675 486676 486680-II 486682 486810 486814 486818 486821 486823',
    120: '486812'
  };
  const bottleGrams = new Map(Object.entries(bottleSkus).flatMap(([grams, skus]) =>
    skus.split(' ').map(sku => [sku, Number(grams)])));
  const blueKitGrams = {'486201-BT-K': 1100, '486202-K': 1100, '486202-K2': 1400,
    '486203-K': 1100, '486203-K2': 1400};

  function product(sku, name) {
    const code = String(sku).trim().toUpperCase();
    const description = String(name || '').toLowerCase();
    if (bottleGrams.has(code)) return {type: 'bottles', grams: bottleGrams.get(code)};
    if (/\b(?:part of|replacement|refill|label|spare|empty|insert|cap|case only|individual foil|pack of \d+ bottles|bulk pack)\b/.test(description)) return null;
    if (/^48620[1235](?:-BT)?-K(?:2|M2?)?$/.test(code) ||
        (/\bez\b/.test(description) && /\b(?:starter|professional|master|meter|photometer)\b/.test(description) && /\bkit\b/.test(description))) {
      return {type: 'blue', grams: blueKitGrams[code] || weights.blue[1]};
    }
    if (/^(?:481300|481396|485201(?:-100)?|486691-K|486798-K|486700-BT-?(?:K|KP|MA|AQ|WD2?))$/.test(code) ||
        (/\b(?:arsenic|micro\s+(?:7\+|20\b|meter\b|photometer\b))/.test(description) && /\bkit\b/.test(description))) {
      return {type: 'black', grams: weights.black[1]};
    }
    if (code === '480011' || /\bbottle of (?:25|50|100)\b/.test(description)) return {type: 'bottles', grams: weights.bottles[1]};
    return null;
  }


  // ISO 3166-1 alpha-2 followed by alpha-3. QuickBooks can use either or a country name.
  const isoCountries = `
    ADAND AEARE AFAFG AGATG AIAIA ALALB AMARM AOAGO AQATA ARARG ASASM ATAUT AUAUS AWABW
    AXALA AZAZE BABIH BBBRB BDBGD BEBEL BFBFA BGBGR BHBHR BIBDI BJBEN BLBLM BMBMU BNBRN
    BOBOL BQBES BRBRA BSBHS BTBTN BVBVT BWBWA BYBLR BZBLZ CACAN CCCCK CDCOD CFCAF CGCOG
    CHCHE CICIV CKCOK CLCHL CMCMR CNCHN COCOL CRCRI CUCUB CVCPV CWCUW CXCXR CYCYP CZCZE
    DEDEU DJDJI DKDNK DMDMA DODOM DZDZA ECECU EEEST EGEGY EHESH ERERI ESESP ETETH FIFIN
    FJFJI FKFLK FMFSM FOFRO FRFRA GAGAB GBGBR GDGRD GEGEO GFGUF GGGGY GHGHA GIGIB GLGRL
    GMGMB GNGIN GPGLP GQGNQ GRGRC GSSGS GTGTM GUGUM GWGNB GYGUY HKHKG HMHMD HNHND HRHRV
    HTHTI HUHUN IDIDN IEIRL ILISR IMIMN ININD IOIOT IQIRQ IRIRN ISISL ITITA JEJEY JMJAM
    JOJOR JPJPN KEKEN KGKGZ KHKHM KIKIR KMCOM KNKNA KPPRK KRKOR KWKWT KYCYM KZKAZ LALAO
    LBLBN LCLCA LILIE LKLKA LRLBR LSLSO LTLTU LULUX LVLVA LYLBY MAMAR MCMCO MDMDA MEMNE
    MFMAF MGMDG MHMHL MKMKD MLMLI MMMMR MNMNG MOMAC MPMNP MQMTQ MRMRT MSMSR MTMLT MUMUS
    MVMDV MWMWI MXMEX MYMYS MZMOZ NANAM NCNCL NENER NFNFK NGNGA NINIC NLNLD NONOR NPNPL
    NRNRU NUNIU NZNZL OMOMN PAPAN PEPER PFPYF PGPNG PHPHL PKPAK PLPOL PMSPM PNPCN PRPRI
    PSPSE PTPRT PWPLW PYPRY QAQAT REREU ROROU RSSRB RURUS RWRWA SASAU SBSLB SCSYC SDSDN
    SESWE SGSGP SHSHN SISVN SJSJM SKSVK SLSLE SMSMR SNSEN SOSOM SRSUR SSSSD STSTP SVSLV
    SXSXM SYSYR SZSWZ TCTCA TDTCD TFATF TGTGO THTHA TJTJK TKTKL TLTLS TMTKM TNTUN TOTON
    TRTUR TTTTO TVTUV TWTWN TZTZA UAUKR UGUGA UMUMI USUSA UYURY UZUZB VAVAT VCVCT VEVEN
    VGVGB VIVIR VNVNM VUVUT WFWLF WSWSM YEYEM YTMYT ZAZAF ZMZMB ZWZWE
  `.trim().split(/\s+/);
  let countryNames;
  const countryKey = value => String(value || '').normalize('NFD').toLowerCase().replace(/[^a-z0-9]/g, '');

  function countryCode(value) {
    if (!countryNames) {
      const names = new Intl.DisplayNames(['en-GB'], {type: 'region'});
      countryNames = new Map();
      for (const pair of isoCountries) {
        const short = pair.slice(0, 2), long = pair.slice(2);
        for (const name of [short, long, names.of(short)]) countryNames.set(countryKey(name), long);
      }
      for (const [name, code] of Object.entries({
        uk: 'GBR', greatbritain: 'GBR', unitedkingdomofgreatbritainandnorthernireland: 'GBR',
        england: 'GBR', scotland: 'GBR', wales: 'GBR', northernireland: 'GBR', britain: 'GBR',
        unitedstatesofamerica: 'USA', czechrepublic: 'CZE', turkey: 'TUR', republicofireland: 'IRL',
        macedonia: 'MKD', vaticancity: 'VAT', republicofkorea: 'KOR'
      })) countryNames.set(name, code);
    }
    return countryNames.get(countryKey(value)) || '';
  }

  function countryFromPostcode(value) {
    const postcode = String(value || '').replace(/\s+/g, '').toUpperCase();
    if (!/^(?:GIR0AA|[A-PR-UWYZ][A-HK-Y]?\d[\dA-Z]?\d[ABD-HJLNP-UW-Z]{2})$/.test(postcode)) return '';
    return {GY: 'GGY', JE: 'JEY', IM: 'IMN'}[postcode.slice(0, 2)] || 'GBR';
  }

  async function lookupParcelPrices(queries, request, beforeParcel) {
    const prices = new Map();
    const results = [];
    for (const [index, query] of queries.entries()) {
      if (beforeParcel(index) === false) return null;
      const key = JSON.stringify(query);
      if (!prices.has(key)) prices.set(key, await request(query));
      results.push(prices.get(key));
    }
    return results;
  }

  root.WSCPacking = Object.freeze({types, labels, guides, dimensions, maxBoxes, goodsWeight, contents,
    suggest, suggestFormat, product, countryCode, countryFromPostcode, isUK, lookupParcelPrices});
})(window);
