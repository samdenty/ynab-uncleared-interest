interface EnvAccount {
	ID: string;
	CALCULATED: string;
	PAYOUT: string;
	RATE_APR: string | string[];
}

interface Env {
	ACCOUNTS: EnvAccount[];
	TOKEN: string;
	BUDGET: string;
	LOCALE: string;
}
