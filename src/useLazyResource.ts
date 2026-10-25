import { useEffect, useRef, useState } from "react";
import { errorText } from "./errors";

export interface LazyResource<T> {
  value: T | null;
  loading: boolean;
  /** The failure in plain words; distinct from an empty value (a missing changelog is not an error). */
  error: string | null;
}

/**
 * A value fetched once per component instance (requested-ref guard): `load`
 * runs on the first render that passes one and never again. Pass null to
 * wait (nothing to fetch yet, or never).
 */
export function useLazyResource<T>(load: (() => Promise<T>) | null): LazyResource<T> {
  const [state, setState] = useState<LazyResource<T>>({ value: null, loading: false, error: null });
  const requested = useRef(false);
  const wanted = load !== null;
  useEffect(() => {
    if (requested.current || !load) {
      return;
    }
    requested.current = true;
    setState({ value: null, loading: true, error: null });
    load().then(
      (value) => setState({ value, loading: false, error: null }),
      (e) => setState({ value: null, loading: false, error: errorText(e) }),
    );
    // Only whether to load matters: the first load is the one kept.
  }, [wanted]);
  return state;
}
