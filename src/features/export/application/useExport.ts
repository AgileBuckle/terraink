import { useCallback } from "react";
import { usePosterContext } from "@/features/poster/ui/PosterContext";
import { captureMapAsCanvas } from "@/features/export/infrastructure/mapExporter";
import { compositeExport } from "@/features/poster/infrastructure/renderer";
import { resolveCanvasSize } from "@/features/poster/infrastructure/renderer/canvas";
import { getAllMarkerIcons } from "@/features/markers/infrastructure/iconRegistry";
import { ensureGoogleFont } from "@/core/services";
import {
  createPngBlob,
  createPdfBlobFromCanvas,
  createPosterFilename,
  triggerDownloadBlob,
} from "@/core/services";
import {
  CM_PER_INCH,
  DEFAULT_POSTER_WIDTH_CM,
  DEFAULT_POSTER_HEIGHT_CM,
} from "@/core/config";

/**
 * Provides handlers for exporting the live poster preview as PNG or PDF.
 *
 * Flow:
 * 1. Resize MapLibre container to full export resolution.
 * 2. Wait for tiles at new resolution.
 * 3. Snapshot the WebGL canvas.
 * 4. Composite fades + text onto the snapshot.
 * 5. Download.
 */
export function useExport() {
  const { state, dispatch, effectiveTheme, mapRef } = usePosterContext();
  const { form } = state;
  const hasVisibleMarkers = state.markers.length > 0;

  const exportPoster = useCallback(
    async (format: "png" | "pdf") => {
      const map = mapRef.current;
      if (!map) {
        dispatch({ type: "SET_ERROR", error: "Map is not ready." });
        return;
      }

      dispatch({ type: "START_EXPORT" });

      try {
        // Ensure font is loaded before compositing text
        if (form.showPosterText && form.fontFamily.trim()) {
          await ensureGoogleFont(form.fontFamily.trim());
        }

        const widthCm = Number(form.width) || DEFAULT_POSTER_WIDTH_CM;
        const heightCm = Number(form.height) || DEFAULT_POSTER_HEIGHT_CM;
        const dpi = Number(form.dpi) || 300;
        const widthInches = widthCm / CM_PER_INCH;
        const heightInches = heightCm / CM_PER_INCH;

        const size = resolveCanvasSize(widthInches, heightInches, dpi);

        // 1. Capture map at full export resolution
        const { canvas: mapCanvas, markerProjection, markerScaleX, markerScaleY } =
          await captureMapAsCanvas(
          map,
          size.width,
          size.height,
          );

        // 2. Composite fades + text
        const lat = Number(form.latitude) || 0;
        const lon = Number(form.longitude) || 0;

        const { canvas } = await compositeExport(mapCanvas, {
          theme: effectiveTheme,
          center: { lat, lon },
          widthInches,
          heightInches,
          displayCity: form.displayCity || form.location || "",
          displayCountry: form.displayCountry || "",
          fontFamily: form.fontFamily.trim(),
          showPosterText: form.showPosterText,
          includeCredits: form.includeCredits,
          markers: hasVisibleMarkers ? state.markers : [],
          markerIcons: hasVisibleMarkers
            ? getAllMarkerIcons(state.customMarkerIcons)
            : [],
          markerProjection: hasVisibleMarkers ? markerProjection : undefined,
          markerScaleX: hasVisibleMarkers ? markerScaleX : undefined,
          markerScaleY: hasVisibleMarkers ? markerScaleY : undefined,
        });

        // 3. Download
        const filename = createPosterFilename(
          form.displayCity || form.location,
          form.theme,
          format,
        );

        if (format === "pdf") {
          const pdfBlob = createPdfBlobFromCanvas(canvas, {
            widthCm,
            heightCm,
          });
          triggerDownloadBlob(pdfBlob, filename);
        } else {
          const pngBlob = await createPngBlob(canvas, dpi);
          triggerDownloadBlob(pngBlob, filename);
        }

        dispatch({ type: "FINISH_EXPORT" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Export failed.";
        dispatch({ type: "FAIL_EXPORT", error: message });
      }
    },
    [
      mapRef,
      form,
      effectiveTheme,
      dispatch,
      hasVisibleMarkers,
      state.markers,
      state.customMarkerIcons,
    ],
  );

  const handleDownloadPng = useCallback(
    () => exportPoster("png"),
    [exportPoster],
  );

  const handleDownloadPdf = useCallback(
    () => exportPoster("pdf"),
    [exportPoster],
  );

  return { handleDownloadPng, handleDownloadPdf };
}
