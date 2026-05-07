/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

// GDPR cookie consent banner shared between the SPA frontend and the Next.js
// landing pages. We use vanilla-cookieconsent v3 because it is framework
// agnostic — the same configuration object initialises the banner in both the
// SPA and the SSR-rendered Next.js app.
//
// Note: callers must `import "vanilla-cookieconsent/dist/cookieconsent.css"`
// themselves, alongside calling initCookieConsent. Next.js refuses global CSS
// imports from any file other than pages/_app.tsx, even transitively through
// an imported module — so the CSS import has to live directly in the entry.
// Helpers that don't need the CSS (e.g. the requireEssentialConsent gate used
// in sign-in/sign-up) live in ./index.

import { join } from "path";

import * as CookieConsent from "vanilla-cookieconsent";

import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import { markdown_to_html } from "@cocalc/frontend/markdown";

import { COOKIE_CATEGORIES, type CookieCategory } from "./categories";
import { COOKIE_CONSENT_REVISION } from "./index";
import { markBannerActive, markBannerDecidedDisabled } from "./state";
import { buildTranslation } from "./translations";

function buildCategoriesConfig(): Record<string, CookieConsent.Category> {
  const out: Record<string, CookieConsent.Category> = {};
  for (const raw of COOKIE_CATEGORIES) {
    // Widen from `as const satisfies` narrowing so optional fields are visible.
    const c: CookieCategory = raw;
    const entry: CookieConsent.Category = {
      enabled: c.defaultEnabled,
      readOnly: c.readOnly,
    };
    if (c.autoClearCookies && c.autoClearCookies.length > 0) {
      entry.autoClear = {
        cookies: c.autoClearCookies.map((x) => ({ name: x.name })),
      };
    }
    out[c.key] = entry;
  }
  return out;
}

let initialized = false;

export interface InitOptions {
  enabled?: boolean;
  // Markdown body shown in the banner & preferences modal.
  textMarkdown?: string;
}

// We never pass disablePageInteraction here. v3 only honours that at init,
// so it would not survive client-side navigation between non-auth and auth
// routes. Force-consent mode is applied separately via enableForceConsent
// from ./index, which toggles the same `disable--interaction` class on
// <html> as v3's built-in option and can be flipped on route changes.
export function initCookieConsent({
  enabled,
  textMarkdown,
}: InitOptions): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  if (!enabled) {
    // Customize loaded with banner disabled — flip the "decided" flag so
    // gate helpers (hasEssentialConsent, useEssentialConsent) stop being
    // conservative and pass through.
    markBannerDecidedDisabled();
    return;
  }
  initialized = true;
  markBannerActive();

  const descHtml = markdown_to_html(textMarkdown?.trim() || "");
  const privacyUrl = join(appBasePath, "policies/privacy");
  const termsUrl = join(appBasePath, "policies/terms");

  try {
    const runResult: any = CookieConsent.run({
      revision: COOKIE_CONSENT_REVISION,
      guiOptions: {
        consentModal: {
          layout: "box inline",
          position: "bottom right",
          equalWeightButtons: true,
          flipButtons: false,
        },
        preferencesModal: {
          layout: "bar",
          position: "right",
          equalWeightButtons: true,
          flipButtons: false,
        },
      },
      categories: buildCategoriesConfig(),
      language: {
        default: "en",
        translations: {
          en: buildTranslation(descHtml, privacyUrl, termsUrl),
        },
      },
    });
    if (runResult && typeof runResult.catch === "function") {
      runResult.catch((err: unknown) =>
        console.error("cookie-consent: run rejected", err),
      );
    }
  } catch (err) {
    console.error("cookie-consent: run threw", err);
  }
}

