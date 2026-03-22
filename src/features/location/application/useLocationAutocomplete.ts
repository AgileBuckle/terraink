import { useCallback, useEffect, useState } from "react";
import { searchLocations } from "@/core/services";
import type { SearchResult } from "@/features/location/domain/types";

interface UseLocationAutocompleteReturn {
  locationSuggestions: SearchResult[];
  isLocationSearching: boolean;
  clearLocationSuggestions: () => void;
}

const DEBOUNCE_DELAY_MS = 1000;

export function useLocationAutocomplete(
  locationInput: string,
  isFocused: boolean,
): UseLocationAutocompleteReturn {
  const [locationSuggestions, setLocationSuggestions] = useState<
    SearchResult[]
  >([]);
  const [isLocationSearching, setIsLocationSearching] = useState(false);

  useEffect(() => {
    const query = String(locationInput ?? "").trim();
    if (!isFocused || query.length < 2) {
      setLocationSuggestions([]);
      setIsLocationSearching(false);
      return undefined;
    }

    let cancelled = false;
    const debounceId = window.setTimeout(async () => {
      setIsLocationSearching(true);
      try {
        const suggestions = await searchLocations(query, 6);
        if (!cancelled) {
          setLocationSuggestions(suggestions as SearchResult[]);
        }
      } catch {
        if (!cancelled) {
          setLocationSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setIsLocationSearching(false);
        }
      }
    }, DEBOUNCE_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(debounceId);
    };
  }, [locationInput, isFocused]);

  const clearLocationSuggestions = useCallback(() => {
    setLocationSuggestions([]);
  }, []);

  return {
    locationSuggestions,
    isLocationSearching,
    clearLocationSuggestions,
  };
}
