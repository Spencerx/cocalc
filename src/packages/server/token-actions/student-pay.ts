import { currency, round2up, round2down } from "@cocalc/util/misc";
import getName from "@cocalc/server/accounts/get-name";
import studentPayPurchase from "@cocalc/server/purchases/student-pay";
import type { Description } from "@cocalc/util/db-schema/token-actions";
import getPool from "@cocalc/database/pool";
import { getCost } from "@cocalc/server/purchases/student-pay";
import getBalance from "@cocalc/server/purchases/get-balance";
import getMinBalance from "@cocalc/server/purchases/get-min-balance";
import syncPaidInvoices from "@cocalc/server/purchases/sync-paid-invoices";
import { getServerSettings } from "@cocalc/database/settings/server-settings";

export async function studentPay(token, description, account_id): Promise<any> {
  if (description.due > 0) {
    const amount = description.due;
    const user = await getName(account_id);
    const studentName = await getName(description.account_id);
    return {
      type: "create-credit",
      pay: {
        description: "Pay course fee for ${studentName}",
        lineItems: [
          {
            amount,
            description: `Add ${currency(
              amount,
              2,
            )} to your account (signed in as ${user}) to pay the course fee for ${studentName}.`,
          },
        ],
        purpose: `student-pay-${token}`,
      },
      instructions: `Click here to deposit ${currency(
        amount,
        2,
      )} into your account, so you can pay the course fee for ${studentName}...`,
    };
  } else {
    // should have enough money, so actually make the purchase
    return await studentPayPurchase({
      account_id,
      project_id: description.project_id,
      allowOther: true,
    });
  }
}

export async function extraInfo(description: Description, account_id?: string) {
  if (description.type != "student-pay") {
    throw Error("description must be of type student-pay");
  }
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT course FROM projects WHERE project_id=$1",
    [description.project_id],
  );
  const { course } = rows[0] ?? {};
  if (course == null) {
    throw Error("Invalid token -- not a course project.");
  }
  const cost = getCost(course.payInfo);
  if (course.paid || description.paid) {
    return {
      ...description,
      title: "Pay Course Fee",
      details: `The ${currency(
        cost,
        2,
      )} course fee for [this project](/projects/${
        description.project_id
      }) has already been paid. Thank you!`,
      okText: "",
      cancelText: "Close",
      icon: "graduation-cap",
    };
  }
  if (!account_id) {
    return {
      ...description,
      title: "Pay Course Fee",
      details: `You must be signed in to pay the course fee for ${await getName(
        course.account_id,
      )}.  You can be signed in as any user, and it is very easy to make a new account.`,
      signIn: true,
    };
  }
  // If you just added cash to do student pay, then it's important to see
  // it reflected in your balance, so you can then complete the purchase.
  // NOTE: with webhooks this would already happen automatically -- this is
  // just a backup.
  await syncPaidInvoices(account_id);

  const balance = await getBalance(account_id);
  const balanceAfterPay = balance - cost;
  const minBalance = await getMinBalance(account_id);
  const { pay_as_you_go_min_payment } = await getServerSettings();
  let due = round2up(Math.max(0, minBalance - balanceAfterPay));
  let minPayment = "";
  if (due > 0 && due < pay_as_you_go_min_payment) {
    due = Math.max(due, pay_as_you_go_min_payment);
    minPayment = `\n\n- The minimum credit that you can add is ${currency(
      pay_as_you_go_min_payment,
    )}. `;
  }
  const name = await getName(course.account_id);

  return {
    ...description,
    due,
    title: "Pay Course Fee",
    details: `
- The course fee of ${currency(round2up(cost))} ${
      name ? `for ${name} ` : ""
    } has not yet been paid.${
      due == 0
        ? "\n\n- You can pay this now from your current balance without having to add money to your account."
        : `\n\n- You can pay the amount due \\${currency(due, 2)} below.`
    } \n\n- Your balance is \\${currency(round2down(balance), 2)}${
      minBalance < 0
        ? `, which must stay above \\${currency(round2down(minBalance), 2)}`
        : "."
    }
    ${minPayment}
`,
    okText: "Pay course fee",
    icon: "graduation-cap",
  };
}
