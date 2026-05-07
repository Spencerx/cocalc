/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Translation } from "vanilla-cookieconsent";

import { COOKIE_CATEGORIES } from "./categories";

// English-only for the first version. The rest of CoCalc uses simplelocalize +
// JSON files; integrating the cookie banner with that pipeline is deferred to
// a follow-up PR. The vanilla-cookieconsent `autoDetect: 'browser'` setting
// still works — every locale just falls back to the `en` translation here.

export function buildTranslation(
  descHtml: string,
  privacyUrl: string,
  termsUrl: string,
): Translation {
  const footerLinks = `<a href="${privacyUrl}" target="_blank" rel="noopener noreferrer">Privacy policy</a>\n<a href="${termsUrl}" target="_blank" rel="noopener noreferrer">Terms of service</a>`;
  // The preferences modal has no built-in footer slot in v3, so we append the
  // policy links to the lead-in description as a small paragraph.
  const prefsLead = `${descHtml}\n<p style="margin-top: 0.75em; font-size: 0.9em;">${footerLinks.replace("\n", " · ")}</p>`;
  // Per-category sections derive from COOKIE_CATEGORIES, so adding a new
  // category there automatically adds it to the preferences modal too.
  const categorySections = COOKIE_CATEGORIES.map((c) => ({
    title: c.label,
    description: c.description,
    linkedCategory: c.key,
  }));
  return {
    consentModal: {
      title: "We value your privacy",
      description: descHtml,
      acceptAllBtn: "Accept all",
      acceptNecessaryBtn: "Necessary only",
      showPreferencesBtn: "Manage preferences",
      footer: footerLinks,
    },
    preferencesModal: {
      title: "Cookie preferences",
      acceptAllBtn: "Accept all",
      acceptNecessaryBtn: "Necessary only",
      savePreferencesBtn: "Save preferences",
      closeIconLabel: "Close",
      sections: [{ description: prefsLead }, ...categorySections],
    },
  };
}
