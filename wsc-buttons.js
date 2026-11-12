(() => {
  const buttonSelector = 'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]';
  const pressDuration = 220;
  const recentlyPressed = new WeakSet();

  document.addEventListener('click', event => {
    if (!event.isTrusted) return;

    const button = event.target.closest?.(buttonSelector);
    if (!button || button.matches(':disabled, [aria-disabled="true"]')) return;

    // Keep the first click synchronous so it can open a picker, dialog or tab.
    if (recentlyPressed.has(button)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    recentlyPressed.add(button);
    button.classList.add('wsc-button-pressed');
    window.setTimeout(() => {
      recentlyPressed.delete(button);
      button.classList.remove('wsc-button-pressed');
    }, pressDuration);
  }, {capture: true});
})();
