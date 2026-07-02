# Cesium + Leaflet POC

A React (JavaScript) proof-of-concept stacking **Leaflet on top of Cesium**, kept in
sync, with projection reprojection and gated navigation.

## What it demonstrates

| Requirement | How it's done |
| --- | --- |
| Cesium is the **base** map | `#cesiumContainer` at `z-index: 1`, renders the raster basemap |
| Leaflet **above** it | `#leafletContainer` at `z-index: 2`, transparent background |
| Two Leaflet entities | a `L.polygon` and a `L.circleMarker` (vector — no marker-image bundling issues) |
| Raster in **EPSG:4326** | NASA GIBS "Blue Marble" via WMTS on a `GeographicTilingScheme` = 4326 (needs network) |
| Map shown in **EPSG:3857** | scene `mapProjection: new WebMercatorProjection()`; Cesium reprojects 4326→3857 on the GPU |
| Move only with **Space + left click** | Leaflet's built-in pan handler is off; drag is enabled only while `Space` is held |
| Zoom always available | custom `requestAnimationFrame`-eased, cursor-anchored wheel zoom (not gated on Space) |
| Libraries **synced** | on every Leaflet `move`, Cesium is framed to Leaflet's exact bounds and repainted in the same tick |

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
- **Why bounds-rectangle sync?** Both libraries display in Web Mercator, and the two
  containers are the same size (same aspect ratio). Handing Cesium the exact lat/lng
  rectangle Leaflet shows makes Cesium fill the viewport identically.
- **Navigation gating:** panning (left-drag) only works while `Space` is held; zoom
  (scroll wheel) is always available. To also gate zoom behind Space, disable the custom
  wheel handler and toggle it in the Space key handlers.
- **Smooth zoom in lockstep:** the wheel handler eases toward a target zoom in small
  fractional steps (`zoomSnap: 0`) on each animation frame. Cesium is set to render
  on demand (`requestRenderMode`) and repainted synchronously inside the sync, so the
  base map updates in the same frame as the overlay instead of drifting on its own loop.
- **Raster detail / zoom cap:** GIBS "Blue Marble" is served from the `500m` tile matrix
  set, whose deepest level is **7** (`maximumLevel: 7`; level 8 returns HTTP 400). The
  map's `maxZoom` is capped to 7 to match, so you never zoom past the native resolution
  into a blur. For finer detail you'd swap in a higher-resolution EPSG:4326 layer.
- No Cesium Ion token needed — the base layer is overridden with the GIBS provider, so
  nothing hits Ion.
