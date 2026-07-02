# Cesium + Leaflet POC

A React (JavaScript) proof-of-concept stacking **Leaflet on top of Cesium**, kept in
sync, with projection reprojection and gated navigation.

## What it demonstrates

| Requirement | How it's done |
| --- | --- |
| Cesium is the **base** map | `#cesiumContainer` at `z-index: 1`, renders the raster basemap |
| Leaflet **above** it | `#leafletContainer` at `z-index: 2`, transparent background |
| Two Leaflet entities | a `L.polygon` and a `L.circleMarker` (vector — no marker-image bundling issues) |
| Raster in **EPSG:4326** | NASA GIBS "Blue Marble" via **WMS** (`epsg4326` endpoint) on a `GeographicTilingScheme` = 4326 (needs network) |
| Map shown in **EPSG:3857** | scene `mapProjection: new WebMercatorProjection()`; Cesium reprojects 4326→3857 on the GPU |
| Move only with **Space + left click** | Leaflet's built-in pan handler is off; drag is enabled only while `Space` is held |
| Zoom always available | custom `requestAnimationFrame`-eased, cursor-anchored wheel zoom (not gated on Space) |
| Libraries **synced** | on every Leaflet `move`, Cesium is centered via `setView` and its 2D frustum is set directly from the projected bounds |

## Run

```bash
cd D:\software\cesium-leaflet-poc
npm install
npm run dev
```

Open the printed URL (default http://localhost:5173). Hold **Space** and drag with the
left mouse button to pan; the Cesium basemap tracks the Leaflet overlay. Check the
browser console to see the display projection (`WebMercatorProjection`) and the raster
tiling scheme (`GeographicTilingScheme`) logged.

## Notes / how it works

- **Why one-way sync (Leaflet → Cesium)?** Leaflet is on top, so it receives all the
  input. Cesium's own camera controls are disabled (`enableInputs = false`) and it is
  driven purely from Leaflet's bounds. This avoids a feedback loop. Bidirectional sync
  is easy to add if Cesium ever needs to accept input too.
- **Why set the frustum directly (not `setView` with a rectangle)?** In Cesium's 2D
  mode, `camera.setView({ destination: rectangle })` fits the rectangle using the
  frustum's aspect ratio and, on non-square viewports, zooms out by the H/W factor —
  the base ends up mis-scaled vs the overlay. So `syncCesium` uses `setView` only to
  **center**, then sets the `OrthographicOffCenterFrustum` `left/right/top/bottom`
  directly from the Web Mercator projection of Leaflet's bounds. Aspect-proof; verified
  pixel-identical to Leaflet in portrait, square, and landscape.
- **Continuous rendering (not `requestRenderMode`).** `requestRenderMode` leaves
  Cesium's non-preserved WebGL buffer showing stale frames between its infrequent
  renders (the map appears stuck on an old view). The default continuous loop keeps the
  canvas current; `syncCesium` also renders on each `move` so the base stays locked to
  the overlay.
- **Navigation gating:** panning (left-drag) only works while `Space` is held; zoom
  (scroll wheel) is always available. Smooth zoom eases toward a target in fractional
  steps (`zoomSnap: 0`) via `requestAnimationFrame`.
- **Why WMS and not WMTS for GIBS?** GIBS's EPSG:4326 **WMTS** tile-matrix sets use an
  irregular grid (`2×1, 3×2, 5×3, 10×5, 20×10, …`) that does **not** match Cesium's
  `GeographicTilingScheme` power-of-two grid, so WMTS tiles land in the wrong place
  (Israel would render Pacific ocean). The **WMS** endpoint is bounding-box based, so
  Cesium's tiling scheme just requests each tile's 4326 bbox and gets correctly-placed
  imagery. Blue Marble is ~500 m/px, so `maximumLevel`/`maxZoom` are capped at 7.
- No Cesium Ion token needed — the base layer is overridden with the GIBS provider, so
  nothing hits Ion.
