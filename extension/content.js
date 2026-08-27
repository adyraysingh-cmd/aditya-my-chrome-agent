(() => {
  const state = { counter: 0, map: new Map() };

  function visible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  }

  function label(el) {
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.innerText?.trim() ||
      el.value ||
      el.placeholder ||
      el.name ||
      el.id ||
      ''
    ).replace(/\s+/g, ' ').slice(0, 180);
  }

  function selectorId(el) {
    state.counter += 1;
    const id = `oa-${state.counter}`;
    state.map.set(id, el);
    el.setAttribute('data-openai-autopilot-id', id);
    return id;
  }

  function snapshot() {
    state.map.clear();
    state.counter = 0;
    const selectors = 'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]';
    const elements = [...document.querySelectorAll(selectors)]
      .filter(el => visible(el))
      .slice(0, 250)
      .map(el => ({
        id: selectorId(el),
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || null,
        label: label(el),
        disabled: !!el.disabled,
        href: el.href || null
      }));

    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 12000),
      elements
    };
  }

  function fireInput(el, value) {
    el.focus();
    if ('value' in el) {
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value); else el.value = value;
    } else {
      el.textContent = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function execute(action) {
    if (!action?.action) throw new Error('Missing action');
    if (action.action === 'navigate') {
      const url = new URL(action.url, location.href).href;
      location.href = url;
      return { ok: true, message: `Navigating to ${url}` };
    }
    if (action.action === 'scroll') {
      const amount = Number(action.amount || 600);
      window.scrollBy({ top: amount, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 700));
      return { ok: true, message: `Scrolled ${amount}px` };
    }
    if (action.action === 'wait') {
      const amount = Math.min(Math.max(Number(action.amount || 1000), 0), 5000);
      await new Promise(r => setTimeout(r, amount));
      return { ok: true, message: 'Wait completed' };
    }

    const el = state.map.get(action.elementId);
    if (!el || !document.contains(el)) throw new Error(`Element ${action.elementId} is no longer available`);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 250));

    if (action.action === 'click') {
      if (el.disabled) throw new Error('Target element is disabled');
      el.click();
      return { ok: true, message: `Clicked: ${label(el)}` };
    }
    if (action.action === 'type') {
      if (el.disabled) throw new Error('Target element is disabled');
      fireInput(el, String(action.text ?? ''));
      return { ok: true, message: `Typed into: ${label(el)}` };
    }
    throw new Error(`Unsupported action ${action.action}`);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'snapshot') {
      sendResponse({ ok: true, snapshot: snapshot() });
      return false;
    }
    if (message?.type === 'execute') {
      execute(message.action)
        .then(result => sendResponse({ ...result, snapshot: snapshot() }))
        .catch(error => sendResponse({ ok: false, message: error.message, snapshot: snapshot() }));
      return true;
    }
  });
})();
