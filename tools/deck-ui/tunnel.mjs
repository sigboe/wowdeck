import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import { SSH_OPTIONS } from "./connection.mjs";

export function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port: Number(port), host: "127.0.0.1", exclusive: true }, () => server.close(() => resolve(true)));
  });
}

// /proc start time prevents a stale pidfile from targeting a reused pid.
function identity(pid) {
  try { return fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")[19]; }
  catch { return null; }
}

export function tunnelIO(run) {
  return {
    free: portFree,
    holder(port) {
      const sockets = run("ss", ["-ltnp", `sport = :${port}`]);
      const pids = [...String(sockets.out).matchAll(/pid=(\d+)/g)].map(m => m[1]);
      return pids.map(pid => run("ps", ["-p", pid, "-o", "args="]).out.trim()).join("; ") || String(sockets.out).trim() || "unknown process (holder details unavailable)";
    },
    read(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } },
    write(file, value) { fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 }); },
    remove(file) { fs.rmSync(file, { force: true }); },
    identity,
    stop(pid) { process.kill(pid, "SIGTERM"); },
    async start(args) {
      const child = spawn("ssh", args, { detached: true, stdio: "ignore" });
      await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      child.unref();
      return { pid: child.pid, identity: identity(child.pid) };
    },
  };
}

export function createTunnel({ port, mcpPort, host, file }, io, sleep, say) {
  const ports = [...new Set([String(port), String(mcpPort)])];
  const current = () => {
    const record = io.read(file);
    return record && record.identity && io.identity(record.pid) === record.identity ? record : null;
  };
  const busy = async (p) => `port ${p}: ${await io.holder(p)}`;
  return {
    async up() {
      const owned = current();
      if (owned) {
        if (owned.host !== host) throw new Error(`owned scripts port ${port} belongs to ${owned.host}; run deck down before changing targets`);
        if (!owned.ports.includes(String(mcpPort))) say(`tunnel: MCP ${await busy(mcpPort)}; MCP does not belong to this run`);
        if (await io.free(port)) throw new Error(`recorded tunnel is not listening on ${port}; run deck down before retrying`);
        say(`tunnel: reusing owned tunnel to ${host}`);
        return;
      }
      if (!(await io.free(port))) throw new Error(`scripts ${await busy(port)}; leave the owner's tunnel untouched or choose DECK_UI_PORT`);
      const forwarded = [String(port)];
      if (String(mcpPort) !== String(port)) {
        if (await io.free(mcpPort)) forwarded.push(String(mcpPort));
        else say(`tunnel: MCP ${await busy(mcpPort)}; MCP reads that holder's device, not ${host}; scripts continue on ${port}`);
      }
      const args = [...SSH_OPTIONS, "-N", "-o", "ExitOnForwardFailure=yes",
        ...forwarded.flatMap(p => ["-L", `127.0.0.1:${p}:localhost:8080`]), host];
      const record = { ...await io.start(args), ports: forwarded, host };
      io.write(file, record);
      for (let i = 0; i < 150; i++) {
        if (!current()) {
          io.remove(file);
          throw new Error(`SSH tunnel exited; ${await Promise.all(forwarded.map(busy))}`);
        }
        if ((await Promise.all(forwarded.map(p => io.free(p)))).every(free => !free)) {
          say(`tunnel: opened pid ${record.pid} to ${host} on ${forwarded.join(", ")}`);
          return;
        }
        await sleep(100);
      }
      const details = await Promise.all(forwarded.map(busy));
      await this.down();
      throw new Error(`SSH tunnel did not bind within 15 s; ${details}; owned tunnel closed`);
    },
    async down() {
      const record = current();
      if (!record) {
        io.remove(file);
        return `tunnel: no owned tunnel (missing or stale pidfile); ${await Promise.all(ports.map(async p => `${p} ${await io.free(p) ? "free" : "busy"}`))}`;
      }
      io.stop(record.pid);
      for (let i = 0; i < 30 && io.identity(record.pid) === record.identity; i++) await sleep(100);
      if (io.identity(record.pid) === record.identity) throw new Error(`tunnel pid ${record.pid} did not stop; pidfile retained`);
      io.remove(file);
      return `tunnel: closed pid ${record.pid} to ${record.host}; ${await Promise.all(record.ports.map(async p => `${p} ${await io.free(p) ? "free" : `busy (${await io.holder(p)})`}`))}`;
    },
  };
}
