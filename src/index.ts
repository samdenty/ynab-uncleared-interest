import { calculateInterest, parseEnvAccounts } from './calculateInterest.js';
import dotenv from 'dotenv';
import toml from 'toml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import moment from 'moment';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({
	path: path.join(__dirname, '../.dev.vars'),
});

const env: Env = {
	...process.env,
	...toml.parse(fs.readFileSync(path.join(__dirname, '../wrangler.toml'), 'utf8')).vars,
};

moment.locale(env.LOCALE);

await calculateInterest(process.env.TOKEN!, env.BUDGET, parseEnvAccounts(env));
