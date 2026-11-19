// Embedded signature images travel separately from the formatted text.
window.wscSignatureImages = (() => {
  const maxBytes = 192 * 1024;
  const totalBudget = 384 * 1024;
  const maxPictures = 24;
  const raster = /^data:(image\/(?:png|jpeg|gif));base64,([A-Za-z0-9+/]+={0,2})$/i;
  function asset(url) {
    const match = raster.exec(url);
    if (!match || match[2].length % 4) return null;
    const mimeType = match[1].toLowerCase(), base64 = match[2];
    const head = atob(base64.slice(0,16));
    if (mimeType === 'image/png' && !head.startsWith('\x89PNG\r\n\x1a\n') ||
        mimeType === 'image/jpeg' && !head.startsWith('\xff\xd8\xff') ||
        mimeType === 'image/gif' && !/^GIF8[79]a/.test(head)) return null;
    return {mimeType,base64};
  }
  const bytes = base64 => base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  function fromFile(file) {
    if (!/^image\/(png|jpeg|gif)$/i.test(file.type) || file.size > 12 * 1024 * 1024)
      throw Error('Choose a PNG, JPEG or GIF smaller than 12 MB.');
    return new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error('Could not read the image. Choose it again.'));
      reader.readAsDataURL(file);
    });
  }
  function animated(image) {
    if (image.mimeType === 'image/jpeg') return false;
    const data = atob(image.base64);
    if (image.mimeType === 'image/png') {
      // APNG declares its animation before the first image-data chunk.
      for (let pos=8; pos+12<=data.length;) {
        const type = data.slice(pos+4,pos+8);
        if (type === 'acTL') return true;
        if (type === 'IDAT' || type === 'IEND') return false;
        const size = data.charCodeAt(pos)*16777216 + data.charCodeAt(pos+1)*65536 +
          data.charCodeAt(pos+2)*256 + data.charCodeAt(pos+3);
        pos += size+12;
      }
      return false;
    }
    // Count frame descriptors, skipping colour tables and LZW/extension sub-blocks.
    const byte = i => data.charCodeAt(i);
    const table = flags => flags & 128 ? 3 * (2 << (flags & 7)) : 0;
    let i = 13 + table(byte(10)), frames = 0;
    while (i<data.length) {
      const block = byte(i++);
      if (block === 0x3b) return false;
      if (block === 0x2c) {
        if (++frames > 1) return true;
        i += 10 + table(byte(i+8));
      } else if (block === 0x21) i++;
      else return true;
      while (i<data.length && byte(i)) i += 1 + byte(i);
      i++;
    }
    return true;
  }
  async function fit(url, budget = maxBytes, dimensions, active = () => true) {
    const source = asset(url);
    if (!source) throw Error('Choose a valid PNG, JPEG or GIF.');
    if (bytes(source.base64) <= budget) return url;
    if (animated(source)) throw Error('Use a smaller version of the animated picture (up to 192 KB each).');
    const img = new Image();
    await new Promise((resolve,reject) => {
      img.onload = resolve;
      img.onerror = () => reject(Error('Could not open this picture. Choose a PNG, JPEG or GIF.'));
      img.src = url;
    });
    if (!active()) throw Error('The signature editor has closed.');
    dimensions?.(img.naturalWidth,img.naturalHeight);
    let scale = Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas = document.createElement('canvas');
    // Keep transparent backgrounds, including when converting a static GIF to PNG.
    const mime = source.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    let opaque;
    while (scale > 0) {
      canvas.width = Math.max(1,Math.round(img.naturalWidth*scale));
      canvas.height = Math.max(1,Math.round(img.naturalHeight*scale));
      const context=canvas.getContext('2d');
      context.imageSmoothingQuality='high';
      context.drawImage(img,0,0,canvas.width,canvas.height);
      let candidate = canvas.toDataURL(mime,0.88);
      let size = bytes(candidate.slice(candidate.indexOf(',')+1));
      if (size<=budget) return candidate;
      if (mime === 'image/png') {
        if (opaque === undefined) {
          opaque=true;
          const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
          for (let i=3;i<pixels.length;i+=4) if (pixels[i]!==255) { opaque=false; break; }
        }
        if (opaque) {
          const jpeg=canvas.toDataURL('image/jpeg',0.88);
          const jpegSize=bytes(jpeg.slice(jpeg.indexOf(',')+1));
          if (jpegSize<=budget) return jpeg;
          size=Math.min(size,jpegSize);
        }
      }
      if (Math.max(canvas.width,canvas.height)<=16) break;
      scale *= Math.max(0.35,Math.min(0.85,0.94*Math.sqrt(budget/size)));
    }
    throw Error('These pictures exceed the signature storage allowance. Use a smaller version of the largest picture and save again.');
  }
  function pack(url, assets) {
    const image = asset(url);
    if (!image || bytes(image.base64)>maxBytes) throw Error('Choose a smaller PNG, JPEG or GIF.');
    let existing = assets.find(a => a.mimeType === image.mimeType && a.base64 === image.base64);
    if (!existing) {
      if (assets.length >= maxPictures) throw Error('This signature contains more than 24 different embedded pictures. Remove one or combine related icons into one picture before saving.');
      existing = {...image,cid:'wsc-signature-'+(assets.length+1)};
      assets.push(existing);
    }
    return 'cid:'+existing.cid;
  }
  function needsFit(assets) {
    return assets.reduce((sum,image) => sum + bytes(image.base64),0) > totalBudget;
  }
  async function fitCollection(assets, active) {
    const fitted = assets.slice(), dimensions = new Map();
    const rows = assets.map((image,index) => ({image,index,size:bytes(image.base64)}));
    const editable = rows.filter(row => !animated(row.image)).sort((a,b)=>b.size-a.size);
    let total = rows.reduce((sum,row) => sum+row.size,0);
    let allowance = totalBudget - total + editable.reduce((sum,row) => sum+row.size,0);
    for (let n=0; n<editable.length && total>totalBudget; n++) {
      if (!active()) throw Error('The signature editor has closed.');
      // Reserve each small icon's full original bytes, then share the rest among the larger pictures.
      let large = editable.length-n, available = allowance;
      for (let i=editable.length-1; i>=n && editable[i].size<=available/large; i--) {
        available -= editable[i].size; large--;
      }
      const budget = Math.floor(available/large);
      if (budget < 1) break;
      const {image,index,size} = editable[n];
      const url=await fit('data:'+image.mimeType+';base64,'+image.base64,budget,
        (width,height)=>dimensions.set(image.cid,{width,height}),active);
      const result=asset(url);
      fitted[index]={...result,cid:image.cid};
      const actual=bytes(result.base64);
      total += actual-size;
      allowance -= actual;
    }
    if (total>totalBudget) throw Error('The animated pictures leave too little space for this signature. Use a smaller version of an animated picture and save again.');
    return {images:fitted, dimensions};
  }
  function readFiles(clipboard) {
    const files = Array.from(clipboard.files || []).filter(f=>f.type.startsWith('image/'));
    if (files.length) return files;
    return Array.from(clipboard.items || []).filter(i=>i.kind==='file' && i.type.startsWith('image/'))
      .map(i=>i.getAsFile()).filter(Boolean);
  }
  return {asset,bytes,maxBytes,pack,fit,needsFit,fitCollection,fromFile,readFiles};
})();
