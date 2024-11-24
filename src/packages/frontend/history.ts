/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/* Code related to the history and URL in the browser bar.

The URI schema handled by the single page app is as follows:
     Overall settings:
        https://cocalc.com/settings
     Admin only page:
        https://cocalc.com/admin
     Account settings (default):
        https://cocalc.com/settings/account
     Billing:
        https://cocalc.com/settings/billing
     Upgrades:
        https://cocalc.com/settings/upgrades
     Licenes:
        https://cocalc.com/settings/licenses
     Support:
        https://cocalc.com/settings/support
     Projects page:
        https://cocalc.com/projects/
     Specific project:
        https://cocalc.com/projects/project-id/
     Create new file page (in given directory):
        https://cocalc.com/projects/project-id/new/path/to/dir
     Search (in given directory):
        https://cocalc.com/projects/project-id/search/path/to/dir
     Settings:
        https://cocalc.com/projects/project-id/settings
     Log:
        https://cocalc.com/projects/project-id/log
     Folder listing (must have slash at end):
       https://cocalc.com/projects/project-id/files/path/to/dir/
     Open file:
       https://cocalc.com/projects/project-id/files/path/to/file
     (From before) raw http:
       https://cocalc.com/projects/project-id/raw/path/...
     (From before) proxy server (supports websockets and ssl) to a given port.
       https://cocalc.com/projects/project-id/port/<number>/.
*/

import { join } from "path";
import { redux } from "@cocalc/frontend/app-framework";
import { IS_EMBEDDED } from "@cocalc/frontend/client/handle-target";
import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import Fragment from "@cocalc/frontend/misc/fragment-id";
import { getNotificationFilterFromFragment } from "./notifications/fragment";

// Determine query params part of URL based on state of the project store.
// This also leaves unchanged any *other* params already there (i.e., not
// the "managed" params that are explicitly listed in the code below).
function params(): string {
  const page = redux.getStore("page");
  const u = new URL(location.href);
  if (page != null) {
    for (const param of ["get_api_key", "test"]) {
      const val = page.get(param);
      if (val) {
        u.searchParams.set(param, val);
      } else {
        u.searchParams.delete(param);
      }
    }
  }
  return u.search;
}

// The last explicitly set url.
let last_url: string | undefined = undefined;
let last_full_url: string | undefined = undefined;

// Update what params are set to in the URL based on state of project store,
// leaving the rest of the URL the same.
export function update_params() {
  if (last_url != null) {
    set_url(last_url);
  }
}

// the url most already be URI encoded, e.g., "a/b ? c.md" should be encoded as 'a/b%20?%20c.md'
export function set_url(url: string, hash?: string) {
  if (IS_EMBEDDED) {
    // no need to mess with url in embedded mode.
    return;
  }
  last_url = url;
  const query_params = params();
  const full_url = join(
    appBasePath,
    url + query_params + (hash ?? location.hash),
  );
  if (full_url === last_full_url) {
    // nothing to do
    return;
  }
  last_full_url = full_url;
  history.pushState({}, "", full_url);
}

// Now load any specific page/project/previous state
export function load_target(
  target: string,
  ignore_kiosk: boolean = false,
  change_history: boolean = true,
) {
  if (!target) {
    return;
  }
  const logged_in = redux.getStore("account").get("is_logged_in");
  const segments = target.split("/");
  switch (segments[0]) {
    case "help":
      redux.getActions("page").set_active_tab("about", change_history);
      break;
    case "projects":
      if (segments.length > 1) {
        redux
          .getActions("projects")
          .load_target(
            segments.slice(1).join("/"),
            true,
            ignore_kiosk,
            change_history,
            Fragment.get(),
          );
      } else {
        redux.getActions("page").set_active_tab("projects", change_history);
      }
      break;
    case "settings":
      if (!logged_in) {
        return;
      }
      redux.getActions("page").set_active_tab("account", false);

      if (segments[1] === "billing") {
        const actions = redux.getActions("billing");
        actions?.update_customer();
        redux.getActions("account").set_active_tab("billing");
        if (actions == null) {
          // ugly temporary hack.
          setTimeout(() => {
            redux.getActions("billing")?.update_customer();
          }, 5000);
        }
        return;
      }

      redux.getActions("account").set_active_tab(segments[1]);

      break;

    case "notifications":
      if (!logged_in) return;
      const { filter, id } = getNotificationFilterFromFragment();
      if (filter) {
        redux.getActions("mentions").set_filter(filter, id);
      }
      redux.getActions("page").set_active_tab("notifications", change_history);
      break;

    case "file-use":
      // not implemented
      break;
    case "admin":
      if (!logged_in) {
        return;
      }
      redux.getActions("page").set_active_tab(segments[0], change_history);
      break;
  }
}

window.onpopstate = (_) => {
  load_target(
    decodeURIComponent(
      document.location.pathname.slice(
        appBasePath.length + (appBasePath.endsWith("/") ? 0 : 1),
      ),
    ),
    false,
    false,
  );
};

export function parse_target(target?: string):
  | { page: "projects" | "help" | "file-use" | "notifications" | "admin" }
  | { page: "project"; target: string }
  | {
      page: "account";
      tab: "account" | "billing" | "upgrades" | "licenses" | "support";
    }
  | {
      page: "notifications";
      tab: "mentions";
    } {
  if (target == undefined) {
    return { page: "account", tab: "account" };
  }
  const segments = target.split("/");
  switch (segments[0]) {
    case "projects":
      if (segments.length < 2 || (segments.length == 2 && segments[1] == "")) {
        return { page: "projects" };
      } else {
        return { page: "project", target: segments.slice(1).join("/") };
      }
    case "settings":
      switch (segments[1]) {
        case "account":
        case "billing":
        case "upgrades":
        case "licenses":
        case "support":
          return {
            page: "account",
            tab: segments[1] as
              | "account"
              | "billing"
              | "upgrades"
              | "licenses"
              | "support",
          };
        default:
          return { page: "account", tab: "account" };
      }
    case "notifications":
      return { page: "notifications" };
    case "help":
      return { page: "help" };
    case "file-use":
      return { page: "file-use" };
    case "admin":
      return { page: "admin" };
    default:
      return { page: "account", tab: "account" };
  }
}
