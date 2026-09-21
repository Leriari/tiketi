import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api";

/**
 * Wraps the "fetch on mount" pattern almost every page uses, so error
 * handling is consistent everywhere instead of each page reinventing it (or,
 * as was the case nearly everywhere, not having any at all — a rejected
 * fetch left the page stuck on its loading skeleton forever). Spec §2.5
 * requires a real error state with retry on every screen.
 *
 * fetcher: () => Promise<T>, re-run whenever `deps` changes (defaults to
 * mount-only, like the useEffect(..., []) pattern it replaces).
 * Returns { data, error, retry, setData } — `retry` doubles as a general
 * "reload" function (e.g. after a mutation), `setData` is there for the rarer
 * case of an optimistic local update before the server confirms it.
 */
export function useApiData(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetcherRef.current()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey]);

  const retry = useCallback(() => {
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  return { data, error, retry, setData };
}
