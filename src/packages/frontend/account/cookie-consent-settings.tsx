/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Button, Space } from "antd";
import { useEffect, useState } from "react";

import { Panel } from "@cocalc/frontend/antd-bootstrap";
import { useTypedRedux } from "@cocalc/frontend/app-framework";
import { Icon } from "@cocalc/frontend/components";
import { TimeAgo } from "@cocalc/frontend/components/time-ago";
import {
  COOKIE_CATEGORIES,
  ConsentSnapshot,
  getConsentSnapshot,
  onConsentChange,
  showPreferences,
} from "@cocalc/frontend/cookie-consent";
import { COLORS } from "@cocalc/util/theme";

// Visual style mirrors project Settings → Features (project-capabilites.tsx)
// — green check-square for accepted, red minus-square for declined, one row
// per category. The list is driven by COOKIE_CATEGORIES, so future
// categories show up here automatically.
function CategoryStatus({
  accepted,
  label,
}: {
  accepted: boolean;
  label: string;
}) {
  return (
    <div>
      <Icon
        name={accepted ? "check-square" : "minus-square"}
        style={{ color: accepted ? COLORS.BS_GREEN_D : COLORS.BS_RED }}
      />{" "}
      {label}
    </div>
  );
}

export function CookieConsentSettings(): React.JSX.Element | null {
  const cookieBannerEnabled = useTypedRedux(
    "customize",
    "cookie_banner_enabled",
  );
  const [snap, setSnap] = useState<ConsentSnapshot | null>(() =>
    getConsentSnapshot(),
  );

  useEffect(() => onConsentChange(setSnap), []);

  if (!cookieBannerEnabled) return null;

  return (
    <Panel
      size="small"
      header={
        <>
          <Icon name="lock" /> Cookie preferences
        </>
      }
    >
      {snap == null ? (
        <Alert
          type="warning"
          showIcon
          message="You have not yet acknowledged the cookie banner."
        />
      ) : (
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          {COOKIE_CATEGORIES.map((c) => (
            <CategoryStatus
              key={c.key}
              accepted={!!snap[c.key]}
              label={c.label}
            />
          ))}
          {snap.timestamp && (
            <div style={{ color: COLORS.GRAY }}>
              Last updated: <TimeAgo date={snap.timestamp} />
            </div>
          )}
        </Space>
      )}
      <div style={{ marginTop: 12 }}>
        <Button onClick={() => showPreferences()}>
          <Icon name="cog" /> Manage cookie preferences
        </Button>
      </div>
    </Panel>
  );
}
