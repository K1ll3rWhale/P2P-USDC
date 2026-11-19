// Reports, per variable name, whether it is set (true/false). Never prints values.
import { readFileSync, existsSync } from 'node:fs';

const file = '.env.local';
if (!existsSync(file)) {
  console.log(`${file} missing`);
  process.exit(1);
}
process.loadEnvFile(file);

// Names come from .env.example so the two files cannot drift apart.
const names = readFileSync('.env.example', 'utf8')
  .split(/\r?\n/)
  .map((l) => l.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
  .filter(Boolean);

for (const name of names) {
  console.log(`${name}: ${Boolean(process.env[name]?.trim())}`);
}
