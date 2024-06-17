import { calculateInterest, parseEnvAccounts } from './calculateInterest.js';
import moment from 'moment';

export default {
	async scheduled(_event, env, _ctx): Promise<void> {
		moment.locale(env.LOCALE);

		await calculateInterest(env.TOKEN, env.BUDGET, parseEnvAccounts(env));
	},
} satisfies ExportedHandler<Env>;
