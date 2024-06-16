import ynab, { SaveTransactionWithId } from "ynab";
import day, { Dayjs, ManipulateType } from "dayjs";

const ynabAPI = new ynab.API(process.env.TOKEN!);

const rateApr = parseInt(process.env.RATE_APR!);

const [calculatedInterval, calculatedUnit] = process.env
  .CALCULATED!.split(" ")
  .map((value, index) => (index ? value : parseInt(value))) as [
  number,
  ManipulateType
];

const [payoutInterval, payoutUnit] = process.env
  .PAYOUT!.split(" ")
  .map((value, index) => (index ? value : parseInt(value))) as [
  number,
  ManipulateType
];

const response = await ynabAPI.transactions.getTransactionsByAccount(
  process.env.BUDGET!,
  process.env.ACCOUNT!
);

const { transactions } = response.data;

const [startTransaction] = transactions;
if (!startTransaction) {
  process.exit();
}

let date = day(startTransaction.date).startOf("year");

let balance = 0;
let accruedInterest = 0;

// go through each calculation interval up to the current date
while (date.isBefore() || date.isSame()) {
  const startYear = date.startOf("year");
  const endYear = date.endOf("year");

  const calculation = calculateInterval(
    calculatedInterval,
    calculatedUnit,
    date
  );
  const payout = calculateInterval(payoutInterval, payoutUnit, date);

  const daysInYear = endYear.diff(startYear, "day");
  const daysInCalculation = calculation.end.diff(calculation.start, "day");

  for (const transaction of transactions) {
    const transactionDate = day(transaction.date).startOf("day");

    if (
      !(
        transactionDate.isSame(calculation.start) ||
        transactionDate.isAfter(calculation.start)
      ) ||
      !transactionDate.isBefore(calculation.end)
    ) {
      continue;
    }

    // skip eagerly calculated interest transactions that are not cleared
    if (
      transaction.payee_name === "Interest" &&
      transaction.cleared === "uncleared"
    ) {
      continue;
    }

    balance += transaction.amount;
  }

  const calculatedInterest =
    (((balance / 100) * rateApr) / daysInYear) * daysInCalculation;

  accruedInterest += calculatedInterest;

  date = calculation.next.start;

  if (date.isSame(payout.end) || date.isAfter(payout.end)) {
    accruedInterest = 0;
  }
}

const payout = calculateInterval(payoutInterval, payoutUnit, date, true);

let payoutTransaction: SaveTransactionWithId | undefined = transactions.find(
  (transaction) => {
    const date = day(transaction.date).startOf("day");

    return (
      transaction.payee_name === "Interest" &&
      date.isAfter(payout.start) &&
      date.isBefore(payout.next.start)
    );
  }
);

if (payoutTransaction) {
  if (payoutTransaction.cleared === "cleared") {
    console.log("Payout transaction already cleared", payoutTransaction);
    process.exit();
  }

  console.log("Updating payout transaction");
}

payoutTransaction = {
  ...payoutTransaction,
  date: day().format("YYYY-MM-DD"),
  amount: Math.round(accruedInterest),
  cleared: "uncleared",
  memo: `for ${payout.formatted}`,
  payee_name: "Interest",
  flag_color: "purple",
  account_id: process.env.ACCOUNT!,
};

const transactionsToUpdate = [payoutTransaction];

try {
  await ynabAPI.transactions.updateTransactions(process.env.BUDGET!, {
    transactions: transactionsToUpdate,
  });
} catch (error) {
  console.log(error);
}

function calculateInterval(
  interval: number,
  unit: ManipulateType,
  date: Dayjs,
  alwaysFormatAsRange = false
) {
  const startYear = date.startOf("year");
  const count = Math.trunc(date.diff(startYear, unit) / interval);

  const start = startYear.add(count * interval, unit);
  const end = start.add(interval, unit);

  let formatted = start.format("DD/MM/YYYY");

  if (alwaysFormatAsRange || interval !== 1) {
    formatted += `-${end.format("DD/MM/YYYY")}`;
  }

  return {
    units: count,
    formatted,
    start,
    end,
    get next() {
      return calculateInterval(interval, unit, end);
    },
  };
}
