import fs from 'fs';
import vm from 'vm';

const html = fs.readFileSync('A:/MEDICAL BABY/MediLink/code/frontend/www/index.html', 'utf8');
const scriptMatches = [...html.matchAll(/<script(?:\s+type="text\/javascript"|\s+id="[^"]*")?>([\s\S]*?)<\/script>/gi)];

console.log(`Found ${scriptMatches.length} inline script tags.`);
let errorCount = 0;

scriptMatches.forEach((match, idx) => {
  const code = match[1];
  if (!code.trim()) return;
  try {
    new vm.Script(code);
    console.log(`Script ${idx + 1}: Syntax OK (${code.length} chars)`);
  } catch (err) {
    console.error(`Script ${idx + 1} Syntax Error:`, err.message);
    const lines = code.split('\n');
    const m = err.stack.match(/evalmachine\.<anonymous>:(\d+)/);
    if (m) {
      const lineNum = parseInt(m[1], 10);
      console.log(`Error near line ${lineNum}:`);
      for (let i = Math.max(1, lineNum - 10); i <= Math.min(lines.length, lineNum + 10); i++) {
        console.log(`${i}: ${lines[i - 1]}`);
      }
    }
    errorCount++;
  }
});

if (errorCount === 0) {
  console.log('ALL INLINE SCRIPTS SYNTAX VALID!');
} else {
  process.exit(1);
}
