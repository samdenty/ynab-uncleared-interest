import { API, SaveTransactionWithId } from 'ynab';
import moment, { Moment, unitOfTime } from 'moment';
import chalk from 'chalk';
import stripAnsi from 'strip-ansi';

type RateApr = string;

type AccountRateAfterDate = readonly [Date | Moment, RateApr];
type AccountRate = RateApr | readonly [RateApr | AccountRateAfterDate, ...AccountRateAfterDate[]];

interface AccountWithInterest {
	id: string;
	rate: AccountRate;
	calculatedInterval: number;
	calculatedUnit: unitOfTime.DurationAs;
	payoutInterval: number;
	payoutUnit: unitOfTime.DurationAs;
}

export async function calculateInterest(token: string, budgetId: string, accounts: AccountWithInterest[]) {
	const ynabAPI = new API(token);

	if (!accounts.length) {
		return;
	}

	const transactionsToUpdate: SaveTransactionWithId[] = [];

	for (const { id, rate: rates, calculatedInterval, calculatedUnit, payoutInterval, payoutUnit } of accounts) {
		const response = await ynabAPI.transactions.getTransactionsByAccount(budgetId, id);

		const { transactions } = response.data;

		const [startTransaction] = transactions;
		if (!startTransaction) {
			continue;
		}

		console.group(startTransaction.account_name);

		let date = moment.utc(startTransaction.date);

		let balance = 0;
		let accruedInterest = 0;
		let payoutUnits = 0;

		// go through each calculation interval up to the current date
		while (date.isBefore(undefined, calculatedUnit)) {
			const startYear = date.clone().startOf('year');
			const endYear = date.clone().endOf('year');

			const calculation = calculateInterval(calculatedInterval, calculatedUnit, date);
			const payout = calculateInterval(payoutInterval, payoutUnit, date);
			if (payoutUnits !== payout.units) {
				if (payoutUnits) {
					console.groupEnd();
				}
				payoutUnits = payout.units;
				console.group(payout.formatted);
			}

			const daysInYear = endYear.diff(startYear, 'day');
			const daysInCalculation = calculation.end.diff(calculation.start, 'day');

			for (const transaction of transactions) {
				const transactionDate = moment.utc(transaction.date).startOf('day');

				if (!transactionDate.isSameOrAfter(calculation.start) || !transactionDate.isBefore(calculation.end)) {
					continue;
				}

				// skip eagerly calculated interest transactions that are not cleared
				if (transaction.payee_name === 'Interest' && transaction.cleared === 'uncleared') {
					continue;
				}

				balance += transaction.amount;
			}

			let calculatedInterest = 0;
			for (let i = 0; i < daysInCalculation; i++) {
				const rateApr = getRateApr(date, rates);

				calculatedInterest += ((balance / 100) * Number(rateApr)) / daysInYear;

				date.add(1, 'day');
			}

			accruedInterest += calculatedInterest;

			console.log(calculation.formatted, calculatedInterest, accruedInterest);

			date = calculation.next.start;

			if (date.isSameOrAfter(payout.end)) {
				accruedInterest = 0;
			}
		}

		const payout = calculateInterval(payoutInterval, payoutUnit, date, true);

		let payoutTransaction: SaveTransactionWithId | undefined = transactions.find((transaction) => {
			const date = moment.utc(transaction.date).startOf('day');

			return transaction.payee_name === 'Interest' && date.isAfter(payout.start) && date.isBefore(payout.next.start);
		});

		console.log();

		if (payoutTransaction) {
			if (payoutTransaction.cleared === 'cleared') {
				console.log('Payout transaction already cleared', payoutTransaction);
				return;
			}

			console.log('Updating payout transaction');
		}

		payoutTransaction = {
			...payoutTransaction,
			date: moment().format('YYYY-MM-DD'),
			amount: Math.round(accruedInterest),
			cleared: 'uncleared',
			memo: `for ${stripAnsi(payout.formatted)}`,
			payee_name: 'Interest',
			flag_color: 'purple',
			account_id: id,
		};

		console.log(payoutTransaction);

		transactionsToUpdate.push(payoutTransaction);

		if (payoutUnits) {
			console.groupEnd();
		}

		console.groupEnd();
	}

	try {
		await ynabAPI.transactions.updateTransactions(budgetId, {
			transactions: transactionsToUpdate,
		});
	} catch (error) {
		console.log(error);
	}
}

function calculateInterval(interval: number, unit: unitOfTime.DurationAs, date: Moment, alwaysFormatAsRange = false) {
	const startYear = date.clone().startOf('year');
	const count = Math.trunc(date.diff(startYear, unit) / interval);

	const start = startYear.clone().add(count * interval, unit);
	const end = start.clone().add(interval, unit);

	const normalizedUnit = moment.normalizeUnits(unit);
	const format = normalizedUnit === 'year' ? 'YYYY' : normalizedUnit === 'month' ? 'M/YYYY' : 'DD/M/YYYY';

	let formatted = chalk.cyanBright(start.format(format));
	if (alwaysFormatAsRange || interval !== 1 || normalizedUnit !== 'day') {
		formatted = `[${chalk.yellow(start.format(format))} to ${chalk.yellowBright(end.format(format))}]`;
	}

	return {
		units: count,
		formatted,
		start,
		end,
		get previous() {
			return calculateInterval(interval, unit, start.subtract(1, unit));
		},
		get next() {
			return calculateInterval(interval, unit, end);
		},
	};
}

function getRateApr(date: Moment, rates: AccountRate) {
	if (typeof rates === 'string') {
		return rates;
	}

	let i = rates.length;
	while (i--) {
		const rate = rates[i];
		if (typeof rate === 'string') {
			return rate;
		}

		const [rateDate, rateApr] = rate;

		if (date.isAfter(rateDate, 'day')) {
			return rateApr;
		}
	}

	return undefined!;
}

export function parseEnvAccounts(env: Env) {
	return env.ACCOUNTS.map((account) => parseEnvAccount(account));
}

function parseEnvAccount(account: Env['ACCOUNTS'][number]): AccountWithInterest {
	const id = account.ID;

	const rates = typeof account.RATE_APR === 'string' ? [account.RATE_APR] : account.RATE_APR;

	const rate = rates.map((rate, i) => {
		const segments = rate.split('=');
		const apr = segments.pop();
		const date = segments.shift();

		if (!apr || Number.isNaN(parseInt(apr))) {
			throw new Error(`APR must be number, received '${rate}'`);
		}

		if (!date) {
			if (i !== 0) {
				throw new Error(`Non-first APR in array must be of format \`DATE=RATE\`, received '${rate}'`);
			}

			return apr;
		}

		const aprDate = moment(date, 'L');
		console.log(date, aprDate.toString());
		if (!aprDate.isValid()) {
			throw new Error(`APR date not valid, received '${date}'`);
		}

		return [aprDate, apr] as const;
	}) as unknown as AccountRate;

	const [calculatedInterval, calculatedUnit] = account.CALCULATED.split(' ').map((value, index) => (index ? value : parseInt(value))) as [
		number,
		unitOfTime.DurationAs
	];

	const [payoutInterval, payoutUnit] = account.PAYOUT.split(' ').map((value, index) => (index ? value : parseInt(value))) as [
		number,
		unitOfTime.DurationAs
	];

	return { id, rate, calculatedInterval, calculatedUnit, payoutInterval, payoutUnit };
}
