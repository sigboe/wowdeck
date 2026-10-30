import { describe, expect, test } from "bun:test";
import {
  aboutRows,
  fundingText,
  lastAboutInfo,
  noticesText,
  rememberAboutInfo,
  shortUrl,
} from "./about";
import type { AboutInfo } from "./types";

const info = (over: Partial<AboutInfo> = {}): AboutInfo => ({
  notices: "# Third-party notices\n",
  funding: [],
  supporters: [],
  ...over,
});

const ids = (rows: ReturnType<typeof aboutRows>) => rows.map((row) => row.id);

describe("aboutRows", () => {
  test("Third-party notices shows with the notices text", () => {
    expect(ids(aboutRows(info()))).toEqual(["thirdPartyNotices"]);
  });

  test("Third-party notices always shows: unreadable notices, and before about.get answers", () => {
    expect(ids(aboutRows(info({ notices: null })))).toEqual(["thirdPartyNotices"]);
    expect(ids(aboutRows(null))).toEqual(["thirdPartyNotices"]);
  });
});

describe("aboutRows: Supporters", () => {
  test("hidden while there are no names, and before about.get answers", () => {
    expect(ids(aboutRows(info({ supporters: [] })))).toEqual(["thirdPartyNotices"]);
    expect(ids(aboutRows(null))).toEqual(["thirdPartyNotices"]);
  });

  test("with names it shows, before Third-party notices", () => {
    expect(ids(aboutRows(info({ supporters: ["Ada Lovelace"] })))).toEqual([
      "showSupporters",
      "thirdPartyNotices",
    ]);
  });

  test("the row reads Supporters", () => {
    const row = aboutRows(info({ supporters: ["Ada Lovelace"] }))[0]!;
    expect(row.label).toBe("Supporters");
    expect(row.description).toBe("The people who fund WoWDeck and asked to be thanked by name");
  });
});

describe("aboutRows: Support WoWDeck", () => {
  const link = { kind: "web" as const, name: "Ko-fi", url: "https://ko-fi.com/wowdeck" };

  test("hidden while there are no Funding links, and before about.get answers", () => {
    expect(ids(aboutRows(info({ funding: [] })))).toEqual(["thirdPartyNotices"]);
    expect(ids(aboutRows(null))).toEqual(["thirdPartyNotices"]);
  });

  test("with links it shows first", () => {
    expect(ids(aboutRows(info({ funding: [link] })))).toEqual([
      "supportWoWDeck",
      "thirdPartyNotices",
    ]);
  });

  test("the full order is Support WoWDeck, Supporters, Third-party notices", () => {
    expect(ids(aboutRows(info({ funding: [link], supporters: ["Ada Lovelace"] })))).toEqual([
      "supportWoWDeck",
      "showSupporters",
      "thirdPartyNotices",
    ]);
  });

  test("the row reads Support WoWDeck", () => {
    const row = aboutRows(info({ funding: [link] }))[0]!;
    expect(row.label).toBe("Support WoWDeck");
    expect(row.description).toBe("Scan a code with your phone to fund WoWDeck");
  });
});

describe("shortUrl", () => {
  test("drops the scheme, a leading www. and a trailing slash", () => {
    expect(shortUrl("https://ko-fi.com/wowdeck")).toBe("ko-fi.com/wowdeck");
    expect(shortUrl("https://www.patreon.com/wowdeck/")).toBe("patreon.com/wowdeck");
    expect(shortUrl("https://paypal.me/")).toBe("paypal.me");
  });

  test("keeps a query, which the link needs", () => {
    expect(shortUrl("https://www.paypal.com/donate/?hosted_button_id=X")).toBe(
      "paypal.com/donate/?hosted_button_id=X",
    );
  });
});

describe("fundingText", () => {
  test("a web link prints its short URL", () => {
    expect(fundingText({ kind: "web", name: "Ko-fi", url: "https://ko-fi.com/wowdeck" })).toBe(
      "ko-fi.com/wowdeck",
    );
  });

  test("a Bitcoin link prints its full address, without the bitcoin: scheme", () => {
    const address = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";
    expect(fundingText({ kind: "bitcoin", name: "Bitcoin", url: `bitcoin:${address}` })).toBe(
      address,
    );
  });
});

describe("noticesText", () => {
  test("the notices modal shows the plugin's notices without their H1, the modal's title", () => {
    expect(noticesText(info({ notices: "# Notices\n\n## WowUp\n\nGPL-3.0\n" }))).toBe(
      "## WowUp\n\nGPL-3.0\n",
    );
    expect(noticesText(info({ notices: "## WowUp\n\nGPL-3.0\n" }))).toBe("## WowUp\n\nGPL-3.0\n");
  });

  test("unreadable or not yet loaded notices point to the repository instead", () => {
    const fallback =
      "Couldn't read the notices from this install. They're in THIRD_PARTY_NOTICES.md on github.com/sigboe/wowdeck.";
    expect(noticesText(info({ notices: null }))).toBe(fallback);
    expect(noticesText(info({ notices: "  \n" }))).toBe(fallback);
    expect(noticesText(info({ notices: "# Notices\n" }))).toBe(fallback);
    expect(noticesText(null)).toBe(fallback);
  });
});

describe("lastAboutInfo", () => {
  test("a remounted About section starts from the last answer, so its rows are there at once", () => {
    const answer = info({
      funding: [{ kind: "web" as const, name: "Ko-fi", url: "https://ko-fi.com/wowdeck" }],
      supporters: ["Ada Lovelace"],
    });
    rememberAboutInfo(answer);
    expect(ids(aboutRows(lastAboutInfo()))).toEqual([
      "supportWoWDeck",
      "showSupporters",
      "thirdPartyNotices",
    ]);
  });
});
