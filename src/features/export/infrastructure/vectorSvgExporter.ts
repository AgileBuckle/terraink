import maplibregl from "maplibre-gl";
import type { Map as MaplibreMap, LayerSpecification } from "maplibre-gl";
import type {
  MarkerIconDefinition,
  MarkerItem,
} from "@/features/markers/domain/types";
import { projectMarkerToCanvas } from "@/features/markers/infrastructure/projection";
import {
  waitForMapIdle,
  createOffscreenContainer,
  resolveExportRenderParams,
} from "./exportUtils";
import {
  TEXT_DIMENSION_REFERENCE_PX,
  TEXT_CITY_Y_RATIO,
  TEXT_DIVIDER_Y_RATIO,
  TEXT_COUNTRY_Y_RATIO,
  TEXT_COORDS_Y_RATIO,
  TEXT_EDGE_MARGIN_RATIO,
  CITY_FONT_BASE_PX,
  COUNTRY_FONT_BASE_PX,
  COORDS_FONT_BASE_PX,
  ATTRIBUTION_FONT_BASE_PX,
  formatCityLabel,
  computeCityFontScale,
  computeAttributionColor,
} from "@/features/poster/domain/textLayout";
import { formatCoordinates } from "@/shared/geo/posterBounds";
import type { ResolvedTheme } from "@/features/theme/domain/types";
import { APP_CREDIT_URL } from "@/core/config";

interface VectorSvgOptions {
  map: MaplibreMap;
  exportWidth: number;
  exportHeight: number;
  theme: ResolvedTheme;
  center: { lat: number; lon: number };
  displayCity: string;
  displayCountry: string;
  fontFamily?: string;
  showPosterText: boolean;
  showOverlay: boolean;
  includeCredits: boolean;
  markers: MarkerItem[];
  markerIcons: MarkerIconDefinition[];
}

// ─── Expression evaluation ───────────────────────────────────────────────────
// The app's map style uses only two expression forms:
//   - static strings/numbers (theme colors)
//   - ["interpolate", ["linear"], ["zoom"], z0, v0, z1, v1, ...] for widths/opacities
// No data-driven or feature-property expressions are present, so this
// minimal evaluator covers 100% of the style.

function evalZoomInterpolation(zoom: number, expr: unknown[]): number {
  // pairs start at index 3: z0, v0, z1, v1, ...
  const n = expr.length;
  if (n < 5) return 0;
  if (zoom <= (expr[3] as number)) return expr[4] as number;
  if (zoom >= (expr[n - 2] as number)) return expr[n - 1] as number;
  for (let i = 3; i < n - 2; i += 2) {
    const z0 = expr[i] as number;
    const v0 = expr[i + 1] as number;
    const z1 = expr[i + 2] as number;
    const v1 = expr[i + 3] as number;
    if (zoom >= z0 && zoom <= z1) {
      return v0 + ((zoom - z0) / (z1 - z0)) * (v1 - v0);
    }
  }
  return expr[n - 1] as number;
}

function evalNum(expr: unknown, zoom: number, fallback: number): number {
  if (expr === null || expr === undefined) return fallback;
  if (typeof expr === "number") return expr;
  if (
    Array.isArray(expr) &&
    expr[0] === "interpolate" &&
    Array.isArray(expr[1]) &&
    (expr[1] as unknown[])[0] === "linear" &&
    Array.isArray(expr[2]) &&
    (expr[2] as unknown[])[0] === "zoom"
  ) {
    return evalZoomInterpolation(zoom, expr);
  }
  return fallback;
}

function evalColor(expr: unknown, fallback: string): string {
  if (typeof expr === "string" && expr.length > 0) return expr;
  return fallback;
}

// ─── Geometry → SVG path ─────────────────────────────────────────────────────

type Coord = number[];

function projectCoords(
  coords: Coord[],
  map: MaplibreMap,
  sx: number,
  sy: number,
  close: boolean,
): string {
  if (!coords.length) return "";
  const pts = coords.map(([lng, lat]) => {
    const p = map.project([lng, lat] as [number, number]);
    return `${(p.x * sx).toFixed(1)},${(p.y * sy).toFixed(1)}`;
  });
  return `M ${pts.join(" L ")}${close ? " Z" : ""}`;
}

function geomToPath(
  geom: GeoJSON.Geometry,
  map: MaplibreMap,
  sx: number,
  sy: number,
  fill: boolean,
): string {
  switch (geom.type) {
    case "Polygon":
      return fill
        ? geom.coordinates.map((r) => projectCoords(r, map, sx, sy, true)).join(" ")
        : "";
    case "MultiPolygon":
      return fill
        ? geom.coordinates
            .flatMap((poly) => poly.map((r) => projectCoords(r, map, sx, sy, true)))
            .join(" ")
        : "";
    case "LineString":
      return !fill ? projectCoords(geom.coordinates, map, sx, sy, false) : "";
    case "MultiLineString":
      return !fill
        ? geom.coordinates.map((l) => projectCoords(l, map, sx, sy, false)).join(" ")
        : "";
    default:
      return "";
  }
}

// ─── Per-layer SVG element builder ───────────────────────────────────────────

function buildLayerElement(
  exportMap: MaplibreMap,
  layer: LayerSpecification,
  zoom: number,
  sx: number,
  sy: number,
  w: number,
  h: number,
): string {
  type Paint = Record<string, unknown>;
  type Layout = Record<string, unknown>;
  const paint = (layer.paint ?? {}) as Paint;
  const layout = (layer.layout ?? {}) as Layout;

  if (layer.type === "background") {
    const color = evalColor(paint["background-color"], "#ffffff");
    return `<rect width="${w}" height="${h}" fill="${color}"/>`;
  }

  if (layer.type === "fill") {
    const color = evalColor(paint["fill-color"], "#888888");
    const opacity = evalNum(paint["fill-opacity"], zoom, 1);

    const features = exportMap.queryRenderedFeatures(undefined, {
      layers: [layer.id],
    });
    if (!features.length) return "";

    return features
      .map((f) => {
        const d = geomToPath(f.geometry, exportMap, sx, sy, true);
        return d
          ? `<path d="${d}" fill="${color}" fill-opacity="${opacity.toFixed(3)}" fill-rule="evenodd"/>`
          : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (layer.type === "line") {
    const color = evalColor(paint["line-color"], "#888888");
    const width = evalNum(paint["line-width"], zoom, 1) * sx;
    const opacity = evalNum(paint["line-opacity"], zoom, 1);
    const cap = String(layout["line-cap"] ?? "butt");
    const join = String(layout["line-join"] ?? "miter");

    const dashArray = paint["line-dasharray"];
    const dashAttr = Array.isArray(dashArray)
      ? ` stroke-dasharray="${(dashArray as number[]).map((d) => (d * width).toFixed(2)).join(",")}"`
      : "";

    const features = exportMap.queryRenderedFeatures(undefined, {
      layers: [layer.id],
    });
    if (!features.length) return "";

    return features
      .map((f) => {
        const d = geomToPath(f.geometry, exportMap, sx, sy, false);
        return d
          ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width.toFixed(2)}" stroke-opacity="${opacity.toFixed(3)}" stroke-linecap="${cap}" stroke-linejoin="${join}"${dashAttr}/>`
          : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

// ─── Map vector capture ──────────────────────────────────────────────────────

interface MapVectorResult {
  layerGroups: string;
  markerProjection: import("@/features/markers/domain/types").MarkerProjectionInput;
  markerScaleX: number;
  markerScaleY: number;
  markerSizeScale: number;
}

async function captureMapAsVectorSvg(
  map: MaplibreMap,
  exportWidth: number,
  exportHeight: number,
): Promise<MapVectorResult> {
  await waitForMapIdle(map);

  const {
    center,
    zoom,
    pitch,
    bearing,
    style,
    renderWidth,
    renderHeight,
    pixelRatio,
    markerProjection,
    markerScaleX,
    markerScaleY,
    markerSizeScale,
  } = resolveExportRenderParams(map, exportWidth, exportHeight);

  const offscreenContainer = createOffscreenContainer(renderWidth, renderHeight);
  document.body.appendChild(offscreenContainer);

  const exportMap = new maplibregl.Map({
    container: offscreenContainer,
    style,
    center: [center.lng, center.lat],
    zoom,
    pitch,
    bearing,
    interactive: false,
    attributionControl: false,
    pixelRatio,
  });

  try {
    await waitForMapIdle(exportMap);

    // Scale from CSS-pixel viewport space to export pixel space
    const sx = exportWidth / renderWidth;
    const sy = exportHeight / renderHeight;

    const exportStyle = exportMap.getStyle();
    const layerGroups: string[] = [];

    for (const layer of exportStyle.layers ?? []) {
      const vis = String(
        exportMap.getLayoutProperty(layer.id, "visibility") ?? "visible",
      );
      if (vis === "none") continue;

      const element = buildLayerElement(
        exportMap,
        layer,
        zoom,
        sx,
        sy,
        exportWidth,
        exportHeight,
      );
      if (element) {
        layerGroups.push(
          `<g id="map-layer-${layer.id.replace(/[^a-zA-Z0-9_-]/g, "-")}">\n${element}\n</g>`,
        );
      }
    }

    return {
      layerGroups: layerGroups.join("\n"),
      markerProjection,
      markerScaleX,
      markerScaleY,
      markerSizeScale,
    };
  } finally {
    exportMap.remove();
    offscreenContainer.remove();
  }
}

// ─── Overlay helpers ─────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function extractSvgInner(markup: string): { viewBox: string; inner: string } {
  const vb = /viewBox=["']([^"']+)["']/i.exec(markup);
  const inner = markup
    .replace(/<svg[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "");
  return { viewBox: vb?.[1] ?? "0 0 24 24", inner };
}

function buildFontDefs(fontFamily?: string): string {
  const families: string[] = [
    "Space+Grotesk:wght@300;400;700",
    "IBM+Plex+Mono:wght@300;400",
  ];
  if (fontFamily?.trim()) {
    families.push(fontFamily.trim().replace(/ /g, "+"));
  }
  const url =
    "https://fonts.googleapis.com/css2?" +
    families.map((f) => `family=${f}`).join("&") +
    "&display=swap";
  return `<style type="text/css"><![CDATA[@import url('${url}');]]></style>`;
}

// ─── Public export ────────────────────────────────────────────────────────────

export async function createVectorSvgBlobFromMap({
  map,
  exportWidth,
  exportHeight,
  theme,
  center,
  displayCity,
  displayCountry,
  fontFamily,
  showPosterText,
  showOverlay,
  includeCredits,
  markers,
  markerIcons,
}: VectorSvgOptions): Promise<Blob> {
  const w = exportWidth;
  const h = exportHeight;

  const { layerGroups, markerProjection, markerScaleX, markerScaleY, markerSizeScale } =
    await captureMapAsVectorSvg(map, w, h);

  const textColor = theme.ui?.text ?? "#111111";
  const landColor = theme.map?.land ?? "#808080";
  const bgColor = theme.ui?.bg ?? "#ffffff";

  const dimScale = Math.max(0.45, Math.min(w, h) / TEXT_DIMENSION_REFERENCE_PX);

  // ─── Fades ──────────────────────────────────────────────────────────────────

  const fadeDefs = showOverlay
    ? `
  <linearGradient id="vsvg-fade-top" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${bgColor}" stop-opacity="1"/>
    <stop offset="1" stop-color="${bgColor}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="vsvg-fade-bottom" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${bgColor}" stop-opacity="0"/>
    <stop offset="1" stop-color="${bgColor}" stop-opacity="1"/>
  </linearGradient>`
    : "";

  const fadesGroup = showOverlay
    ? `<g id="overlay-fades">
  <rect x="0" y="0" width="${w}" height="${h * 0.25}" fill="url(#vsvg-fade-top)"/>
  <rect x="0" y="${h * 0.75}" width="${w}" height="${h * 0.25}" fill="url(#vsvg-fade-bottom)"/>
</g>`
    : "";

  // ─── Markers ────────────────────────────────────────────────────────────────

  const markerFilterDefs: string[] = [];
  const markerElements: string[] = [];

  if (markers.length > 0 && markerIcons.length > 0) {
    for (const marker of markers) {
      const icon = markerIcons.find((e) => e.id === marker.iconId);
      if (!icon) continue;

      const pt = projectMarkerToCanvas(marker.lat, marker.lon, markerProjection);
      const px = pt.x * markerScaleX;
      const py = pt.y * markerScaleY;
      const size = marker.size * Math.max(markerScaleX, markerScaleY) * markerSizeScale;
      const ix = (px - size / 2).toFixed(2);
      const iy = (py - size / 2).toFixed(2);
      const sz = size.toFixed(2);
      const sid = sanitizeId(marker.id);

      if (icon.kind === "svg" && icon.svgMarkup) {
        const colored = icon.svgMarkup.split("currentColor").join(marker.color);
        const { viewBox, inner } = extractSvgInner(colored);
        markerElements.push(
          `<svg x="${ix}" y="${iy}" width="${sz}" height="${sz}" viewBox="${viewBox}" overflow="visible">${inner}</svg>`,
        );
      } else if (icon.dataUrl) {
        if (icon.tintWithMarkerColor) {
          const fid = `tint-${sid}`;
          markerFilterDefs.push(
            `<filter id="${fid}"><feFlood flood-color="${marker.color}" result="flood"/><feComposite in="flood" in2="SourceAlpha" operator="in"/></filter>`,
          );
          markerElements.push(
            `<image href="${icon.dataUrl}" x="${ix}" y="${iy}" width="${sz}" height="${sz}" filter="url(#${fid})"/>`,
          );
        } else {
          markerElements.push(
            `<image href="${icon.dataUrl}" x="${ix}" y="${iy}" width="${sz}" height="${sz}"/>`,
          );
        }
      }
    }
  }

  const markersGroup =
    markerElements.length > 0
      ? `<g id="overlay-markers">\n${markerElements.join("\n")}\n</g>`
      : "";

  // ─── Text ────────────────────────────────────────────────────────────────────

  const titleFont = fontFamily?.trim()
    ? `'${fontFamily.trim()}', 'Space Grotesk', sans-serif`
    : `'Space Grotesk', sans-serif`;
  const bodyFont = fontFamily?.trim()
    ? `'${fontFamily.trim()}', 'IBM Plex Mono', monospace`
    : `'IBM Plex Mono', monospace`;

  const attributionColor = computeAttributionColor(textColor, landColor, showOverlay);
  const attributionAlpha = showOverlay ? 0.55 : 0.9;
  const attributionFontSize = (ATTRIBUTION_FONT_BASE_PX * dimScale).toFixed(2);
  const attributionY = (h * (1 - TEXT_EDGE_MARGIN_RATIO)).toFixed(2);

  const textElements: string[] = [];

  if (showPosterText) {
    const cityLabel = formatCityLabel(displayCity);
    const cityFontSize = (
      CITY_FONT_BASE_PX * dimScale * computeCityFontScale(displayCity)
    ).toFixed(2);
    const countryFontSize = (COUNTRY_FONT_BASE_PX * dimScale).toFixed(2);
    const coordFontSize = (COORDS_FONT_BASE_PX * dimScale).toFixed(2);

    textElements.push(
      `<text x="${(w * 0.5).toFixed(2)}" y="${(h * TEXT_CITY_Y_RATIO).toFixed(2)}" font-family="${esc(titleFont)}" font-size="${cityFontSize}" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="${textColor}">${esc(cityLabel)}</text>`,
    );
    textElements.push(
      `<line x1="${(w * 0.4).toFixed(2)}" y1="${(h * TEXT_DIVIDER_Y_RATIO).toFixed(2)}" x2="${(w * 0.6).toFixed(2)}" y2="${(h * TEXT_DIVIDER_Y_RATIO).toFixed(2)}" stroke="${textColor}" stroke-width="${(3 * dimScale).toFixed(2)}"/>`,
    );
    textElements.push(
      `<text x="${(w * 0.5).toFixed(2)}" y="${(h * TEXT_COUNTRY_Y_RATIO).toFixed(2)}" font-family="${esc(titleFont)}" font-size="${countryFontSize}" font-weight="300" text-anchor="middle" dominant-baseline="middle" fill="${textColor}">${esc(displayCountry.toUpperCase())}</text>`,
    );
    textElements.push(
      `<text x="${(w * 0.5).toFixed(2)}" y="${(h * TEXT_COORDS_Y_RATIO).toFixed(2)}" font-family="${esc(bodyFont)}" font-size="${coordFontSize}" font-weight="400" text-anchor="middle" dominant-baseline="middle" fill="${textColor}" fill-opacity="0.75">${esc(formatCoordinates(center.lat, center.lon))}</text>`,
    );
  }

  textElements.push(
    `<text x="${(w * (1 - TEXT_EDGE_MARGIN_RATIO)).toFixed(2)}" y="${attributionY}" font-family="${esc(bodyFont)}" font-size="${attributionFontSize}" font-weight="300" text-anchor="end" dominant-baseline="auto" fill="${attributionColor}" fill-opacity="${attributionAlpha}">\u00a9 OpenStreetMap contributors</text>`,
  );
  if (includeCredits) {
    textElements.push(
      `<text x="${(w * TEXT_EDGE_MARGIN_RATIO).toFixed(2)}" y="${attributionY}" font-family="${esc(bodyFont)}" font-size="${attributionFontSize}" font-weight="300" text-anchor="start" dominant-baseline="auto" fill="${attributionColor}" fill-opacity="${attributionAlpha}">\u00a9 ${esc(APP_CREDIT_URL)}</text>`,
    );
  }

  const textGroup = `<g id="overlay-text">\n${textElements.join("\n")}\n</g>`;

  // ─── Assemble ────────────────────────────────────────────────────────────────

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="hidden">
<defs>
${buildFontDefs(fontFamily)}
${fadeDefs}
${markerFilterDefs.join("\n")}
</defs>
<g id="map">
${layerGroups}
</g>
${fadesGroup}
${markersGroup}
${textGroup}
</svg>`;

  return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
}
