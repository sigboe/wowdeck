import { PluginUpdateCheck } from "../../../../backend/src/wow/notifications/PluginUpdateCheck";
const release = (tag: string) => ({tag_name: tag, html_url: "https://fixture.invalid/"+tag, assets:[{name:"WoWDeck.zip",url:"https://fixture.invalid/zip"}]});
let list = [release("v0.2.1-beta.9"),release("v0.2.1-beta.12"),release("v0.2.0")];
const net = { getJson: async (url: string) => url.includes("/latest") ? release("v0.2.0") : list };
const check = new PluginUpdateCheck(net as never, "0.1.1", undefined, undefined, undefined, {now:()=>1800000000000});
for (const [channel,want] of [["stable","0.2.0"],["beta","0.2.1-beta.12"]] as const) {
 const result = await check.setChannel(channel);
 if(result.offer?.version !== want) throw Error(channel+": unexpected offer");
 console.log(JSON.stringify({channel,offered:result.offer.version,pass:true}));
}
list = [release("v0.3.0-beta.40"),release("v0.3.0"),release("v0.2.1-beta.12")];
const result = await check.check({force:true});
if(result.offer?.version !== "0.3.0") throw Error("Stable must win on Beta");
console.log(JSON.stringify({channel:"beta",offered:result.offer.version,stableBeatsBeta:true,pass:true}));
