/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Voucher -- create vouchers from the contents of your shopping cart.
*/

import {
  Alert,
  Button,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Table,
  Space,
} from "antd";
import dayjs from "dayjs";
import { useContext, useEffect, useMemo, useState } from "react";
import { Icon } from "@cocalc/frontend/components/icon";
import { money } from "@cocalc/util/licenses/purchase/utils";
import { plural } from "@cocalc/util/misc";
import A from "components/misc/A";
import Loading from "components/share/loading";
import SiteName from "components/share/site-name";
import useAPI from "lib/hooks/api";
import useIsMounted from "lib/hooks/mounted";
import { useRouter } from "next/router";
import { computeCost } from "@cocalc/util/licenses/store/compute-cost";
import { useProfileWithReload } from "lib/hooks/profile";
import { Paragraph } from "components/misc";
import { fullCost, getColumns, RequireEmailAddress } from "./checkout";
import ShowError from "@cocalc/frontend/components/error";
import { COLORS } from "@cocalc/util/theme";
import vouchers, {
  CharSet,
  MAX_VOUCHERS,
  WhenPay,
} from "@cocalc/util/vouchers";
import {
  getVoucherCartCheckoutParams,
  vouchersCheckout,
  syncPaidInvoices,
} from "@cocalc/frontend/purchases/api";
import type { CheckoutParams } from "@cocalc/server/purchases/shopping-cart-checkout";
import { ExplainPaymentSituation } from "./checkout";
import AddCashVoucher from "./add-cash-voucher";
import { StoreBalanceContext } from "../../lib/balance";
import StripePayment from "@cocalc/frontend/purchases/stripe-payment";

interface Config {
  whenPay: WhenPay;
  numVouchers: number;
  length: number;
  title: string;
  prefix: string;
  postfix: string;
  charset: CharSet;
  expire: dayjs.Dayjs;
}

export default function CreateVouchers() {
  const router = useRouter();
  const isMounted = useIsMounted();
  const { profile, reload: reloadProfile } = useProfileWithReload({
    noCache: true,
  });
  const { refreshBalance } = useContext(StoreBalanceContext);
  const [orderError, setOrderError] = useState<string>("");
  const [subTotal, setSubTotal] = useState<number>(0);
  const [userSuccessfullyAddedCredit, setUserSuccessfullyAddedCredit] =
    useState<boolean>(false);

  // user configurable options: start
  const [query, setQuery0] = useState<Config>(() => {
    const q = router.query;
    return {
      whenPay: typeof q.whenPay == "string" ? (q.whenPay as WhenPay) : "now",
      numVouchers:
        typeof q.numVouchers == "string" ? parseInt(q.numVouchers) : 1,
      length: typeof q.length == "string" ? parseInt(q.length) : 8,
      title: typeof q.title == "string" ? q.title : "",
      prefix: typeof q.prefix == "string" ? q.prefix : "",
      postfix: typeof q.postfix == "string" ? q.postfix : "",
      charset: typeof q.charset == "string" ? q.charset : "alphanumeric",
      expire:
        typeof q.expire == "string" ? dayjs(q.expire) : dayjs().add(30, "day"),
    };
  });
  const {
    whenPay,
    numVouchers,
    length,
    title,
    prefix,
    postfix,
    charset,
    expire,
  } = query;
  const setQuery = (obj) => {
    const query1 = { ...query };
    for (const key in obj) {
      const value = obj[key];
      router.query[key] =
        key == "expire" ? value.toDate().toISOString() : `${value}`;
      query1[key] = value;
    }
    router.replace({ query: router.query }, undefined, {
      shallow: true,
      scroll: false,
    });
    setQuery0(query1);
  };

  const [params, setParams] = useState<CheckoutParams | null>(null);
  const updateParams = async (count, whenPay) => {
    if (whenPay == "admin" || count == null) {
      setParams(null);
      return;
    }
    try {
      setParams(await getVoucherCartCheckoutParams(count));
    } catch (err) {
      setOrderError(`${err}`);
    }
  };
  useEffect(() => {
    updateParams(numVouchers, whenPay);
  }, [subTotal, numVouchers, whenPay]);

  //////
  // Handling payment -- start
  // This is very similar to checkout.tsx, but I couldn't think of a good way to
  // avoid dup, and vouchers are *barely* used.
  const [completingPurchase, setCompletingPurchase] = useState<boolean>(false);

  useEffect(() => {
    if (router.query.complete == null) {
      // nothing to handle
      return;
    }

    (async () => {
      // in case webhooks aren't configured, get the payment via sync:
      try {
        await syncPaidInvoices();
      } catch (err) {
        console.warn("syncPaidInvoices buying vouchers -- issue", err);
      }
      // now do the purchase flow again with money available.
      completePurchase();
    })();
  }, []);

  async function completePurchase() {
    try {
      setOrderError("");
      setCompletingPurchase(true);
      if (!isMounted.current) {
        return;
      }
      await vouchersCheckout({
        config: {
          count: numVouchers ?? 1,
          expire: expire.toDate(),
          cancelBy: dayjs().add(14, "day").toDate(),
          active: dayjs().toDate(),
          title,
          whenPay,
          generate: {
            length,
            charset,
            prefix,
            postfix,
          },
        },
      });
      if (isMounted.current) {
        router.push("/store/congrats");
      }
    } catch (err) {
      // The purchase failed.
      setOrderError(err.message);
    } finally {
      await refreshBalance();
      if (!isMounted.current) return;
    }
  }
  // Handling payment -- end
  //////

  const exampleCodes: string = useMemo(() => {
    return vouchers({ count: 5, length, charset, prefix, postfix }).join(", ");
  }, [length, charset, prefix, postfix]);

  // most likely, user will do the purchase and then see the congratulations page
  useEffect(() => {
    router.prefetch("/store/congrats");
  }, []);

  useEffect(() => {
    if ((numVouchers ?? 0) > MAX_VOUCHERS[whenPay]) {
      setQuery({ numVouchers: MAX_VOUCHERS[whenPay] });
    }
  }, [whenPay]);

  const cart0 = useAPI("/shopping/cart/get");

  const cart = useMemo(() => {
    return cart0.result?.filter((item) => {
      if (item.product == "site-license") {
        return item.description?.period == "range";
      }
      if (item.product == "cash-voucher") {
        return true;
      }
      return false;
    });
  }, [cart0.result]);

  const items = useMemo(() => {
    if (!cart) return undefined;
    const x: any[] = [];
    let subTotal = 0;
    for (const item of cart) {
      if (!item.checked) continue;
      item.cost = computeCost(item.description);
      subTotal += item.cost.cost;
      x.push(item);
    }
    setSubTotal(subTotal);
    return x;
  }, [cart]);

  if (cart0.error) {
    return <Alert type="error" message={cart.error} />;
  }
  if (!items) {
    return <Loading center />;
  }

  const columns = getColumns({
    noDiscount: whenPay != "now",
    voucherPeriod: true,
  });

  const disabled =
    !numVouchers ||
    completingPurchase ||
    !title?.trim() ||
    expire == null ||
    subTotal == 0 ||
    !profile?.email_address;

  function EmptyCart() {
    return (
      <div style={{ maxWidth: "800px", margin: "auto" }}>
        <h3>
          <Icon name={"shopping-cart"} style={{ marginRight: "5px" }} />
          {cart?.length > 0 && (
            <>
              Nothing in Your <SiteName />{" "}
              <A href="/store/cart">Shopping Cart</A> is Selected
            </>
          )}
          {(cart0.result?.length ?? 0) == 0 ? (
            <>
              Your <SiteName /> <A href="/store/cart">Shopping Cart</A> is Empty
            </>
          ) : (
            <>
              Your <SiteName /> <A href="/store/cart">Shopping Cart</A> must
              contain at least one non-subscription license or cash voucher
            </>
          )}
        </h3>
        <AddCashVoucher onAdd={() => cart0.call()} defaultExpand />
        <p style={{ color: "#666" }}>
          You must have at least one non-subscription item in{" "}
          <A href="/store/cart">your cart</A> to create vouchers from the items
          in your shopping cart. Shop for{" "}
          <A href="/store/site-license">upgrades</A>, a{" "}
          <A href="/store/boost">license boost</A>, or a{" "}
          <A href="/dedicated">dedicated VM or disk</A>, and select a specific
          range of dates. When you{" "}
          <A href="/redeem">redeem a voucher for shopping cart items</A>, the
          corresponding licenses start at the redemption date, and last for the
          same number of days as your shopping cart item. You can also browse
          all <A href="/vouchers/redeemed">vouchers you have redeemed</A> and
          track everything about your vouchers in the{" "}
          <A href="/vouchers">Voucher Center</A>.
        </p>
      </div>
    );
  }

  // this can't just be a component, since it depends on a bunch of scope,
  function nonemptyCart(items) {
    return (
      <>
        <ShowError error={orderError} setError={setOrderError} />
        <div>
          <h3 style={{ fontSize: "16pt" }}>
            <Icon name={"gift2"} style={{ marginRight: "10px" }} />
            Create Voucher Codes
          </h3>
          <Paragraph style={{ color: "#666" }}>
            Voucher codes can be <A href="/redeem">redeemed</A> for the{" "}
            {items.length} {plural(items.length, "license")} listed below. The
            license start and end dates are shifted to match when the license is
            redeemed. Visit the <A href="/vouchers">Voucher Center</A> for more
            about vouchers, and{" "}
            <A href="https://doc.cocalc.com/vouchers.html">read the docs</A>.
          </Paragraph>
          {profile?.is_admin && (
            <>
              <h4 style={{ fontSize: "13pt", marginTop: "20px" }}>
                <Check done /> Pay Now
              </h4>
              <div>
                <Radio.Group
                  value={whenPay}
                  onChange={(e) => {
                    setQuery({ whenPay: e.target.value as WhenPay });
                  }}
                >
                  <Space
                    direction="vertical"
                    style={{ margin: "5px 0 15px 15px" }}
                  >
                    <Radio value={"now"}>Pay Now</Radio>
                    {profile?.is_admin && (
                      <Radio value={"admin"}>
                        Admin Vouchers: you will not be charged (admins only)
                      </Radio>
                    )}
                  </Space>
                </Radio.Group>
                <br />
                <Paragraph style={{ color: "#666" }}>
                  {profile?.is_admin && (
                    <>
                      As an admin, you may select the "Admin" option; this is
                      useful for creating free trials or fulfilling complicated
                      customer requirements.{" "}
                    </>
                  )}
                </Paragraph>
              </div>
            </>
          )}
          <h4 style={{ fontSize: "13pt", marginTop: "20px" }}>
            <Check done={(numVouchers ?? 0) > 0} /> How Many Voucher Codes?
          </h4>
          <Paragraph style={{ color: "#666" }}>
            Input the number of voucher codes to create{" "}
            {whenPay == "now" ? "buy" : "create"} (limit:{" "}
            {MAX_VOUCHERS[whenPay]}):
            <div style={{ textAlign: "center", marginTop: "15px" }}>
              <InputNumber
                size="large"
                min={1}
                max={MAX_VOUCHERS[whenPay]}
                value={numVouchers}
                onChange={(value) => setQuery({ numVouchers: value })}
              />
            </div>
          </Paragraph>
          {whenPay == "admin" && (
            <>
              <h4 style={{ fontSize: "13pt", marginTop: "20px" }}>
                <Check done={expire != null} />
                When Voucher Codes Expire
              </h4>
              <Paragraph style={{ color: "#666" }}>
                As an admin you can set any expiration date you want for the
                voucher codes.
              </Paragraph>
              <Form
                labelCol={{ span: 9 }}
                wrapperCol={{ span: 9 }}
                layout="horizontal"
              >
                <Form.Item label="Expire">
                  <DatePicker
                    value={expire}
                    presets={[
                      {
                        label: "+ 7 Days",
                        value: dayjs().add(7, "d"),
                      },
                      {
                        label: "+ 30 Days",
                        value: dayjs().add(30, "day"),
                      },
                      {
                        label: "+ 2 months",
                        value: dayjs().add(2, "months"),
                      },
                      {
                        label: "+ 6 months",
                        value: dayjs().add(6, "months"),
                      },
                      {
                        label: "+ 1 Year",
                        value: dayjs().add(1, "year"),
                      },
                    ]}
                    onChange={(expire) => setQuery({ expire })}
                    disabledDate={(current) => {
                      if (!current) {
                        return true;
                      }
                      // Can not select days before today and today
                      if (current < dayjs().endOf("day")) {
                        return true;
                      }
                      // ok
                      return false;
                    }}
                  />
                </Form.Item>
              </Form>
            </>
          )}
          <h4
            style={{
              fontSize: "13pt",
              marginTop: "20px",
              color: !title ? "darkred" : undefined,
            }}
          >
            <Check done={!!title.trim()} /> Description
          </h4>
          <Paragraph style={{ color: "#666" }}>
            <div
              style={
                !title
                  ? { borderRight: "5px solid darkred", paddingRight: "15px" }
                  : undefined
              }
            >
              <div
                style={
                  !title ? { fontWeight: 700, color: "darkred" } : undefined
                }
              >
                Describe this voucher:
              </div>
              <Input
                allowClear
                style={{ marginBottom: "15px", marginTop: "5px" }}
                onChange={(e) => setQuery({ title: e.target.value })}
                value={title}
                addonBefore={"Description"}
              />
            </div>
            Customize how your voucher codes are randomly generated (optional):
            <Space direction="vertical" style={{ marginTop: "5px" }}>
              <Space>
                <InputNumber
                  addonBefore={"Length"}
                  min={8}
                  max={16}
                  onChange={(length) => {
                    setQuery({ length: length ?? 8 });
                  }}
                  value={length}
                />
                <Input
                  maxLength={10 /* also enforced via api */}
                  onChange={(e) => setQuery({ prefix: e.target.value })}
                  value={prefix}
                  addonBefore={"Prefix"}
                  allowClear
                />
                <Input
                  maxLength={10 /* also enforced via api */}
                  onChange={(e) => setQuery({ postfix: e.target.value })}
                  value={postfix}
                  addonBefore={"Postfix"}
                  allowClear
                />{" "}
              </Space>
              <Space>
                <Radio.Group
                  onChange={(e) => {
                    setQuery({ charset: e.target.value });
                  }}
                  defaultValue={charset}
                >
                  <Radio.Button value="alphanumeric">alphanumeric</Radio.Button>
                  <Radio.Button value="alphabetic">alphabetic</Radio.Button>
                  <Radio.Button value="numbers">0123456789</Radio.Button>
                  <Radio.Button value="lower">lower</Radio.Button>
                  <Radio.Button value="upper">UPPER</Radio.Button>
                </Radio.Group>
              </Space>
              <Space>
                <div style={{ whiteSpace: "nowrap" }}>Examples:</div>{" "}
                {exampleCodes}
              </Space>
            </Space>
          </Paragraph>
        </div>

        <h4 style={{ fontSize: "13pt", marginTop: "15px" }}>
          <Check done />
          {(numVouchers ?? 0) == 1
            ? "Your Voucher"
            : `Each of Your ${numVouchers ?? 0} Voucher Codes`}{" "}
          Provides the Following {items.length} {plural(items.length, "Item")}
        </h4>
        <Paragraph style={{ color: "#666" }}>
          These are the licenses with a fixed range of time from your shopping
          cart (vouchers cannot be used to create subscriptions). When used, the
          voucher code is redeemed for one or more license starting at the time
          of redemption and running for the same length of time as each license
          listed below. The license obtained using this voucher can also be
          canceled early for a prorated refund resulting in credit to the
          account holder, or edited to better fit the recipient's requirements.
        </Paragraph>
        <div style={{ border: "1px solid #eee" }}>
          <Table
            showHeader={false}
            columns={columns}
            dataSource={items}
            rowKey={"id"}
            pagination={{ hideOnSinglePage: true }}
          />
        </div>
        <Space style={{ marginTop: "15px" }}>
          <AddCashVoucher onAdd={() => cart0.call()} />
          <A href="/store/cart">
            <Button>Edit Cart</Button>
          </A>
        </Space>
        <h4 style={{ fontSize: "13pt", marginTop: "30px" }}>
          <Check done={!disabled} /> Create Your{" "}
          {plural(numVouchers ?? 0, "Voucher Code")}
        </h4>
        {numVouchers != null && params != null && (
          <div style={{ fontSize: "12pt" }}>
            <Row>
              <Col sm={12}></Col>
              <Col sm={12}>
                <div style={{ fontSize: "15pt" }}>
                  <TotalCost
                    items={cart}
                    numVouchers={numVouchers ?? 0}
                    whenPay={whenPay}
                  />
                  <br />
                  <Terms whenPay={whenPay} />
                </div>
              </Col>
            </Row>
            <ExplainPaymentSituation
              params={params}
              style={{ margin: "15px 0" }}
            />
            {params.chargeAmount > 0 && !userSuccessfullyAddedCredit && (
              <StripePayment
                style={{ maxWidth: "600px", margin: "30px auto" }}
                amount={params.chargeAmount}
                purpose={"buy-vouchers"}
                description={`CoCalc Voucher Codes: ${title.slice(0, 250)}`}
                onFinished={async () => {
                  setUserSuccessfullyAddedCredit(true);
                  // user paid successfully and money should be in their account
                  await refreshBalance();
                  if (!isMounted.current) {
                    return;
                  }
                  // now do the purchase flow with money available.
                  await completePurchase();
                }}
              />
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <RequireEmailAddress profile={profile} reloadProfile={reloadProfile} />
      {items.length == 0 && <EmptyCart />}
      {items.length > 0 && nonemptyCart(items)}
      <ShowError error={orderError} setError={setOrderError} />
    </>
  );
}

function TotalCost({ items, numVouchers, whenPay }) {
  const cost = numVouchers * fullCost(items);
  return (
    <>
      {whenPay == "now" ? "Total Amount" : "Maximum Amount"}:{" "}
      <b style={{ float: "right", color: "darkred" }}>{money(cost)}</b>
    </>
  );
}

function Terms({ whenPay }) {
  return (
    <Paragraph style={{ color: COLORS.GRAY, fontSize: "10pt" }}>
      By creating vouchers, you agree to{" "}
      <A href="/policies/terms" external>
        our terms of service,
      </A>{" "}
      {whenPay == "now" && (
        <>and agree to pay for the voucher you have requested.</>
      )}
      {whenPay == "invoice" && (
        <>
          and agree to pay for any voucher codes that are redeemed, up to the
          maxium amount listed here.
        </>
      )}
      {whenPay == "admin" && (
        <>
          and as an admin agree to use the voucher for company purposes. The
          cash value is listed above.
        </>
      )}
    </Paragraph>
  );
}

const CHECK_STYLE = { marginRight: "5px", fontSize: "14pt" };
function Check({ done }) {
  if (done) {
    return <Icon name="check" style={{ ...CHECK_STYLE, color: "green" }} />;
  } else {
    return (
      <Icon name="arrow-right" style={{ ...CHECK_STYLE, color: "#cf1322" }} />
    );
  }
}
