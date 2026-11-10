/** "Normal · Horde"; a realm with one auction house for both factions is just its name. */
export function realmLabel(name: string, auctionHouseType: string): string {
  return auctionHouseType === "ALL"
    ? name
    : `${name} · ${auctionHouseType[0]}${auctionHouseType.slice(1).toLowerCase()}`;
}
