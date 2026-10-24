// The outage map's projection: plain equirectangular, one unit per degree, cropped
// to where people live (Antarctica and the high Arctic left out).
export const LAT_TOP = 78;
export const LAT_BOTTOM = -56;
/** Grid spacing of the land dots, in degrees. */
export const STEP = 2.5;
export const WIDTH = 360;
export const HEIGHT = LAT_TOP - LAT_BOTTOM;

/** lat/lon → SVG x/y in the map's viewBox. */
export function project(lat: number, lon: number): [number, number] {
  return [lon + 180, LAT_TOP - Math.max(LAT_BOTTOM, Math.min(LAT_TOP, lat))];
}
