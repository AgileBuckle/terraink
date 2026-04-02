import { useCallback, useRef, useState } from "react";
import { usePosterContext } from "@/features/poster/ui/PosterContext";
import { reverseGeocodeCoordinates } from "@/core/services";
import { DEFAULT_DISTANCE_METERS } from "@/core/config";
import { GEOLOCATION_TIMEOUT_MS } from "@/features/map/infrastructure";
import {
  getGeolocationFailureMessage,
  requestCurrentPositionWithRetry,
} from "@/features/location/infrastructure";
import type { SearchResult } from "@/features/location/domain/types";

interface UseCurrentLocationReturn {
  handleUseCurrentLocation: () => void;
  isLocatingUser: boolean;
  locationPermissionMessage: string;
}

export function useCurrentLocation(
  flyToLocation: (lat: number, lon: number) => void,
): UseCurrentLocationReturn {
  const { dispatch } = usePosterContext();
  const [isLocatingUser, setIsLocatingUser] = useState(false);
  const isLocatingRef = useRef(false);
  const [locationPermissionMessage, setLocationPermissionMessage] =
    useState("");

  const handleUseCurrentLocation = useCallback(() => {
    if (isLocatingRef.current) return;
    isLocatingRef.current = true;

    setIsLocatingUser(true);
    void (async () => {
      const positionResult = await requestCurrentPositionWithRetry({
        timeoutMs: GEOLOCATION_TIMEOUT_MS,
        maxAttempts: 2,
      });

      if (!positionResult.ok) {
        setLocationPermissionMessage(
          getGeolocationFailureMessage(positionResult.reason),
        );
        isLocatingRef.current = false;
        setIsLocatingUser(false);
        return;
      }

      const { lat, lon } = positionResult;
      setLocationPermissionMessage("");
      flyToLocation(lat, lon);
      dispatch({
        type: "SET_FORM_FIELDS",
        resetDisplayNameOverrides: true,
        fields: {
          latitude: lat.toFixed(6),
          longitude: lon.toFixed(6),
          distance: String(DEFAULT_DISTANCE_METERS),
        },
      });

      try {
        const resolved = await reverseGeocodeCoordinates(lat, lon);
        dispatch({
          type: "SET_FORM_FIELDS",
          resetDisplayNameOverrides: true,
          fields: {
            location: resolved.label,
            displayCity: String(resolved.city ?? "").trim(),
            displayCountry: String(resolved.country ?? "").trim(),
            displayContinent: String(resolved.continent ?? "").trim(),
          },
        });
        dispatch({ type: "SET_USER_LOCATION", location: resolved });
      } catch {
        const fallback: SearchResult = {
          id: `user:${lat.toFixed(6)},${lon.toFixed(6)}`,
          label: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
          city: "",
          country: "",
          continent: "",
          lat,
          lon,
        };
        dispatch({
          type: "SET_FORM_FIELDS",
          resetDisplayNameOverrides: true,
          fields: { location: fallback.label },
        });
        dispatch({ type: "SET_USER_LOCATION", location: fallback });
      }

      isLocatingRef.current = false;
      setIsLocatingUser(false);
    })();
  }, [flyToLocation, dispatch]);

  return { handleUseCurrentLocation, isLocatingUser, locationPermissionMessage };
}
