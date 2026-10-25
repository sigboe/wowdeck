/** Wire model for api.tukui.org/v1/addons. Extracted from WowUp wowup-lib/src/models/tukui.ts (GPL-3.0), commit 4fdae600. */

export interface TukUiAddon {
  id: number;
  slug: string;
  author: string;
  name: string;
  url: string;
  version: string;
  changelog_url: string;
  ticket_url: string;
  git_url: string;
  patch: string[];
  last_update: string;
  web_url: string;
  directories: string[];
  small_desc: string;
  screenshot_url: string;
}
