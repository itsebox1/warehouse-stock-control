// Outlook can put a picture's CID in HTML but its actual bytes in the RTF clipboard flavour.
window.wscSignatureRtfPictures = function rtfPictures(rtf) {
  if (typeof rtf !== 'string' || !rtf.startsWith('{\\rtf')) return [];
  if (rtf.length > 32 * 1024 * 1024) throw Error('This clipboard selection is too large. Copy just the signature and paste it again.');
  const images = [], groups = [];
  const token = /[{}]|\\(?:([a-zA-Z]+)(-?\d+)? ?|'[0-9a-fA-F]{2}|[\s\S])|[^{}\\]+/gy;
  const maxBytes = 12 * 1024 * 1024;
  let match;
  while ((match = token.exec(rtf))) {
    const raw = match[0], group = groups[groups.length - 1];
    if (raw === '{') {
      if (groups.length >= 256) return images;
      groups.push({skip:group?.skip});
    } else if (raw === '}') {
      if (!group) break;
      groups.pop();
      if (group.skip || !group.type || !group.chunks?.length) continue;
      const hex = group.chunks.join('');
      if (hex.length % 2 || !(group.type === 'png' ? /^89504e470d0a1a0a/i : /^ffd8ff/i).test(hex)) continue;
      // Clipboard pictures describe placements; several placements can share one saved image.
      if (images.length >= 128) throw Error('This selection contains too many pictures. Copy just the signature and paste it again.');
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      const name = 'image' + (images.length + 1) + '.' + (group.type === 'jpeg' ? 'jpg' : 'png');
      images.push(new File([bytes], name, {type:'image/' + group.type}));
    } else if (match[1] === 'bin') {
      const size = Number(match[2]);
      if (!Number.isSafeInteger(size) || size < 0 || size > rtf.length - token.lastIndex) return images;
      // Binary-mode RTF is lossy in a text clipboard. Skip its raw bytes without reading braces as groups.
      if (group) group.skip = true;
      token.lastIndex += size;
    } else if (!group || group.skip) {
      continue;
    } else if (match[1] === 'nonshppict' || match[1] === 'object') {
      group.skip = true;
    } else if (match[1] === 'pict') {
      group.chunks = [];
      group.length = 0;
    } else if (group.chunks && (match[1] === 'pngblip' || match[1] === 'jpegblip')) {
      group.type = match[1] === 'pngblip' ? 'png' : 'jpeg';
    } else if (group.chunks && group.type && raw[0] !== '\\') {
      const digits = raw.replace(/\s+/g, '');
      group.length += digits.length;
      if (/[^\da-f]/i.test(digits) || group.length > 2 * maxBytes) {
        group.skip = true;
        group.chunks = null;
      } else if (digits) group.chunks.push(digits);
    }
  }
  return images;
};
