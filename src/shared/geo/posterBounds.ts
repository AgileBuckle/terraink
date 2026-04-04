export function formatCoordinates(lat: number, lon: number): string {
  const northSouth = lat >= 0 ? "N" : "S";
  const eastWest = lon >= 0 ? "E" : "W";

  return `${Math.abs(lat).toFixed(4)}° ${northSouth} / ${Math.abs(lon).toFixed(
    4,
  )}° ${eastWest}`;
}
