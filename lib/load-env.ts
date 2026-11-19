// For standalone scripts only (Next.js loads .env.local itself). Import this first.
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
