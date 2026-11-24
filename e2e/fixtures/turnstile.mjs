export const turnstileEnv = { TURNSTILE_SECRET_KEY: 'synthetic-turnstile-secret' };
export const validCaptchaToken = () => `synthetic-captcha-${crypto.randomUUID()}`;
export const captchaPrivateValues = /synthetic-turnstile-secret|synthetic-captcha-/;

// Browser stand-in for the public Turnstile API, installed by the browser test only.
function browserWidget(automatic) {
  const widgets = new Map();
  let sequence = 0;
  function respond(widget, type, token = `synthetic-captcha-${crypto.randomUUID()}`) {
    if (!widgets.has(widget.id)) return;
    if (type === 'success') widget.options.callback(token);
    else widget.options[`${type}-callback`]();
  }
  function maybeResolve(widget) {
    if (automatic) setTimeout(() => respond(widget, 'success'), 0);
  }
  window.fixtureTurnstile = { widgets, respond };
  window.turnstile = {
    render(container, options) {
      const id = String(++sequence);
      const iframe = document.createElement('iframe');
      iframe.title = 'Synthetic Turnstile';
      iframe.style.cssText = 'display:block;width:100%;height:100%;border:0';
      container.append(iframe);
      const widget = { id, container, iframe, options };
      widgets.set(id, widget);
      maybeResolve(widget);
      return id;
    },
    remove(id) {
      widgets.get(id)?.iframe.remove();
      widgets.delete(id);
    },
    reset(id) { maybeResolve(widgets.get(id)); },
  };
}

export async function stubTurnstile(page, { automatic = true } = {}) {
  let scriptRequests = 0;
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', (route) => {
    scriptRequests++;
    return route.fulfill({ contentType: 'application/javascript', body: `(${browserWidget})(${automatic})` });
  });
  return () => scriptRequests;
}
