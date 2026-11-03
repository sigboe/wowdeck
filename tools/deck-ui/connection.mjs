export const SSH_OPTIONS = [
  "-S", "none", "-o", "ControlMaster=no", "-o", "ControlPath=none",
  "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
  "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
];

export function createConnection(env, run, sleep) {
  const hosts = [...new Set([env.DECK, ...(env.DECK_HOSTS || "").split(",")].map((host) => host?.trim()).filter(Boolean))];
  let selected;
  let failures = [];
  const execute = (host, script, options = {}) => run("ssh", [...SSH_OPTIONS, host, script], {
    ...options, timeout: 30000, killSignal: "SIGKILL",
  });
  const probe = () => {
    failures = [];
    for (const host of hosts) {
      const result = execute(host, "true");
      if (result.code === 0) {
        selected = host;
        return true;
      }
      failures.push(`${host}: ${String(result.err).trim() || "SSH failed"}`);
    }
    return false;
  };
  const configured = () => {
    if (!hosts.length) throw new Error("set DECK=deck@<ip> or DECK_HOSTS in tools/deck-ui/local.env");
  };
  const host = () => {
    configured();
    if (!selected && !probe()) throw new Error(`Deck SSH unavailable: ${failures.join("; ")}`);
    return selected;
  };
  return {
    host,
    ssh: (script, options) => execute(host(), script, options),
    async up(wake) {
      configured();
      if (selected || probe()) return false;
      if (!env.DECK_WOL_MAC) throw new Error(`Deck SSH unavailable: ${failures.join("; ")}; configure DECK_WOL_MAC or ask the owner to wake it`);
      await wake();
      for (let attempt = 0; attempt < 8; attempt++) {
        await sleep(15000);
        if (probe()) return true;
      }
      throw new Error(`Deck SSH unavailable after Wake-on-LAN retries: ${failures.join("; ")}; ask the owner to check power and the USB Ethernet adapter`);
    },
  };
}
