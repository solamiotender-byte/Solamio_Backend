// pages/MemberVisitHistory.jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Box, Typography, Button, Chip, IconButton, Tooltip, alpha,
  useTheme, useMediaQuery, CircularProgress, Alert, Skeleton,
  SwipeableDrawer, Badge, Checkbox, FormControlLabel,
} from "@mui/material";
import {
  LocationOn, Refresh, MyLocation, FilterList, Add,
  CheckCircle, Cancel, AccessTime, Route, Timer, Close,
  Layers, Map, Satellite, Fullscreen, FullscreenExit, ExpandMore,
  Store, Login, Logout, PhotoCamera, VerifiedUser,
  BatteryChargingFull, BatteryAlert, Battery20, Battery50, Battery80,
  CalendarToday,
} from "@mui/icons-material";
import { useLocation, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  startTracking, stopTracking, getTrackPoints,
  clearTrackPoints, isCurrentlyTracking,
} from "../utils/Locationtracker";

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : "https://solar-backend-4bsb.onrender.com/api/v1";
const API = import.meta.env.VITE_API_URL || "https://solar-backend-4bsb.onrender.com";
const GMAPS_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  import.meta.env.REACT_APP_GOOGLE_MAPS_API_KEY || "";

const PRIMARY = "#4569ea";
const SUCCESS = "#22c55e";
const WARNING = "#f59e0b";
const ERROR   = "#ef4444";
const INDIGO  = "#6366f1";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const apiFetch = async (path, params = {}, options = {}) => {
  const token = localStorage.getItem("token") || localStorage.getItem("authToken") || localStorage.getItem("accessToken");
  const url = new URL(`${BASE_URL}${path}`);
  if (options.method !== "POST")
    Object.entries(params).forEach(([k, v]) => v != null && v !== "" && url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(options.method === "POST" ? { body: JSON.stringify(params) } : {}),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `HTTP ${res.status}`); }
  return res.json();
};

const fmt = (d) => d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
const sColor = (s) => ({ Completed: SUCCESS, InProgress: PRIMARY, Cancelled: ERROR }[s] || "#94a3b8");
const sBg    = (s) => ({ Completed: "#dcfce7", InProgress: alpha(PRIMARY, 0.1), Cancelled: "#fee2e2" }[s] || "#f1f5f9");

const getDateRange = (r) => {
  const now = new Date(), today = new Date(now); today.setHours(0, 0, 0, 0);
  if (r === "today")     return { startDate: today.toISOString(), endDate: new Date(today.getTime() + 86399999).toISOString() };
  if (r === "yesterday") { const y = new Date(today.getTime() - 86400000); return { startDate: y.toISOString(), endDate: new Date(today.getTime() - 1).toISOString() }; }
  if (r === "week")      { const w = new Date(today); w.setDate(today.getDate() - today.getDay()); return { startDate: w.toISOString(), endDate: now.toISOString() }; }
  if (r === "month")     return { startDate: new Date(today.getFullYear(), today.getMonth(), 1).toISOString(), endDate: now.toISOString() };
  return {};
};

// ─── Google Maps ──────────────────────────────────────────────────────────────
let gmapsPromise = null;
const loadGMaps = () => {
  if (window.google?.maps) return Promise.resolve();
  if (gmapsPromise) return gmapsPromise;
  gmapsPromise = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}`;
    s.async = true; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return gmapsPromise;
};

// ─── Battery helpers ──────────────────────────────────────────────────────────
const getBatteryStyle = (pct) => {
  if (pct == null) return null;
  if (pct > 60) return { color: "#16a34a", bg: "#dcfce7", border: "#bbf7d0", track: "#bbf7d0", fill: "#22c55e" };
  if (pct > 20) return { color: "#d97706", bg: "#fef3c7", border: "#fde68a", track: "#fde68a", fill: "#f59e0b" };
  return { color: "#dc2626", bg: "#fee2e2", border: "#fecaca", track: "#fecaca", fill: "#ef4444" };
};
const getBatteryIcon = (pct, isCharging) => {
  if (isCharging) return <BatteryChargingFull sx={{ fontSize: "1rem" }} />;
  if (pct == null) return <BatteryAlert sx={{ fontSize: "1rem" }} />;
  if (pct <= 20)   return <Battery20 sx={{ fontSize: "1rem" }} />;
  if (pct <= 50)   return <Battery50 sx={{ fontSize: "1rem" }} />;
  return <Battery80 sx={{ fontSize: "1rem" }} />;
};

const BatteryIndicator = ({ percentage, isCharging }) => {
  const style = getBatteryStyle(percentage);
  if (percentage == null) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.9,
      bgcolor: style.bg, border: `1px solid ${style.border}`, borderRadius: "10px" }}>
      <Box sx={{ color: style.color, display: "flex", alignItems: "center" }}>
        {getBatteryIcon(percentage, isCharging)}
      </Box>
      <Box sx={{ flex: 1, height: 7, borderRadius: "999px", bgcolor: style.track, overflow: "hidden" }}>
        <Box sx={{ height: "100%", width: `${percentage}%`, bgcolor: style.fill, borderRadius: "999px",
          transition: "width 0.6s ease",
          ...(isCharging && { animation: "cp 1.5s ease-in-out infinite",
            "@keyframes cp": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.5 } } }) }} />
      </Box>
      <Typography sx={{ fontSize: "0.8rem", fontWeight: 700, color: style.color, minWidth: 36 }}>
        {percentage}%
      </Typography>
      {isCharging && <Typography sx={{ fontSize: "0.7rem", color: "#d97706" }}>⚡</Typography>}
    </Box>
  );
};

// ─── Track Map ────────────────────────────────────────────────────────────────
const TrackMap = ({ punchInLocation, visits, mapStyle, loading, totalDistance,
  isPunchedIn, hasPunchedOut, trackPoints, fullscreen, onToggleFullscreen, onMapStyleChange }) => {
  const mapRef = useRef(null), gMapRef = useRef(null), polyRef = useRef(null),
    markersRef = useRef([]), pulseRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [styleMenu, setStyleMenu] = useState(false);

  useEffect(() => { loadGMaps().then(() => setReady(true)).catch(console.error); }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || gMapRef.current) return;
    gMapRef.current = new window.google.maps.Map(mapRef.current, {
      center: punchInLocation?.lat ? { lat: punchInLocation.lat, lng: punchInLocation.lng } : { lat: 20.5937, lng: 78.9629 },
      zoom: punchInLocation?.lat ? 15 : 5,
      mapTypeId: mapStyle === "satellite" ? "satellite" : mapStyle === "terrain" ? "terrain" : "roadmap",
      disableDefaultUI: false, zoomControl: true, streetViewControl: false,
      mapTypeControl: false, fullscreenControl: false,
      styles: [{ featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] }],
    });
  }, [ready]);

  useEffect(() => {
    if (gMapRef.current)
      gMapRef.current.setMapTypeId(mapStyle === "satellite" ? "satellite" : mapStyle === "terrain" ? "terrain" : "roadmap");
  }, [mapStyle]);

  useEffect(() => {
    if (!gMapRef.current || !ready) return;
    const map = gMapRef.current, G = window.google.maps;
    markersRef.current.forEach(m => m.setMap(null)); markersRef.current = [];
    if (polyRef.current) { polyRef.current.setMap(null); polyRef.current = null; }
    if (pulseRef.current) { pulseRef.current.setMap(null); pulseRef.current = null; }

    if (trackPoints.length >= 2)
      polyRef.current = new G.Polyline({
        path: trackPoints.map(p => ({ lat: p.lat, lng: p.lng })), geodesic: true,
        strokeColor: "#ef4444", strokeOpacity: 0.85, strokeWeight: 4, map,
        icons: [{ icon: { path: G.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3,
          strokeColor: "#ef4444", fillColor: "#ef4444", fillOpacity: 1 }, offset: "50%", repeat: "120px" }],
      });

    if (punchInLocation?.lat)
      markersRef.current.push(new G.Marker({
        position: { lat: punchInLocation.lat, lng: punchInLocation.lng }, map, title: "Start", zIndex: 10,
        icon: { path: G.SymbolPath.CIRCLE, scale: 10, fillColor: SUCCESS, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 },
      }));

    visits.filter(v => v.latitude && v.longitude).forEach((v, i) =>
      markersRef.current.push(new G.Marker({
        position: { lat: v.latitude, lng: v.longitude }, map,
        title: v.locationName || `Visit ${i + 1}`, zIndex: 8,
        label: { text: String(i + 1), color: "#fff", fontSize: "11px", fontWeight: "700" },
        icon: { path: G.SymbolPath.CIRCLE, scale: 14, fillColor: PRIMARY, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
      })));

    const last = trackPoints[trackPoints.length - 1];
    const currentPos = last
      ? { lat: last.lat, lng: last.lng }
      : punchInLocation?.lat
      ? { lat: punchInLocation.lat, lng: punchInLocation.lng }
      : null;

    if (currentPos && isPunchedIn && !hasPunchedOut) {
      pulseRef.current = new G.Marker({
        position: currentPos, map, title: "Current Location", zIndex: 20,
        icon: { path: G.SymbolPath.CIRCLE, scale: 10, fillColor: "#ef4444", fillOpacity: 1,
          strokeColor: "rgba(239,68,68,0.35)", strokeWeight: 10 },
      });
      // Info window showing "Current Location"
      const infoWindow = new G.InfoWindow({
        content: `<div style="font-family:sans-serif;font-size:12px;font-weight:700;color:#0f172a;padding:2px 4px;white-space:nowrap">📍 Current Location</div>`,
        disableAutoPan: true,
      });
      infoWindow.open(map, pulseRef.current);
      setTimeout(() => infoWindow.close(), 4000);
    }

    const all = [
      ...(punchInLocation?.lat ? [{ lat: punchInLocation.lat, lng: punchInLocation.lng }] : []),
      ...trackPoints.map(p => ({ lat: p.lat, lng: p.lng })),
      ...visits.filter(v => v.latitude && v.longitude).map(v => ({ lat: v.latitude, lng: v.longitude })),
    ];
    if (all.length >= 2) { const b = new G.LatLngBounds(); all.forEach(c => b.extend(c)); map.fitBounds(b, { top: 60, bottom: 40, left: 40, right: 40 }); }
    else if (all.length === 1) { map.setCenter(all[0]); map.setZoom(16); }
  }, [ready, trackPoints, visits, isPunchedIn, hasPunchedOut, punchInLocation]);

  const live = isPunchedIn && !hasPunchedOut;
  const styleOptions = [
    { value: "roadmap",   label: "Roadmap",   icon: <Map sx={{ fontSize: 14 }} /> },
    { value: "satellite", label: "Satellite", icon: <Satellite sx={{ fontSize: 14 }} /> },
    { value: "terrain",   label: "Terrain",   icon: <Layers sx={{ fontSize: 14 }} /> },
  ];
  const curStyle = styleOptions.find(s => s.value === mapStyle);

  return (
    <Box sx={{ position: "relative", width: "100%", height: "100%" }}>
      {loading && !ready
        ? <Skeleton variant="rectangular" width="100%" height="100%" />
        : <Box ref={mapRef} sx={{ width: "100%", height: "100%" }} />}

      {/* Map style button */}
      <Box sx={{ position: "absolute", top: 12, left: 12, zIndex: 10 }}>
        <Box onClick={() => setStyleMenu(p => !p)}
          sx={{ display: "flex", alignItems: "center", gap: 0.75, bgcolor: "#fff", borderRadius: "10px",
            px: 1.5, py: 0.75, cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0" }}>
          {curStyle?.icon}
          <Typography sx={{ fontSize: "0.78rem", fontWeight: 600, color: "#1e293b" }}>{curStyle?.label}</Typography>
          <ExpandMore sx={{ fontSize: 16, color: "#64748b" }} />
        </Box>
        {styleMenu && (
          <Box sx={{ position: "absolute", top: "calc(100% + 6px)", left: 0, bgcolor: "#fff",
            borderRadius: "10px", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", border: "1px solid #e2e8f0",
            overflow: "hidden", zIndex: 100, minWidth: 130 }}>
            {styleOptions.map(s => (
              <Box key={s.value} onClick={() => { onMapStyleChange(s.value); setStyleMenu(false); }}
                sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, cursor: "pointer",
                  bgcolor: mapStyle === s.value ? alpha(PRIMARY, 0.06) : "transparent",
                  color: mapStyle === s.value ? PRIMARY : "#374151",
                  "&:hover": { bgcolor: "#f8fafc" }, fontSize: "0.8rem", fontWeight: 600 }}>
                {s.icon} {s.label}
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Live badge */}
      {punchInLocation?.lat && (
        <Box sx={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, bgcolor: "rgba(255,255,255,0.96)",
            backdropFilter: "blur(8px)", borderRadius: "999px", px: 1.5, py: 0.5,
            boxShadow: "0 2px 12px rgba(0,0,0,0.12)", border: `1px solid ${alpha(live ? SUCCESS : "#94a3b8", 0.4)}` }}>
            <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: live ? SUCCESS : "#94a3b8", flexShrink: 0,
              ...(live && { animation: "p 1.5s ease-in-out infinite", "@keyframes p": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.2 } } }) }} />
            <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: live ? "#064e3b" : "#475569" }}>
              {live ? "Live Tracking" : "Punched Out"}
            </Typography>
          </Box>
        </Box>
      )}

      {/* Fullscreen */}
      <Box onClick={onToggleFullscreen}
        sx={{ position: "absolute", top: 12, right: 12, zIndex: 10, bgcolor: "#fff",
          borderRadius: "10px", p: 0.75, cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
          border: "1px solid #e2e8f0", display: "flex", "&:hover": { bgcolor: "#f8fafc" } }}>
        {fullscreen ? <FullscreenExit sx={{ fontSize: 18, color: "#374151" }} /> : <Fullscreen sx={{ fontSize: 18, color: "#374151" }} />}
      </Box>

      {/* Legend */}
      {(punchInLocation?.lat || visits.some(v => v.latitude)) && (
        <Box sx={{ position: "absolute", top: 52, right: 12, zIndex: 10, bgcolor: "rgba(255,255,255,0.95)",
          backdropFilter: "blur(4px)", px: 1.25, py: 0.75, borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)", display: "flex", flexDirection: "column", gap: 0.5 }}>
          {[["#22c55e", "Start"], ["line", "Route"], [PRIMARY, "Visit"]].map(([c, l]) => (
            <Box key={l} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              {c === "line"
                ? <Box sx={{ width: 20, height: 3, bgcolor: "#ef4444", borderRadius: 1 }} />
                : <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: c, border: "2px solid #fff" }} />}
              <Typography sx={{ fontSize: "0.6rem", fontWeight: 600, color: "#374151" }}>{l}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* Route km */}
      <Box sx={{ position: "absolute", bottom: 12, left: 12, zIndex: 10, bgcolor: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(4px)", px: 1.5, py: 0.75, borderRadius: "8px",
        boxShadow: "0 1px 6px rgba(0,0,0,0.12)", pointerEvents: "none" }}>
        <Typography sx={{ fontSize: "0.75rem", fontWeight: 700, color: "#0f172a" }}>
          Today's Route: {totalDistance.toFixed(1)} km
        </Typography>
      </Box>
    </Box>
  );
};

// ─── Visit Card ───────────────────────────────────────────────────────────────
const VisitCard = ({ visit: v, index, isLast }) => {
  const cur = v.status === "InProgress";
  const isStart = v.locationName === "Start Location";
  const dotColor = isStart ? "#64748b" : cur ? SUCCESS : sColor(v.status);

  const address = (() => {
    const raw = !v.address ? "" : typeof v.address === "string" ? v.address
      : v.address?.full || v.address?.short || "";
    return raw.trim();
  })();

  return (
    <Box sx={{ display: "flex", position: "relative" }}>
      {/* Spine */}
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mr: 2, flexShrink: 0 }}>
        <Box sx={{
          width: 38, height: 38, borderRadius: "50%", bgcolor: dotColor, flexShrink: 0, zIndex: 1,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: cur ? `0 0 0 4px ${alpha(SUCCESS, 0.2)}` : "0 0 0 3px #fff, 0 0 0 4px #e8edf2",
          ...(cur && { animation: "pl 1.5s ease-in-out infinite", "@keyframes pl": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.7 } } }),
        }}>
          {isStart || cur
            ? <MyLocation sx={{ fontSize: 16, color: "#fff" }} />
            : v.status === "Completed"
            ? <CheckCircle sx={{ fontSize: 16, color: "#fff" }} />
            : <Store sx={{ fontSize: 16, color: "#fff" }} />}
        </Box>
        {!isLast && <Box sx={{ width: 2, flex: 1, minHeight: 20, bgcolor: "#e2e8f0", my: 0.5, borderRadius: 1 }} />}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, pb: isLast ? 0 : 3, minWidth: 0 }}>
        {/* Name + time + status */}
        <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", mb: 0.5, gap: 1 }}>
          <Typography sx={{ fontWeight: 700, color: "#0f172a", fontSize: "0.9rem", lineHeight: 1.3, flex: 1, minWidth: 0 }}>
            {v.locationName || `Stop ${index + 1}`}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
            {v.checkInTime && (
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b" }}>{fmt(v.checkInTime)}</Typography>
            )}
            <Chip label={v.status} size="small"
              sx={{ bgcolor: sBg(v.status), color: sColor(v.status), fontWeight: 700,
                fontSize: "0.6rem", height: 20, borderRadius: "6px" }} />
          </Box>
        </Box>

        {/* Address — single line like "452 Market St, San Francisco" */}
        {address && (
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, mb: 0.75 }}>
            <LocationOn sx={{ fontSize: 13, color: PRIMARY, mt: "1px", flexShrink: 0 }} />
            <Typography sx={{ color: "#64748b", fontSize: "0.78rem", lineHeight: 1.5,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {address}
            </Typography>
          </Box>
        )}

        {/* Check-in / out row */}
        {v.checkInTime && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.75,
            bgcolor: "#f8fafc", borderRadius: "8px", px: 1.25, py: 0.75, flexWrap: "wrap" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
              <Login sx={{ fontSize: 12, color: SUCCESS }} />
              <Typography sx={{ fontSize: "0.72rem", color: "#064e3b", fontWeight: 600 }}>{fmt(v.checkInTime)}</Typography>
            </Box>
            {v.checkOutTime && (
              <>
                <Typography sx={{ fontSize: "0.65rem", color: "#cbd5e1" }}>→</Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
                  <Logout sx={{ fontSize: 12, color: WARNING }} />
                  <Typography sx={{ fontSize: "0.72rem", color: "#78350f", fontWeight: 600 }}>{fmt(v.checkOutTime)}</Typography>
                </Box>
              </>
            )}
            {v.timeSpentMinutes > 0 && (
              <>
                <Typography sx={{ fontSize: "0.65rem", color: "#cbd5e1" }}>·</Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
                  <Timer sx={{ fontSize: 12, color: INDIGO }} />
                  <Typography sx={{ fontSize: "0.72rem", color: "#4338ca", fontWeight: 600 }}>
                    {v.timeSpentMinutes >= 60 ? `${Math.floor(v.timeSpentMinutes / 60)}h ${v.timeSpentMinutes % 60}m` : `${v.timeSpentMinutes} min`}
                  </Typography>
                </Box>
              </>
            )}
          </Box>
        )}

        {/* Remarks */}
        {v.remarks && (
          <Box sx={{ bgcolor: "#f8fafc", borderLeft: `3px solid ${alpha(PRIMARY, 0.35)}`,
            borderRadius: "0 8px 8px 0", p: 1.25, mt: 0.5, mb: 0.75 }}>
            <Typography sx={{ color: "#475569", fontSize: "0.75rem", fontStyle: "italic", lineHeight: 1.6 }}>
              "{v.remarks}"
            </Typography>
          </Box>
        )}

        {/* Badges row */}
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 0.25 }}>
          {v.distanceFromPreviousKm > 0 && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.3 }}>
              <Route sx={{ fontSize: 11, color: "#94a3b8" }} />
              <Typography sx={{ fontSize: "0.68rem", color: "#64748b" }}>{v.distanceFromPreviousKm.toFixed(2)} km</Typography>
            </Box>
          )}
          {v.verified && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.3 }}>
              <VerifiedUser sx={{ fontSize: 11, color: SUCCESS }} />
              <Typography sx={{ fontSize: "0.68rem", color: SUCCESS, fontWeight: 600 }}>Verified</Typography>
            </Box>
          )}
          {v.photos?.length > 0 && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.3 }}>
              <PhotoCamera sx={{ fontSize: 11, color: "#94a3b8" }} />
              <Typography sx={{ fontSize: "0.68rem", color: "#64748b" }}>{v.photos.length} photo{v.photos.length > 1 ? "s" : ""}</Typography>
            </Box>
          )}
          {v.isLeadCreate && (
            <Chip label="Lead Created" size="small"
              sx={{ bgcolor: alpha(WARNING, 0.1), color: WARNING, fontWeight: 700, fontSize: "0.6rem", height: 18 }} />
          )}
        </Box>

        {/* In-progress action buttons — matches screenshot */}
        {cur && (
          <Box sx={{ display: "flex", gap: 1, mt: 1.25 }}>
            <Button size="small" variant="contained"
              startIcon={<CheckCircle sx={{ fontSize: 14 }} />}
              sx={{ bgcolor: SUCCESS, color: "#fff", fontWeight: 700, fontSize: "0.75rem",
                textTransform: "none", borderRadius: "8px", px: 2, py: 0.75,
                "&:hover": { bgcolor: "#16a34a" }, boxShadow: `0 2px 8px ${alpha(SUCCESS, 0.3)}` }}>
              Complete Visit
            </Button>
            <Button size="small" variant="outlined"
              startIcon={<Cancel sx={{ fontSize: 14 }} />}
              sx={{ borderColor: ERROR, color: ERROR, fontWeight: 700, fontSize: "0.75rem",
                textTransform: "none", borderRadius: "8px", px: 2, py: 0.75,
                "&:hover": { bgcolor: alpha(ERROR, 0.05), borderColor: ERROR } }}>
              Cancel Visit
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ─── Filter Drawer ────────────────────────────────────────────────────────────
const FilterDrawer = ({ open, onClose, filters, onApply }) => {
  const [local, setLocal] = useState(filters);
  return (
    <SwipeableDrawer anchor="bottom" open={open} onClose={onClose} onOpen={() => {}}
      PaperProps={{ sx: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80vh" } }}>
      <Box sx={{ p: 3 }}>
        <Box sx={{ width: 36, height: 4, bgcolor: "#e2e8f0", borderRadius: 2, mx: "auto", mb: 2.5 }} />
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2.5 }}>
          <Typography variant="h6" fontWeight={700} sx={{ color: PRIMARY }}>Filter Visits</Typography>
          <IconButton onClick={onClose} size="small"><Close /></IconButton>
        </Box>
        <Typography sx={{ fontWeight: 600, fontSize: "0.82rem", color: "#0f172a", mb: 1 }}>Date Range</Typography>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2.5 }}>
          {[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" },
            { value: "week", label: "This Week" }, { value: "month", label: "This Month" }].map(o => (
            <Chip key={o.value} label={o.label} onClick={() => setLocal(p => ({ ...p, dateRange: o.value }))}
              sx={{ fontWeight: 600, fontSize: "0.78rem", cursor: "pointer",
                bgcolor: local.dateRange === o.value ? PRIMARY : "#f1f5f9",
                color: local.dateRange === o.value ? "#fff" : "#374151",
                "&:hover": { opacity: 0.85 } }} />
          ))}
        </Box>
        <Typography sx={{ fontWeight: 600, fontSize: "0.82rem", color: "#0f172a", mb: 1 }}>Status</Typography>
        {["Completed", "InProgress", "Cancelled"].map(s => (
          <FormControlLabel key={s} label={<Typography sx={{ fontSize: "0.82rem" }}>{s}</Typography>}
            control={<Checkbox checked={local.statuses?.includes(s) || false}
              onChange={e => { const a = local.statuses || [];
                setLocal(p => ({ ...p, statuses: e.target.checked ? [...a, s] : a.filter(x => x !== s) })); }}
              sx={{ color: PRIMARY, "&.Mui-checked": { color: PRIMARY } }} />}
            sx={{ display: "flex", mb: 0.25 }} />
        ))}
        <Box sx={{ display: "flex", gap: 1.5, mt: 3 }}>
          <Button fullWidth variant="outlined" onClick={onClose}
            sx={{ borderColor: "#e2e8f0", color: "#374151", fontWeight: 600, borderRadius: "10px", py: 1.1 }}>Cancel</Button>
          <Button fullWidth variant="contained" onClick={() => { onApply(local); onClose(); }}
            sx={{ bgcolor: PRIMARY, fontWeight: 600, borderRadius: "10px", py: 1.1, "&:hover": { bgcolor: "#3a5ac8" } }}>Apply</Button>
        </Box>
      </Box>
    </SwipeableDrawer>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function MemberVisitHistory({ userId: propUserId }) {
  const theme = useTheme(), isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { userId: paramUserId } = useParams();
  useLocation();
  const { user: authUser } = useAuth();
  const userId = paramUserId || propUserId || null;
  const isAdminView = !!paramUserId;

  // Resolve the target user ID — try URL param, then prop, then auth context, then localStorage fallback
  const targetUserId = userId
    || authUser?._id
    || authUser?.id
    || authUser?.userId
    || (() => {
        try {
          const u = JSON.parse(localStorage.getItem("user") || localStorage.getItem("userData") || "null");
          return u?._id || u?.id || u?.userId || null;
        } catch { return null; }
      })();

  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [punchInLocation, setPunchInLocation] = useState(null);
  const [isPunchedIn, setIsPunchedIn] = useState(false);
  const [hasPunchedOut, setHasPunchedOut] = useState(false);
  const [trackPoints, setTrackPoints] = useState([]);
  const [battery, setBattery] = useState({ percentage: null, isCharging: false });
  const [filters, setFilters] = useState({ dateRange: "today", statuses: [] });
  const [filterOpen, setFilterOpen] = useState(false);
  const [mapStyle, setMapStyle] = useState("roadmap");
  const [fullscreen, setFullscreen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    if (!isPunchedIn || hasPunchedOut) return;
    const t = setInterval(() => setTrackPoints(getTrackPoints()), 5000);
    return () => clearInterval(t);
  }, [isPunchedIn, hasPunchedOut]);

  useEffect(() => { return () => { if (isCurrentlyTracking()) stopTracking(); }; }, []);

  const fetchBattery = useCallback(async () => {
    if (!targetUserId) return;
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("authToken") || localStorage.getItem("accessToken");
      const res = await fetch(`${API}/api/v1/battery/all-latest?userIds=${targetUserId}`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      const logs = data?.data || data?.result || [];
      const entry = logs.find(b => String(b.userId || b._id || b.user || "") === String(targetUserId));
      if (entry) setBattery({
        percentage: typeof entry.percentage === "number" ? entry.percentage
          : typeof entry.batteryLevel === "number" ? entry.batteryLevel : null,
        isCharging: entry.isCharging ?? entry.charging ?? false,
      });
    } catch (e) { console.warn("Battery fetch failed:", e.message); }
  }, [targetUserId]);

  const fetchPunchInStatus = useCallback(async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      // For admin view: send userId param. For own view: rely on token (no userId param).
      const res = await apiFetch("/attendance", {
        startDate: today, endDate: today, limit: 1,
        ...(isAdminView && targetUserId ? { userId: targetUserId } : {}),
      });
      const list = res?.data?.attendances || res?.result?.attendances || res?.data || [];
      const att = Array.isArray(list) ? list[0] : list;
      if (att?.punchIn?.time) {
        const out = !!att?.punchOut?.time;
        setIsPunchedIn(!out); setHasPunchedOut(out);
        setPunchInLocation({
          lat: att.punchIn?.location?.lat || att.punchIn?.location?.latitude || null,
          lng: att.punchIn?.location?.lng || att.punchIn?.location?.longitude || null,
          address: att.punchIn?.address || null, time: att.punchIn?.time || null,
        });
        try {
          const p = await apiFetch("/location/today",
            targetUserId ? { salesmanId: targetUserId } : {});
          const pts = p?.result || p?.data || [];
          if (pts.length) setTrackPoints(pts.map(pt => ({ lat: pt.lat, lng: pt.lng, time: pt.recordedAt })));
        } catch {}
      } else { setIsPunchedIn(false); setHasPunchedOut(false); setPunchInLocation(null); }
    } catch (e) { console.warn("Punch-in status failed:", e.message); }
  }, [targetUserId, isAdminView]);

  const fetchVisits = useCallback(async (pageNum = 1, append = false) => {
    try {
      if (pageNum === 1) setLoading(true); else setLoadingMore(true);
      setError(null);
      const res = await apiFetch("/visit", {
        page: pageNum, limit: 15, ...getDateRange(filters.dateRange),
        // Admin viewing someone else: send userId. Own view: backend uses token.
        ...(isAdminView && targetUserId ? { userId: targetUserId } : {}),
        ...(filters.statuses?.length === 1 ? { status: filters.statuses[0] } : {}),
      });
      const data = res.data || res, nv = data.visits || data.data || [];
      setVisits(prev => append ? [...prev, ...nv] : nv);
      setHasMore(data.pagination ? pageNum < data.pagination.totalPages : false);
      setLastUpdated(new Date());
    } catch (err) { setError(err.message); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [filters, targetUserId, isAdminView]);

  const fetchStats = useCallback(async () => {
    try { await apiFetch("/visit/stats", {
      ...getDateRange(filters.dateRange),
      ...(isAdminView && targetUserId ? { userId: targetUserId } : {}),
    }); } catch {}
  }, [filters, targetUserId, isAdminView]);

  // Re-fetch whenever filters, the URL userId, OR the logged-in user resolves
  const authUserId = authUser?._id || authUser?.id || authUser?.userId || null;
  useEffect(() => {
    if (!targetUserId) return; // wait until we have a user ID
    setPage(1); fetchVisits(1, false); fetchStats(); fetchPunchInStatus(); fetchBattery();
  }, [filters, userId, authUserId]);

  const handleRefresh = () => { setPage(1); fetchVisits(1, false); fetchStats(); fetchPunchInStatus(); fetchBattery(); };

  const totalDist = visits.reduce((s, v) => s + (v.distanceFromPreviousKm || 0), 0);
  const avgTime   = visits.length ? Math.round(visits.reduce((s, v) => s + (v.timeSpentMinutes || 0), 0) / visits.length) : 0;
  const completedCount  = visits.filter(v => v.status === "Completed").length;
  const inProgressCount = visits.filter(v => v.status === "InProgress").length;
  const cancelledCount  = visits.filter(v => v.status === "Cancelled").length;

  const updatedLabel = lastUpdated ? (() => {
    const mins = Math.floor((Date.now() - lastUpdated) / 60000);
    return mins < 1 ? "just now" : `${mins}m ago`;
  })() : null;

  const dutyStatus = !isPunchedIn && !hasPunchedOut ? "absent" : isPunchedIn && !hasPunchedOut ? "active" : "completed";
  const dutyCfg = {
    absent:    { label: "Not Punched In Today", color: ERROR,   bg: "#fef2f2", border: "#fecaca" },
    active:    { label: "Currently On Duty",     color: SUCCESS, bg: "#f0fdf4", border: "#bbf7d0" },
    completed: { label: "Day Completed",          color: WARNING, bg: "#fffbeb", border: "#fde68a" },
  }[dutyStatus];

  const rawAddr = punchInLocation?.address
    ? typeof punchInLocation.address === "string" ? punchInLocation.address
      : punchInLocation.address?.full || punchInLocation.address?.short || "" : "";
  const addrLines = rawAddr.split(",").map(s => s.trim()).filter(Boolean);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f4f6fb" }}>
      <FilterDrawer open={filterOpen} onClose={() => setFilterOpen(false)} filters={filters} onApply={setFilters} />

      <Box sx={{ p: { xs: 2, sm: 3, lg: 4 }, maxWidth: 1400, mx: "auto" }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: "10px" }}
            action={<Button size="small" onClick={handleRefresh}>Retry</Button>}>{error}</Alert>
        )}

        {/* Two-column grid — matches screenshot */}
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 420px" }, gap: 3, alignItems: "start" }}>

          {/* ── LEFT ── */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>

            {/* Battery */}
            {battery.percentage !== null && (
              <Box>
                <Typography sx={{ fontSize: "0.65rem", fontWeight: 700, color: "#94a3b8",
                  textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.75 }}>
                  Device Battery
                </Typography>
                <BatteryIndicator percentage={battery.percentage} isCharging={battery.isCharging} />
              </Box>
            )}

            {/* Map */}
            <Box sx={{ borderRadius: "16px", overflow: "hidden", border: "1px solid #e2e8f0",
              height: fullscreen ? "70vh" : { xs: 300, sm: 400, lg: 460 },
              boxShadow: "0 4px 24px rgba(0,0,0,0.06)", transition: "height 0.3s ease" }}>
              <TrackMap punchInLocation={punchInLocation} visits={visits} mapStyle={mapStyle}
                loading={loading} totalDistance={totalDist} isPunchedIn={isPunchedIn}
                hasPunchedOut={hasPunchedOut} trackPoints={trackPoints} fullscreen={fullscreen}
                onToggleFullscreen={() => setFullscreen(p => !p)} onMapStyleChange={setMapStyle} />
            </Box>

            {/* Stats row */}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2 }}>
              {[
                { icon: <Route sx={{ fontSize: 20, color: PRIMARY }} />, label: "Distance", value: totalDist.toFixed(1), unit: "km" },
                { icon: <LocationOn sx={{ fontSize: 20, color: PRIMARY }} />, label: "Visits", value: visits.length, unit: "stops" },
                { icon: <Timer sx={{ fontSize: 20, color: PRIMARY }} />, label: "Avg. Time", value: avgTime, unit: "mins" },
              ].map((m, i) => (
                <Box key={i} sx={{ bgcolor: "#fff", borderRadius: "14px", p: 2.5,
                  border: "1px solid #e8edf2", boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
                  "&:hover": { boxShadow: "0 4px 16px rgba(69,105,234,0.1)", borderColor: alpha(PRIMARY, 0.3) },
                  transition: "all 0.2s" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                    {m.icon}
                    <Typography sx={{ color: "#64748b", fontWeight: 500, fontSize: "0.78rem" }}>{m.label}</Typography>
                  </Box>
                  {loading ? <Skeleton width={60} height={32} /> : (
                    <Typography sx={{ fontSize: "1.4rem", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.5px", lineHeight: 1 }}>
                      {m.value}{" "}
                      <Typography component="span" sx={{ fontSize: "0.75rem", fontWeight: 400, color: "#94a3b8" }}>{m.unit}</Typography>
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>

            {/* Completion bar */}
            {!loading && visits.length > 0 && (
              <Box sx={{ bgcolor: "#fff", borderRadius: "14px", p: 2.5, border: "1px solid #e8edf2" }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: "0.85rem", color: "#0f172a" }}>Visit Completion</Typography>
                  <Typography sx={{ fontWeight: 800, fontSize: "1rem", color: PRIMARY }}>
                    {Math.round((completedCount / visits.length) * 100)}%
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", height: 10, borderRadius: "999px", overflow: "hidden", bgcolor: "#f1f5f9", mb: 1.5 }}>
                  {completedCount  > 0 && <Box sx={{ width: `${(completedCount / visits.length) * 100}%`, bgcolor: SUCCESS, transition: "width 0.6s" }} />}
                  {inProgressCount > 0 && <Box sx={{ width: `${(inProgressCount / visits.length) * 100}%`, bgcolor: PRIMARY,
                    animation: "sh 1.5s ease-in-out infinite", "@keyframes sh": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.5 } } }} />}
                  {cancelledCount  > 0 && <Box sx={{ width: `${(cancelledCount / visits.length) * 100}%`, bgcolor: ERROR, opacity: 0.45 }} />}
                </Box>
                <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                  {[
                    { label: "Done", count: completedCount, color: SUCCESS },
                    { label: "Active", count: inProgressCount, color: PRIMARY },
                    { label: "Cancelled", count: cancelledCount, color: ERROR },
                  ].map(s => (
                    <Box key={s.label} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: s.color }} />
                      <Typography sx={{ fontSize: "0.72rem", color: "#64748b" }}>{s.label}</Typography>
                      <Box sx={{ px: 0.75, py: 0.1, borderRadius: "4px", bgcolor: alpha(s.color, 0.1) }}>
                        <Typography sx={{ fontSize: "0.68rem", fontWeight: 700, color: s.color }}>
                          {s.count} · {Math.round((s.count / visits.length) * 100)}%
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Box>

          {/* ── RIGHT — sticky timeline panel ── */}
          <Box sx={{ bgcolor: "#fff", borderRadius: "16px", border: "1px solid #e8edf2",
            boxShadow: "0 4px 24px rgba(0,0,0,0.05)", overflow: "hidden", display: "flex", flexDirection: "column",
            position: { lg: "sticky" }, top: { lg: 16 }, maxHeight: { lg: "calc(100vh - 32px)" } }}>

            {/* Header */}
            <Box sx={{ px: 3, py: 2.5, borderBottom: "1px solid #f1f5f9" }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.75 }}>
                <Typography sx={{ fontWeight: 700, fontSize: "1rem", color: "#0f172a" }}>Visit Timeline</Typography>
                {!isAdminView && (
                  <Button size="small" variant="contained"
                    startIcon={<Add sx={{ fontSize: 14 }} />}
                    sx={{ bgcolor: PRIMARY, color: "#fff", fontWeight: 600, fontSize: "0.75rem",
                      textTransform: "none", borderRadius: "8px", px: 1.5, py: 0.6,
                      "&:hover": { bgcolor: "#3a5ac8" }, boxShadow: "none" }}>
                    Add New Visit
                  </Button>
                )}
              </Box>

              {/* Current location row inside timeline header */}
              {punchInLocation?.address && (
                <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.75, mb: 0.75,
                  bgcolor: isPunchedIn && !hasPunchedOut ? "#f0fdf4" : "#f8fafc",
                  border: `1px solid ${isPunchedIn && !hasPunchedOut ? "#bbf7d0" : "#e2e8f0"}`,
                  borderRadius: "10px", px: 1.5, py: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0, mt: "1px" }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      bgcolor: isPunchedIn && !hasPunchedOut ? SUCCESS : "#94a3b8",
                      ...(isPunchedIn && !hasPunchedOut && {
                        animation: "lp 1.5s ease-in-out infinite",
                        "@keyframes lp": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.2 } }
                      }) }} />
                    <LocationOn sx={{ fontSize: 13, color: isPunchedIn && !hasPunchedOut ? SUCCESS : "#94a3b8" }} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: "0.72rem", color: "#374151", fontWeight: 600,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {typeof punchInLocation.address === "string"
                        ? punchInLocation.address
                        : punchInLocation.address?.full || punchInLocation.address?.short || ""}
                    </Typography>
                    {punchInLocation.time && (
                      <Typography sx={{ fontSize: "0.68rem", color: "#94a3b8", mt: 0.15 }}>
                        {isPunchedIn && !hasPunchedOut ? "Active since" : "Punched in at"} {fmt(punchInLocation.time)}
                      </Typography>
                    )}
                  </Box>
                  <Chip label={isPunchedIn && !hasPunchedOut ? "On Duty" : hasPunchedOut ? "Done" : "Absent"}
                    size="small" sx={{
                      bgcolor: "transparent", fontWeight: 700, fontSize: "0.6rem", height: 20, flexShrink: 0,
                      border: `1px solid ${isPunchedIn && !hasPunchedOut ? "#86efac" : hasPunchedOut ? "#fde68a" : "#e2e8f0"}`,
                      color: isPunchedIn && !hasPunchedOut ? SUCCESS : hasPunchedOut ? WARNING : "#94a3b8",
                    }} />
                </Box>
              )}

              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {updatedLabel && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
                    <AccessTime sx={{ fontSize: 12, color: "#94a3b8" }} />
                    <Typography sx={{ fontSize: "0.7rem", color: "#94a3b8" }}>Updated {updatedLabel}</Typography>
                  </Box>
                )}
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Refresh">
                  <IconButton size="small" onClick={handleRefresh}
                    sx={{ color: "#94a3b8", "&:hover": { color: PRIMARY, bgcolor: alpha(PRIMARY, 0.06) } }}>
                    <Refresh sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            {/* Filter bar */}
            <Box sx={{ px: 3, py: 1.25, borderBottom: "1px solid #f1f5f9", bgcolor: "#fafbfc",
              display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CalendarToday sx={{ fontSize: 13, color: PRIMARY }} />
                <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, color: PRIMARY }}>
                  {filters.dateRange.charAt(0).toUpperCase() + filters.dateRange.slice(1)}
                </Typography>
                <Typography sx={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                  · {loading ? "…" : `${visits.length} visit${visits.length !== 1 ? "s" : ""}`}
                </Typography>
              </Box>
              <Badge badgeContent={filters.statuses?.length || 0} color="primary"
                sx={{ "& .MuiBadge-badge": { fontSize: "0.6rem", height: 16, minWidth: 16 } }}>
                <Box onClick={() => setFilterOpen(true)}
                  sx={{ display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer",
                    px: 1, py: 0.4, borderRadius: "6px", "&:hover": { bgcolor: alpha(PRIMARY, 0.06) } }}>
                  <FilterList sx={{ fontSize: 15, color: PRIMARY }} />
                  <Typography sx={{ fontSize: "0.72rem", fontWeight: 600, color: PRIMARY }}>Filter</Typography>
                </Box>
              </Badge>
            </Box>

            {/* Scrollable body */}
            <Box sx={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column",
              "&::-webkit-scrollbar": { width: 4 },
              "&::-webkit-scrollbar-track": { bgcolor: "#f8fafc" },
              "&::-webkit-scrollbar-thumb": { bgcolor: "#e2e8f0", borderRadius: 2 } }}>
              {loading ? (
                <Box sx={{ p: 3 }}>
                  {[1, 2, 3].map(i => (
                    <Box key={i} sx={{ display: "flex", gap: 2, mb: 3 }}>
                      <Skeleton variant="circular" width={38} height={38} sx={{ flexShrink: 0 }} />
                      <Box sx={{ flex: 1 }}>
                        <Skeleton width="55%" height={20} />
                        <Skeleton width="80%" height={14} sx={{ mt: 0.5 }} />
                        <Skeleton width="40%" height={14} sx={{ mt: 0.5 }} />
                        <Skeleton variant="rounded" width="100%" height={40} sx={{ mt: 1 }} />
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : visits.length === 0 ? (
                <Box sx={{ flex: 1, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", minHeight: 280 }}>
                  <MyLocation sx={{ fontSize: 48, color: "#e2e8f0", mb: 1.5 }} />
                  <Typography sx={{ fontWeight: 600, color: "#94a3b8", fontSize: "0.9rem" }}>No visits found</Typography>
                  <Typography sx={{ color: "#cbd5e1", fontSize: "0.8rem", mt: 0.5, textAlign: "center" }}>
                    Try changing the date range or filters
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ p: 3 }}>
                  {visits.map((v, i) => (
                    <VisitCard key={v._id || i} visit={v} index={i} isLast={i === visits.length - 1} />
                  ))}
                </Box>
              )}
            </Box>

            {/* Load more */}
            {(hasMore || loadingMore) && (
              <Box sx={{ px: 3, py: 2, borderTop: "1px solid #f1f5f9", textAlign: "center" }}>
                <Button size="small" disabled={loadingMore}
                  startIcon={loadingMore ? <CircularProgress size={12} /> : null}
                  onClick={() => { const n = page + 1; setPage(n); fetchVisits(n, true); }}
                  sx={{ color: PRIMARY, fontWeight: 600, fontSize: "0.78rem", textTransform: "none" }}>
                  {loadingMore ? "Loading…" : "Load earlier visits"}
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}