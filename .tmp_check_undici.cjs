const u = require('undici');
console.log('resolved:', require.resolve('undici'));
console.log('Agent:', typeof u.Agent, 'setGlobalDispatcher:', typeof u.setGlobalDispatcher);
console.log('ver:', require('undici/package.json').version);
