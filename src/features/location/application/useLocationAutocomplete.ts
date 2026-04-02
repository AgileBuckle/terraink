import { useCallback, useEffect, useRef, useState } from "react";
import { searchLocations } from "@/core/services";
import type { SearchResult } from "@/features/location/domain/types";

interface UseLocationAutocompleteReturn {
  locationSuggestions: SearchResult[];
  isLocationSearching: boolean;
  clearLocationSuggestions: () => void;
  searchNow: (query: string) => Promise<void>;
}

const DEBOUNCE_DELAY_MS = 450;

export function useLocationAutocomplete(
  locationInput: string,
  isFocused: boolean,
): UseLocationAutocompleteReturn {
  const [locationSuggestions, setLocationSuggestions] = useState<
    SearchResult[]
  >([]);
  const [isLocationSearching, setIsLocationSearching] = useState(false);
  const latestQueryRef = useRef("");
  const debounceIdRef = useRef<number | undefined>(undefined);

  const performSearch = useCallback(async (query: string) => {
    const q = String(query ?? "").trim();
    if (q.length < 2) {
      setLocationSuggestions([]);
      return;
    }

    latestQueryRef.current = q;
    setIsLocationSearching(true);

    try {
      const results = await searchLocations(q, 6);
      if (latestQueryRef.current === q) {
        setLocationSuggestions(results);
      }
    } catch {
      if (latestQueryRef.current === q) {
        setLocationSuggestions([]);
      }
    } finally {
      if (latestQueryRef.current === q) {
        setIsLocationSearching(false);
      }
    }
  }, []);

  const searchNow = useCallback(
    async (query: string) => {
      // Cancel any pending debounce so it doesn't fire again after the immediate search
      window.clearTimeout(debounceIdRef.current);
      debounceIdRef.current = undefined;
      await performSearch(query);
    },
    [performSearch],
  );

  useEffect(() => {
    const query = String(locationInput ?? "").trim();
    if (!isFocused || query.length < 2) {
      latestQueryRef.current = "";
      setLocationSuggestions([]);
      setIsLocationSearching(false);
      return undefined;
    }

    let cancelled = false;
    debounceIdRef.current = window.setTimeout(() => {
      if (!cancelled) {
        void performSearch(query);
      }
    }, DEBOUNCE_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(debounceIdRef.current);
      debounceIdRef.current = undefined;
    };
  }, [locationInput, isFocused, performSearch]);

  const clearLocationSuggestions = useCallback(() => {
    setLocationSuggestions([]);
  }, []);

  return {
    locationSuggestions,
    isLocationSearching,
    clearLocationSuggestions,
    searchNow,
  };
}
