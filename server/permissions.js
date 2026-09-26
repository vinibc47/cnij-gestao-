// =====================================================================
// Níveis de acesso
//  ADMINISTRADOR  acesso completo
//  GESTOR         projetos, obras, clientes, tarefas, comercial; financeiro se autorizado (can_finance)
//  COLABORADOR    projetos/obras em que participa e tarefas atribuídas
//  ESTAGIÁRIO     somente projetos em que foi autorizado e suas tarefas
//  CLIENTE        apenas a Área do Cliente (rotas /api/portal)
// =====================================================================
const { HttpError } = require('./util');

const ALL = ['dashboard', 'financeiro', 'projetos', 'obras', 'tarefas', 'clientes', 'propostas', 'contratos', 'fornecedores',
  'agenda', 'documentos', 'relatorios', 'configuracoes'];

function modulesFor(u) {
  if (!u) return [];
  switch (u.role) {
    case 'admin': return ALL.slice();
    case 'gestor': return ALL.filter((m) => m !== 'configuracoes' && (m !== 'financeiro' || u.can_finance));
    case 'colaborador': return ['dashboard', 'projetos', 'obras', 'tarefas', 'agenda', 'documentos', 'fornecedores'];
    case 'estagiario': return ['dashboard', 'projetos', 'tarefas', 'agenda', 'documentos'];
    default: return [];
  }
}
const isStaff = (u) => u && u.role !== 'cliente';
const isManager = (u) => u && (u.role === 'admin' || u.role === 'gestor');
const canFinance = (u) => u && (u.role === 'admin' || (u.role === 'gestor' && !!u.can_finance));
const hasModule = (u, m) => modulesFor(u).includes(m);

function requireModule(m) {
  return (req, res, next) => (hasModule(req.user, m) ? next() : next(new HttpError(403, 'Sem permissão para este módulo.')));
}
function requireManager(req, res, next) { return isManager(req.user) ? next() : next(new HttpError(403, 'Apenas administradores e gestores.')); }
function requireAdmin(req, res, next) { return req.user && req.user.role === 'admin' ? next() : next(new HttpError(403, 'Apenas administradores.')); }
function requireFinance(req, res, next) { return canFinance(req.user) ? next() : next(new HttpError(403, 'Sem acesso ao financeiro.')); }

// Projetos acessíveis: gestores veem todos; demais, apenas os que gerenciam ou participam
function projectScope(u, col = 'id') {
  if (isManager(u)) return { sql: '1=1', params: [] };
  return {
    sql: `(${col} IN (SELECT project_id FROM project_members WHERE user_id = ?) OR ${col} IN (SELECT id FROM projects WHERE manager_id = ?))`,
    params: [u.id, u.id],
  };
}
function canAccessProject(u, projectId) {
  if (isManager(u)) return true;
  if (!projectId) return false;
  const { get } = require('./db');
  const s = projectScope(u, 'p.id');
  return !!get(`SELECT 1 FROM projects p WHERE p.id = ? AND ${s.sql}`, projectId, ...s.params);
}

module.exports = { ALL, modulesFor, isStaff, isManager, canFinance, hasModule, requireModule, requireManager, requireAdmin, requireFinance, projectScope, canAccessProject };
