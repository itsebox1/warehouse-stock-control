(() => {
  'use strict';

  const byId = suffix => document.getElementById('wscPdfAdmin' + suffix);
  const launch = byId('Open');
  const dialog = byId('Dialog');
  const list = byId('List');
  const form = byId('Form');
  const fieldset = form.querySelector('fieldset');
  const saveButton = form.querySelector('[type="submit"]');
  const mode = byId('Mode');
  const schedule = byId('Schedule');
  const day = byId('Day');
  const time = byId('Time');
  const start = byId('Start');
  const end = byId('End');
  const status = byId('Status');
  const reload = byId('Reload');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  days.forEach((name, index) => day.add(new Option(name, String(index))));

  let session = 0;
  let editing = null;
  let pendingSave = null;

  function canManage() {
    return String(window.getCurrentStaffEmail?.() || '').trim().toLowerCase() === 'tmerry@sensafe.com'
      && window.wscHasUnlockedSession?.() === true
      && wscPermissions?.admin === true
      && wscPermissionEmail === 'tmerry@sensafe.com';
  }

  function cleanup() {
    ++session;
    editing = null;
    list.replaceChildren();
    list.hidden = false;
    form.reset();
    form.hidden = true;
    fieldset.disabled = saveButton.disabled = false;
    byId('Cancel').disabled = false;
    reload.hidden = true;
    status.textContent = '';
    dialog.removeAttribute('aria-busy');
  }

  function dismiss() {
    if (dialog.open) dialog.close();
    cleanup();
  }

  window.wscPdfAdminDismiss = dismiss;
  window.wscPdfAdminRefreshAccess = () => {
    launch.hidden = !canManage();
    if (launch.hidden && dialog.open) dismiss();
  };

  function stillOpen(token) {
    if (token !== session || !dialog.open) return false;
    if (canManage() && document.getElementById('wscAdminPanel').style.display === 'block') return true;
    dismiss();
    return false;
  }

  function optionLabel(doc) {
    return doc.options.find(option => option.value === doc.mode)?.label || doc.mode;
  }

  function timingLabel(doc) {
    const when = optionLabel(doc);
    if (doc.mode === 'window') return when + ' · Daily ' + doc.startTime + '–' + doc.endTime + ' (UK)';
    if (doc.mode !== 'scheduled' || !days[doc.day] || !doc.time) return when;
    return when + ' · ' + days[doc.day] + ', ' + doc.time + ' (UK)';
  }

  function updateSchedule() {
    const scheduled = mode.value === 'scheduled';
    schedule.hidden = !scheduled;
    day.disabled = time.disabled = !scheduled;
    day.required = time.required = scheduled;
    const duringHours = mode.value === 'window';
    byId('Window').hidden = !duringHours;
    start.disabled = end.disabled = !duringHours;
    start.required = end.required = duringHours;
    checkHours();
  }

  function checkHours() {
    const invalid = mode.value === 'window' && start.value && end.value && start.value >= end.value;
    end.setCustomValidity(invalid ? 'Choose an end time later than the start time.' : '');
  }

  function openEditor(doc) {
    if (!stillOpen(session) || pendingSave) return;
    editing = doc;
    byId('Document').textContent = doc.label;
    const description = byId('Description');
    description.textContent = doc.description || '';
    description.hidden = !doc.description;
    mode.replaceChildren(...doc.options.map(option => new Option(option.label, option.value)));
    mode.value = doc.mode;
    mode.disabled = doc.options.length === 1;
    day.value = Number.isInteger(doc.day) ? String(doc.day) : '';
    time.value = doc.time || '';
    start.value = doc.startTime || '09:00';
    end.value = doc.endTime || '17:00';
    byId('Suspended').checked = doc.suspended;
    updateSchedule();
    list.hidden = true;
    form.hidden = false;
    reload.hidden = true;
    status.textContent = '';
    (mode.disabled ? (schedule.hidden ? byId('Suspended') : day) : mode).focus();
  }

  function backToList(id) {
    editing = null;
    form.hidden = true;
    list.hidden = false;
    list.querySelectorAll('button').forEach(button => {
      if (button.dataset.pdfId === id) button.focus();
    });
  }

  function render({documents}) {
    if (!Array.isArray(documents) || !documents.length) throw new Error('No PDF settings were returned.');
    const sections = new Map();
    const rows = document.createDocumentFragment();
    for (const doc of documents) {
      if (!Array.isArray(doc.options) || !doc.options.some(option => option.value === doc.mode)) {
        throw new Error('WSC returned an unrecognised PDF setting. Reload the list.');
      }
      let group = sections.get(doc.section);
      if (!group) {
        group = document.createElement('section');
        const heading = document.createElement('h3');
        heading.textContent = doc.section;
        group.append(heading);
        sections.set(doc.section, group);
        rows.append(group);
      }
      const row = document.createElement('div');
      row.className = 'wsc-pdf-row';
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = doc.label;
      const when = document.createElement('p');
      when.textContent = timingLabel(doc);
      details.append(title, when);
      if (doc.suspended) {
        const state = document.createElement('p');
        state.className = 'wsc-pdf-suspended';
        state.textContent = 'Suspended';
        details.append(state);
      }
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.dataset.pdfId = doc.id;
      edit.textContent = '✎';
      edit.title = 'Edit ' + doc.label;
      edit.setAttribute('aria-label', edit.title);
      edit.addEventListener('click', () => openEditor(doc));
      row.append(details, edit);
      group.append(row);
    }
    list.replaceChildren(rows);
  }

  async function load() {
    if (!stillOpen(session)) return;
    const token = ++session;
    editing = null;
    list.hidden = false;
    list.replaceChildren();
    form.hidden = reload.hidden = true;
    status.textContent = 'Loading PDF settings…';
    dialog.setAttribute('aria-busy', 'true');
    try {
      // A save can still be finishing when the owner closes and reopens Admin.
      if (pendingSave) await pendingSave.catch(() => {});
      if (!stillOpen(token)) return;
      const result = await window.wscPdfAdminLoad();
      if (!stillOpen(token)) return;
      render(result);
      status.textContent = '';
    } catch (error) {
      if (!stillOpen(token)) return;
      reload.hidden = false;
      status.textContent = error?.message || 'WSC could not load the PDF settings.';
    } finally {
      if (stillOpen(token)) dialog.removeAttribute('aria-busy');
    }
  }

  launch.addEventListener('click', () => {
    if (!canManage() || dialog.open || document.getElementById('wscAdminPanel').style.display !== 'block') return;
    dialog.showModal();
    void load();
  });
  byId('Close').addEventListener('click', dismiss);
  dialog.addEventListener('close', () => { if (!dialog.open) cleanup(); });
  reload.addEventListener('click', load);
  mode.addEventListener('change', updateSchedule);
  start.addEventListener('input', checkHours);
  end.addEventListener('input', checkHours);
  byId('Cancel').addEventListener('click', () => {
    if (editing && !pendingSave) {
      reload.hidden = true;
      status.textContent = '';
      backToList(editing.id);
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const token = session;
    if (!stillOpen(token) || !editing || pendingSave || !form.reportValidity()) return;
    const changes = {id: editing.id, revision: editing.revision, mode: mode.value, suspended: byId('Suspended').checked};
    if (changes.mode === 'scheduled') {
      changes.day = Number(day.value);
      changes.time = time.value;
    } else if (changes.mode === 'window') {
      changes.startTime = start.value;
      changes.endTime = end.value;
    }
    fieldset.disabled = saveButton.disabled = byId('Cancel').disabled = true;
    reload.hidden = true;
    status.textContent = 'Saving PDF settings…';
    dialog.setAttribute('aria-busy', 'true');
    try {
      pendingSave = Promise.resolve(window.wscPdfAdminSave(changes));
      const result = await pendingSave;
      if (!stillOpen(token)) return;
      render(result);
      backToList(changes.id);
      status.textContent = 'Saved.';
    } catch (error) {
      if (!stillOpen(token)) return;
      reload.hidden = false;
      status.textContent = error?.message || 'WSC could not confirm the save. Reload to check the current settings.';
    } finally {
      pendingSave = null;
      if (stillOpen(token)) {
        fieldset.disabled = saveButton.disabled = byId('Cancel').disabled = false;
        dialog.removeAttribute('aria-busy');
      }
    }
  });
})();
