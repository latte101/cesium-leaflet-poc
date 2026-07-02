import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function MapView() {
  const cesiumRef = useRef(null);
  const leafletRef = useRef(null);

  useEffect(() => {
    // =====================================================================
    // 1. CESIUM — the BASE map
    // ---------------------------------------------------------------------
    // Raster source: NASA GIBS "Blue Marble", served on a
    // GeographicTilingScheme => EPSG:4326. Unlike the bundled Natural Earth II
    // (native level ~2, so it just upsamples into a blur when you zoom in),
    // GIBS has real tile levels (0–7 @ 500m/px), so zooming loads sharper
    // tiles. We force the scene projection to Web Mercator (EPSG:3857), so
    // Cesium still reprojects the 4326 tiles to 3857 on the GPU for display.
    // (Requires network access.)
    // =====================================================================
    const baseProvider = new Cesium.WebMapTileServiceImageryProvider({
      url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi',
      layer: 'BlueMarble_ShadedRelief_Bathymetry',
      style: 'default',
      format: 'image/jpeg',
      tileMatrixSetID: '500m',
      maximumLevel: 7, // top level of the GIBS "500m" set (level 8 returns 400)
      tileWidth: 512,
      tileHeight: 512,
      tilingScheme: new Cesium.GeographicTilingScheme(), // EPSG:4326 source
    });
    const baseLayer = new Cesium.ImageryLayer(baseProvider);

    const viewer = new Cesium.Viewer(cesiumRef.current, {
      baseLayer,
      sceneMode: Cesium.SceneMode.SCENE2D,
      mapProjection: new Cesium.WebMercatorProjection(), // EPSG:3857 display
      // Bare basemap: strip every default widget.
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });

    // Cesium never navigates itself — Leaflet is the single source of input
    // and drives the camera through the sync function below.
    viewer.scene.screenSpaceCameraController.enableInputs = false;

    // Render ON DEMAND instead of on a free-running loop. Because Leaflet
    // drives the camera, a separate render loop just repaints a frame behind
    // the sync (and can drop frames independently), so the base map visibly
    // lags the overlay during a zoom/pan. Repainting only when we sync it
    // (see syncCesium) locks the base's motion to the overlay's.
    // Imagery tile loads still request their own renders automatically.
    viewer.scene.requestRenderMode = true;
    viewer.scene.maximumRenderTimeChange = Infinity;

    // Proof of the projection setup (visible in the console).
    console.log('[cesium] display projection :', viewer.scene.mapProjection.constructor.name);
    console.log('[cesium] raster tiling scheme :', baseProvider.tilingScheme.constructor.name);

    // =====================================================================
    // 2. LEAFLET — transparent overlay on TOP
    // ---------------------------------------------------------------------
    // Default CRS is L.CRS.EPSG3857, which matches Cesium's display
    // projection, so the vector entities line up with the reprojected raster.
    // All built-in navigation is OFF; we re-enable it only while Space is
    // held (see step 5).
    // =====================================================================
    const map = L.map(leafletRef.current, {
      center: [32.0, 34.8],
      zoom: 6,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false, // replaced by the custom smooth zoom (section 6)
      zoomSnap: 0, // allow fractional zoom levels so stepping looks continuous
      minZoom: 2,
      maxZoom: 7, // matches the GIBS layer's native resolution (no over-zoom blur)
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    });

    // =====================================================================
    // 3. Entities — Leaflet vectors + a Leaflet/Cesium circle pair
    // =====================================================================
    const polygon = L.polygon(
      [
        [33.2, 34.6],
        [33.2, 36.2],
        [31.6, 35.4],
      ],
      { color: '#ff5722', weight: 2, fillOpacity: 0.25 }
    ).addTo(map);
    polygon.bindTooltip('Entity 1 — polygon');

    const point = L.circleMarker([32.0, 34.8], {
      radius: 9,
      color: '#2196f3',
      weight: 2,
      fillColor: '#2196f3',
      fillOpacity: 0.6,
    }).addTo(map);
    point.bindPopup('Entity 2 — point @ 32.0, 34.8');

    // Two circles side by side, same latitude + same 30 km radius, so the two
    // libraries' rendering can be compared directly:
    //   • drawn by LEAFLET (overlay) — L.circle, radius in metres
    const leafletCircle = L.circle([31.5, 34.5], {
      radius: 20000,
      color: '#2e7d32',
      weight: 2,
      fillColor: '#4caf50',
      fillOpacity: 0.4,
    }).addTo(map);
    leafletCircle.bindTooltip('Leaflet circle (20 km)');

    //   • drawn by CESIUM (base) — an ellipse entity with equal axes = a circle
    viewer.entities.add({
      name: 'Cesium circle (20 km)',
      position: Cesium.Cartesian3.fromDegrees(35.3, 31.5),
      ellipse: {
        semiMajorAxis: 20000,
        semiMinorAxis: 20000,
        height: 0,
        material: Cesium.Color.MEDIUMPURPLE.withAlpha(0.4),
        outline: true,
        outlineColor: Cesium.Color.PURPLE,
        outlineWidth: 2,
      },
    });

    // =====================================================================
    // 4. SYNC — Leaflet drives Cesium
    // ---------------------------------------------------------------------
    // Hand Cesium the exact geographic extent Leaflet currently shows. Both
    // render in Web Mercator, so framing the same lat/lng rectangle keeps
    // the two views locked together (matching container size => matching
    // aspect ratio => exact fill).
    // =====================================================================
    // Web Mercator (EPSG:3857) is only defined up to ~±85.05°. When zoomed out
    // in a tall viewport, Leaflet's bounds can run past that limit, which turns
    // Cesium's 2D orthographic frustum degenerate ("top must be greater than
    // bottom") and stops the renderer. So clamp the latitudes and skip any
    // inverted/zero-size extent (e.g. a 0-height container mid-layout).
    const MERCATOR_MAX_LAT = 85.05112878;
    const carto = new Cesium.Cartographic();
    const projectLngLat = (lngDeg, latDeg) => {
      carto.longitude = Cesium.Math.toRadians(lngDeg);
      carto.latitude = Cesium.Math.toRadians(latDeg);
      carto.height = 0;
      return viewer.scene.mapProjection.project(carto); // -> EPSG:3857 metres
    };

    const syncCesium = () => {
      const b = map.getBounds();
      const west = b.getWest();
      const east = b.getEast();
      const south = Math.max(b.getSouth(), -MERCATOR_MAX_LAT);
      const north = Math.min(b.getNorth(), MERCATOR_MAX_LAT);
      if (!(east > west) || !(north > south)) return; // skip invalid frames

      // 1) Center the 2D camera on the current view (setView centers correctly).
      viewer.camera.setView({
        destination: Cesium.Rectangle.fromDegrees(west, south, east, north),
      });
      // 2) Set the orthographic extent EXACTLY to Leaflet's projected bounds.
      //    Cesium's 2D setView rectangle-fit zooms out by the viewport aspect
      //    ratio, so instead we drive the frustum directly from the Web
      //    Mercator projection of the bounds — an exact, aspect-proof match.
      const sw = projectLngLat(west, south);
      const ne = projectLngLat(east, north);
      const f = viewer.camera.frustum; // OrthographicOffCenterFrustum in 2D
      f.right = (ne.x - sw.x) / 2;
      f.left = -f.right;
      f.top = (ne.y - sw.y) / 2;
      f.bottom = -f.top;

      viewer.scene.render(); // repaint NOW, same tick as the overlay — true lockstep
    };
    // 'move' fires on any center/zoom change (zooming moves too), so one
    // listener covers both panning and zooming, and renders once per step.
    map.on('move', syncCesium);
    syncCesium(); // initial alignment

    // =====================================================================
    // 5. Panning ONLY while Space is held (left-drag). Zoom is always on.
    // =====================================================================
    let spaceDown = false;
    const onKeyDown = (e) => {
      if (e.code === 'Space' && !spaceDown) {
        spaceDown = true;
        map.dragging.enable();
        leafletRef.current.style.cursor = 'grab';
        e.preventDefault(); // stop the page from scrolling on Space
      }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') {
        spaceDown = false;
        map.dragging.disable();
        leafletRef.current.style.cursor = '';
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // =====================================================================
    // 6. Smooth, cursor-anchored wheel zoom
    // ---------------------------------------------------------------------
    // Leaflet's built-in wheel zoom snaps a whole level per notch, and our
    // Cesium sync would jump to that target while Leaflet animates — so the
    // two layers drift apart mid-zoom. Instead we ease the zoom toward a
    // target in small fractional steps on each animation frame. Every step
    // fires Leaflet's 'move'/'zoom' events, so Cesium follows frame-by-frame
    // and both layers glide together.
    // =====================================================================
    const el = leafletRef.current;
    let targetZoom = map.getZoom();
    let anchor = null; // container point under the cursor to zoom around
    let rafId = null;

    const stepZoom = () => {
      const current = map.getZoom();
      const diff = targetZoom - current;
      if (Math.abs(diff) < 0.002) {
        map.setZoomAround(anchor, targetZoom, { animate: false });
        rafId = null;
        return;
      }
      map.setZoomAround(anchor, current + diff * 0.18, { animate: false }); // easing
      rafId = requestAnimationFrame(stepZoom);
    };

    const onWheel = (e) => {
      e.preventDefault();
      // normalise delta across mice / trackpads (pixels / lines / pages)
      let d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= el.clientHeight;
      targetZoom = Math.max(
        map.getMinZoom(),
        Math.min(map.getMaxZoom(), targetZoom - d / 260) // sensitivity
      );
      anchor = map.mouseEventToContainerPoint(e);
      if (rafId === null) rafId = requestAnimationFrame(stepZoom);
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // =====================================================================
    // cleanup
    // =====================================================================
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('wheel', onWheel);
      if (rafId !== null) cancelAnimationFrame(rafId);
      map.remove();
      viewer.destroy();
    };
  }, []);

  return (
    <div className="map-root">
      <div id="cesiumContainer" ref={cesiumRef} />
      <div id="leafletContainer" ref={leafletRef} />
      <div className="info-panel">
        <h1>Cesium (base) + Leaflet (overlay)</h1>
        <div>
          Raster source: <code>EPSG:4326</code> (NASA GIBS Blue Marble)
        </div>
        <div>
          Display projection: <code>EPSG:3857</code> (Web Mercator)
        </div>
        <div className="hint">
          Hold <b>Space</b> + drag left mouse to pan. Scroll to zoom (smooth).
        </div>
        <div className="hint">
          Circles: <span style={{ color: '#4caf50' }}>green = Leaflet</span> ·{' '}
          <span style={{ color: '#b39ddb' }}>purple = Cesium</span>
        </div>
      </div>
    </div>
  );
}
