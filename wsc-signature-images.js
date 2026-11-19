// Embedded signature images travel separately from the formatted text.
window.wscSignatureImages = (() => {
  const maxBytes = 192 * 1024;
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
  async function fit(url) {
    const imageAsset = asset(url);
    if (!imageAsset) throw Error('Choose a valid PNG, JPEG or GIF.');
    if (bytes(imageAsset.base64) <= maxBytes) return url;
    if (imageAsset.mimeType === 'image/gif') throw Error('Choose a smaller GIF (up to 192 KB).');
    const img = new Image();
    await new Promise((resolve,reject) => {
      img.onload = resolve;
      img.onerror = () => reject(Error('Could not open this image. Choose a PNG or JPEG.'));
      img.src = url;
    });
    let scale = Math.min(1,1000/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas = document.createElement('canvas');
    for (let attempt=0;attempt<8;attempt++,scale*=0.75) {
      canvas.width = Math.max(1,Math.round(img.naturalWidth*scale));
      canvas.height = Math.max(1,Math.round(img.naturalHeight*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const smaller = canvas.toDataURL(imageAsset.mimeType,0.85);
      const candidate = asset(smaller);
      if (candidate && bytes(candidate.base64)<=maxBytes) return smaller;
    }
    throw Error('Choose a smaller signature image.');
  }
  function pack(url, assets) {
    const image = asset(url);
    if (!image || bytes(image.base64)>maxBytes) throw Error('Choose a smaller PNG, JPEG or GIF.');
    let existing = assets.find(a => a.mimeType === image.mimeType && a.base64 === image.base64);
    if (!existing) {
      const total = assets.reduce((sum,a)=>sum+bytes(a.base64),bytes(image.base64));
      if (assets.length>=4 || total>384*1024) throw Error('Use up to four images totalling 384 KB per signature.');
      existing = {...image,cid:'wsc-signature-'+(assets.length+1)};
      assets.push(existing);
    }
    return 'cid:'+existing.cid;
  }
  function readFiles(clipboard) {
    const files = Array.from(clipboard.files || []).filter(f=>f.type.startsWith('image/'));
    if (files.length) return files;
    return Array.from(clipboard.items || []).filter(i=>i.kind==='file' && i.type.startsWith('image/'))
      .map(i=>i.getAsFile()).filter(Boolean);
  }
  return {asset,bytes,maxBytes,pack,fit,fromFile,readFiles};
})();
