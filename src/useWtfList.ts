import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./services/backend";
import type { WtfListResult } from "./types";
import { reconcileWtfJob } from "./wtfBackupState";
import { friendlyWtfCallError } from "./wtfText";

/**
 * Loads `wtf.list` for one installation and keeps it fresh: reloads when
 * `refreshKey` changes (a job finished) and, while mounted, every
 * `pollMs` (WoW may be started or closed meanwhile). Newest request wins
 * (guide A1). A failed load is an error with a Retry — never an empty
 * list (guide A9). Also feeds the engine's view of the running job back
 * into the module store so a reopened UI re-attaches to it.
 */
export function useWtfList(installationId: string | null, refreshKey: number, pollMs = 10_000) {
  const [list, setList] = useState<WtfListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (!installationId) {
        setList(null);
        return;
      }
      const mine = ++requestRef.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await api.rpc("wtf.list", { installationId });
        if (mine !== requestRef.current) {
          return;
        }
        setList(result);
        setError(null);
        reconcileWtfJob(result.job);
      } catch (e) {
        if (mine === requestRef.current && !silent) {
          setError(friendlyWtfCallError(e));
        }
      } finally {
        if (mine === requestRef.current && !silent) {
          setLoading(false);
        }
      }
    },
    [installationId],
  );

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const timer = setInterval(() => void load(true), pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  return { list, error, loading, reload: load };
}
