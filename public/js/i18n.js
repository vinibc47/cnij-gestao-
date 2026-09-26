// Idiomas do sistema (PT / EN). O idioma escolhido fica salvo no navegador.
const DICT = {
  pt: {
    slogan: ['Criando ambientes marcantes', 'que contam a sua história'],
    contactWa: 'Fale conosco pelo WhatsApp', waMsg: 'Olá! Gostaria de falar com o escritório Carla Nogueira & Irineu Junior.',
    welcome: 'Bem-vindo(a)', signIn: 'Entrar', email: 'E-mail', password: 'Senha', emailPh: 'seu@e-mail.com',
    remember: 'Manter conectado', forgot: 'Esqueci minha senha', clientNote: ['Clientes do escritório também acessam por aqui', 'a sua Área do Cliente.'],
    showPw: 'Mostrar senha', hidePw: 'Ocultar senha',
    forgotTitle: 'Recuperar senha', forgotText: 'Informe seu e-mail. Enviaremos um link para criar uma nova senha. Se preferir, peça ao administrador para gerar o link em Configurações › Usuários.',
    cancel: 'Cancelar', sendLink: 'Enviar link',
    access: 'Acesso', newPw: 'Criar nova senha', newPwLabel: 'Nova senha', confirmPw: 'Confirmar senha', pwHint: 'Mínimo de 8 caracteres, com letras e números.',
    savePw: 'Salvar senha', pwMismatch: 'As senhas não conferem.', pwChanged: 'Senha alterada. Faça login.',
    firstAccess: 'Primeiro acesso', setupTitle: 'Configurar o sistema', setupText: 'Crie o usuário administrador. Depois você poderá cadastrar a equipe, os clientes e os demais acessos em Configurações.',
    name: 'Nome', createAdmin: 'Criar administrador',
  },
  en: {
    slogan: ['Designs that reflect', 'your story'],
    contactWa: 'Talk to us on WhatsApp', waMsg: 'Hello! I would like to talk to Carla Nogueira & Irineu Junior studio.',
    welcome: 'Welcome', signIn: 'Sign in', email: 'E-mail', password: 'Password', emailPh: 'you@email.com',
    remember: 'Keep me signed in', forgot: 'Forgot my password', clientNote: ['Our clients also sign in here', 'to access their Client Area.'],
    showPw: 'Show password', hidePw: 'Hide password',
    forgotTitle: 'Recover password', forgotText: 'Enter your e-mail and we will send you a link to create a new password. You may also ask the administrator to generate the link in Settings › Users.',
    cancel: 'Cancel', sendLink: 'Send link',
    access: 'Access', newPw: 'Create a new password', newPwLabel: 'New password', confirmPw: 'Confirm password', pwHint: 'At least 8 characters, with letters and numbers.',
    savePw: 'Save password', pwMismatch: 'Passwords do not match.', pwChanged: 'Password changed. Please sign in.',
    firstAccess: 'First access', setupTitle: 'Set up the system', setupText: 'Create the administrator user. Afterwards you can register the team, clients and other accesses in Settings.',
    name: 'Name', createAdmin: 'Create administrator',
  },
};
let lang = 'pt';
try { const s = localStorage.getItem('cnij_lang'); if (s && DICT[s]) lang = s; } catch { /* navegador sem armazenamento */ }
export const getLang = () => lang;
export function setLang(l) {
  if (!DICT[l]) return; lang = l;
  try { localStorage.setItem('cnij_lang', l); } catch { /* ignora */ }
  document.documentElement.lang = l === 'en' ? 'en' : 'pt-BR';
}
export const t = (key) => (DICT[lang][key] ?? DICT.pt[key] ?? key);
document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR';
