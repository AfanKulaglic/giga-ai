const fs = require('node:fs');
const path = 'lib/ai/replyGuard.ts';
let text = fs.readFileSync(path, 'utf8');
const nl = text.includes('\r\n') ? '\r\n' : '\n';

// 1) pokvareni split sa pravim novim redom unutar zagrada
const broken = 'packageTotalsText(ctx.packageQuote).split(' + "\n\n" + ').slice(-1)[0]';
const fixed = "packageTotalsText(ctx.packageQuote).split(String.fromCharCode(10, 10)).slice(-1)[0]";
if (!text.includes(broken)) throw new Error('pokvareni split nije nadjen');
text = text.replace(broken, fixed);

// 2) duplirana linija offer_link_missing
const dup =
  "  if (codes.has('offer_link_missing') && ctx.offerLink) {  if (codes.has('offer_link_missing') && ctx.offerLink) {";
if (text.includes(dup)) {
  text = text.replace(dup, "  if (codes.has('offer_link_missing') && ctx.offerLink) {");
}

fs.writeFileSync(path, text, 'utf8');
console.log('split + duplikat popravljeni');
