const fs = require('fs');
const p = 'E:/0_Downloads/GIGA ASISTENT/node_modules';
try {
  fs.rmSync('\\\\?\\' + p.replace(/\//g, '\\'), { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
} catch (e) {
  console.log('rm long:', e.code, e.message);
}
try {
  fs.rmSync(p, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
} catch (e) {
  console.log('rm short:', e.code, e.message);
}
console.log('exists:', fs.existsSync(p));
