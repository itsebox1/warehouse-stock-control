// Read the current server policy for each PDF action, including actions in WSC's order screens.
(() => {
  'use strict';

  function sessionEmail() {
    if (!window.wscHasUnlockedSession?.()) throw new Error('Unlock WSC to use PDFs.');
    const email = String(window.getCurrentStaffEmail?.() || '').trim().toLowerCase();
    if (!email) throw new Error('Sign in to use PDFs.');
    return email;
  }

  async function request(field, payload, ownerOnly = false) {
    const email = sessionEmail();
    if (ownerOnly && email !== 'tmerry@sensafe.com') throw new Error('Owner access is required.');
    const result = await wscAdminRequest('getWSCPermissions', {[field]: payload},
      field === 'pdfFileRequest' ? 90000 : 25000);
    if (sessionEmail() !== email) throw new Error('The WSC staff account changed. Open the PDF again.');
    return result;
  }

  async function settings(payload) {
    const result = await request('pdfAdminRequest', payload, true);
    if (!Array.isArray(result.pdfAdmin?.documents) || !result.pdfAdmin.documents.length) {
      throw new Error('The PDF settings service is unavailable. Reload to try again.');
    }
    return result.pdfAdmin;
  }
  window.wscPdfAdminLoad = () => settings({op: 'list'});
  window.wscPdfAdminSave = changes => settings({...changes, op: 'save'});

  function showUnavailable(message) {
    if (!document.querySelector('dialog[open]')) {
      window.showWSCMessage('PDF unavailable', escapeHtml(message));
      return;
    }
    // A message in the document body would sit behind the current modal.
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'PDF unavailable');
    const title = document.createElement('h2');
    title.textContent = 'PDF unavailable';
    const detail = document.createElement('p');
    detail.textContent = message;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'OK';
    button.onclick = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove(), {once: true});
    dialog.append(title, detail, button);
    document.body.append(dialog);
    dialog.showModal();
  }

  window.wscPdfAllowed = async (id, context = 'request', {silent = false} = {}) => {
    try {
      const result = await request('pdfAccessRequest', {id, context});
      if (result.pdfAccess?.allowed !== true) {
        throw new Error(result.pdfAccess?.message || 'PDF availability could not be confirmed.');
      }
      return true;
    } catch (error) {
      if (!silent && window.wscHasUnlockedSession?.()) {
        showUnavailable(String(error.message || 'Try again.'));
      }
      return false;
    }
  };

  window.wscPdfFile = async (id, reportNumber) => {
    const result = await request('pdfFileRequest', {id, ...(reportNumber ? {reportNumber} : {})});
    if (!result.pdfBase64 || typeof result.filename !== 'string') {
      throw new Error('The PDF could not be retrieved.');
    }
    return result;
  };
})();
