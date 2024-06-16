import { calculateInterest, parseUnit } from './calculateInterest.js';

export default {
	async scheduled(event, env, ctx): Promise<void> {
		await calculateInterest(env.TOKEN, env.BUDGET, env.ACCOUNT, parseInt(env.RATE_APR), parseUnit(env.CALCULATED), parseUnit(env.PAYOUT));
	},
} satisfies ExportedHandler<Env>;
