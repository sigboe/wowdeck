import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./services/backend";
import type { GameRunning, WtfCopySource } from "./types";
import { friendlyWtfCallError } from "./wtfText";

/**
 * Loads `wtf.copySources` (the other WoW versions a Settings copy can bring
 * settings from) for one installation, reloading when `refreshKey` changes
 * (a job finished, a file was imported) and every `pollMs` while mounted.
 * Newest request wins (guide A1); a failed load is an error, never an empty
 * list (guide A9).
 */
export function useWtfCopySources(installationId: string, refreshKey: number, pollMs = 10_000) {
  const [sources, setSources] = useState<WtfCopySource[] | null>(null);
  const [dirAvailable, setDirAvailable] = useState(true);
  const [gameRunning, setGameRunning] = useState<GameRunning>("unknown");
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      const mine = ++requestRef.current;
      try {
        const result = await api.rpc("wtf.copySources", { installationId });
        if (mine !== requestRef.current) {
          return;
        }
        setSources(result.sources);
        setDirAvailable(result.dirAvailable);
        setGameRunning(result.gameRunning);
        setError(null);
      } catch (e) {
        if (mine === requestRef.current && !silent) {
          setError(friendlyWtfCallError(e));
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

  return { sources, dirAvailable, gameRunning, error, reload: load };
}
