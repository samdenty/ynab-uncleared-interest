import { calculateInterest, parseUnit } from './calculateInterest.js';
import dotenv from 'dotenv';

dotenv.config({
	path: '.dev.vars',
});

await calculateInterest(
	process.env.TOKEN!,
	process.env.BUDGET!,
	process.env.ACCOUNT!,
	parseInt(process.env.RATE_APR!),
	parseUnit(process.env.CALCULATED!),
	parseUnit(process.env.PAYOUT!)
);
