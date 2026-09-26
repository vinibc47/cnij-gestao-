// Gera um backup imediato do banco de dados (pasta backups/)
//   npm run backup
const { backupNow } = require('../server/services/automation');
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
console.log('Backup criado:', backupNow('manual-' + stamp));
process.exit(0);
