import { api, html, raw, toHTML, toast, fail, modal, el, $ } from '../lib.js';

import { t, getLang, setLang } from '../i18n.js';

// Contatos exibidos na capa (Instagram do escritório e dos sócios, WhatsApp)
const IG = ['carlaeirineuarquitetura', 'carlanogueirabarbosa', 'irineujuniorarquiteto'];
const igIcon = raw('<svg class="icon" viewBox="0 0 24 24" aria-label="Instagram"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none"/></svg>');
const waIcon = raw('<svg class="icon" viewBox="0 0 24 24" aria-label="WhatsApp"><path d="M3.6 20.4l1.2-4.3A8.6 8.6 0 1 1 8 19.3z"/><path d="M9 8.3c.2-.5.5-.5.8-.5h.5c.2 0 .4.1.5.4l.7 1.7c.1.2 0 .5-.1.6l-.5.6c-.1.2-.1.4 0 .5.6 1 1.4 1.8 2.4 2.4.2.1.4.1.5 0l.6-.6c.2-.2.4-.2.6-.1l1.7.8c.2.1.3.3.3.5v.4c0 .4-.2.8-.6 1-.6.3-1.4.4-2.2.1a9.4 9.4 0 0 1-5-4.8c-.4-.9-.4-1.9 0-2.6z" fill="currentColor" stroke="none"/></svg>');

// ---------- Estrutura comum das telas de acesso (login, nova senha, primeiro acesso) ----------
function shell(formMarkup) {
  const L = getLang();
  const [s1, s2] = t('slogan');
  return html`<div class="auth">
    <section class="auth-brand">
      <div class="auth-lang" role="group" aria-label="Idioma / Language">
        <button type="button" data-lang="pt" class="${L === 'pt' ? 'on' : ''}" aria-pressed="${L === 'pt'}">PT</button><span aria-hidden="true">|</span>
        <button type="button" data-lang="en" class="${L === 'en' ? 'on' : ''}" aria-pressed="${L === 'en'}">EN</button>
      </div>
      <img class="auth-photo" src="/img/socios.jpg" width="731" height="942" alt="Carla Nogueira e Irineu Junior">
      <span class="auth-veil" aria-hidden="true"></span>
      <div class="auth-brand-inner">
        <img class="auth-logo" src="/logo" width="1016" height="353" alt="Carla Nogueira & Irineu Junior — Arquitetura | Interiores">
        <span class="auth-spacer" aria-hidden="true"></span>
        <p class="auth-slogan"><span>${s1}</span><span>${s2}</span></p>
        <div class="auth-contact">
          <div class="auth-contact-row">${igIcon}${IG.map((h, i) => html`${i ? html`<span class="auth-dot" aria-hidden="true">·</span>` : ''}<a href="https://www.instagram.com/${h}/" target="_blank" rel="noopener" title="Instagram @${h}">@${h}</a>`)}</div>
          <a class="auth-contact-row" href="https://wa.me/5567982077556?text=${encodeURIComponent(t('waMsg'))}" target="_blank" rel="noopener" title="${t('contactWa')}">${waIcon}<span>(67) 98207-7556</span></a>
        </div>
      </div>
    </section>
    <section class="auth-panel"><span class="auth-deco-circle" aria-hidden="true"></span><span class="auth-deco-square" aria-hidden="true"></span>${formMarkup}</section>
  </div>`;
}
function mount(root, markup, rerender) {
  root.innerHTML = toHTML(shell(markup));
  root.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => { if (b.dataset.lang !== getLang()) { setLang(b.dataset.lang); rerender(); } }));
}
const inputIcon = (name) => raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${name === 'mail' ? '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>' : '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'}</svg>`);
const eyeIcon = (off) => raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>${off ? '<path d="M3 3l18 18"/>' : ''}</svg>`);
function bindEye(root) {
  root.querySelectorAll('[data-eye]').forEach((b) => (b.onclick = () => {
    const i = b.parentElement.querySelector('input'); const show = i.type === 'password';
    i.type = show ? 'text' : 'password'; b.innerHTML = toHTML(eyeIcon(!show)); b.setAttribute('aria-label', show ? t('hidePw') : t('showPw'));
  }));
}

export function login(root, done) {
  const prev = root.querySelector('#f [name=email]');
  const keepEmail = prev ? prev.value : '';
  const [n1, n2] = t('clientNote');
  mount(root, html`<form id="f" class="auth-form" novalidate>
    <div class="auth-head"><div class="auth-eyebrow">${t('welcome')}</div><h1>${t('signIn')}</h1></div>
    <div class="auth-field"><label for="lg-email">${t('email')}</label>
      <div class="auth-input">${inputIcon('mail')}<input id="lg-email" type="email" name="email" autocomplete="username" placeholder="${t('emailPh')}" value="${keepEmail}" required></div></div>
    <div class="auth-field"><label for="lg-pw">${t('password')}</label>
      <div class="auth-input">${inputIcon('lock')}<input id="lg-pw" type="password" name="password" autocomplete="current-password" placeholder="••••••••" required>
        <button type="button" class="auth-eye" data-eye aria-label="${t('showPw')}">${eyeIcon(false)}</button></div></div>
    <div class="auth-row"><label class="auth-check"><input type="checkbox" name="remember" checked><span>${t('remember')}</span></label><a href="#" id="forgot">${t('forgot')}</a></div>
    <button class="auth-submit" type="submit"><span>${t('signIn')}</span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
    <p class="auth-note">${n1}<br>${n2}</p>
  </form>`, () => login(root, done));
  bindEye(root);
  const f = $('#f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.email.value.trim() || !f.password.value) { (f.email.value.trim() ? f.password : f.email).focus(); return; }
    const b = f.querySelector('.auth-submit'); b.disabled = true;
    try { await api.post('/auth/login', { email: f.email.value, password: f.password.value, remember: f.remember.checked }); done(); }
    catch (err) { fail(err); b.disabled = false; }
  };
  $('#forgot').onclick = (e) => { e.preventDefault(); forgot(f.email.value); };
}

function forgot(email) {
  modal({ title: t('forgotTitle'), body: html`<p class="muted small" style="margin-top:0">${t('forgotText')}</p><div class="field"><label>${t('email')}</label><input type="email" id="fe" value="${email || ''}"></div>`,
    actions: [{ label: t('cancel') }, { label: t('sendLink'), primary: true, fn: async (m) => { const r = await api.post('/auth/forgot', { email: m.querySelector('#fe').value }); toast(r.message, { ms: 6000 }); } }] });
}

export function reset(root, token) {
  mount(root, html`<form id="f" class="auth-form">
    <div class="auth-head"><div class="auth-eyebrow">${t('access')}</div><h1>${t('newPw')}</h1></div>
    <div class="auth-field"><label>${t('newPwLabel')}</label><div class="auth-input">${inputIcon('lock')}<input type="password" name="p1" autocomplete="new-password" required><button type="button" class="auth-eye" data-eye aria-label="${t('showPw')}">${eyeIcon(false)}</button></div><span class="auth-hint">${t('pwHint')}</span></div>
    <div class="auth-field"><label>${t('confirmPw')}</label><div class="auth-input">${inputIcon('lock')}<input type="password" name="p2" autocomplete="new-password" required></div></div>
    <button class="auth-submit" type="submit"><span>${t('savePw')}</span></button></form>`, () => reset(root, token));
  bindEye(root);
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.p1.value !== f.p2.value) return toast(t('pwMismatch'), { error: true });
    try { await api.post('/auth/reset', { token, password: f.p1.value }); toast(t('pwChanged')); location.hash = ''; location.reload(); } catch (err) { fail(err); }
  };
}

export function setup(root, done) {
  mount(root, html`<form id="f" class="auth-form">
    <div class="auth-head"><div class="auth-eyebrow">${t('firstAccess')}</div><h1>${t('setupTitle')}</h1><p class="auth-note" style="text-align:left;margin-top:12px">${t('setupText')}</p></div>
    <div class="auth-field"><label>${t('name')}</label><div class="auth-input"><input name="name" required></div></div>
    <div class="auth-field"><label>${t('email')}</label><div class="auth-input">${inputIcon('mail')}<input type="email" name="email" required></div></div>
    <div class="auth-field"><label>${t('password')}</label><div class="auth-input">${inputIcon('lock')}<input type="password" name="password" required autocomplete="new-password"><button type="button" class="auth-eye" data-eye aria-label="${t('showPw')}">${eyeIcon(false)}</button></div><span class="auth-hint">${t('pwHint')}</span></div>
    <button class="auth-submit" type="submit"><span>${t('createAdmin')}</span></button></form>`, () => setup(root, done));
  bindEye(root);
  $('#f').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { await api.post('/setup', { name: f.name.value, email: f.email.value, password: f.password.value }); await api.post('/auth/login', { email: f.email.value, password: f.password.value, remember: true }); done(); } catch (err) { fail(err); }
  };
}

export function changePassword(forced) {
  modal({ title: forced ? 'Defina sua senha' : 'Alterar senha',
    body: html`${forced ? html`<p class="small muted" style="margin-top:0">Por segurança, troque a senha provisória antes de continuar.</p>` : ''}
      <div class="col"><div class="field"><label>Senha atual</label><input type="password" id="c0"></div><div class="field"><label>Nova senha</label><input type="password" id="c1"><span class="hint">Mínimo de 8 caracteres, com letras e números.</span></div><div class="field"><label>Confirmar nova senha</label><input type="password" id="c2"></div></div>`,
    actions: [...(forced ? [] : [{ label: 'Cancelar' }]), { label: 'Salvar', primary: true, fn: async (m) => {
      const [a, b, c] = ['#c0', '#c1', '#c2'].map((s) => m.querySelector(s).value);
      if (b !== c) { toast('As senhas não conferem.', { error: true }); return false; }
      await api.post('/auth/change-password', { current: a, password: b }); toast('Senha alterada.');
    } }] });
}
