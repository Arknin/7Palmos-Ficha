'use strict';
require('../migrate').run().then(a => { console.log(a.length ? `Migrations aplicadas: ${a.join(', ')}` : 'Banco já está atualizado.'); process.exit(0); })
  .catch(e => { console.error(e.report || e); process.exit(1); });
