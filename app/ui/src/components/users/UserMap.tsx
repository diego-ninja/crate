import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Activity, Headphones, MapPin } from "lucide-react";

import { useApi } from "@/hooks/use-api";

interface MapUser {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  online: boolean;
  now_playing: { title: string; artist: string; album: string } | null;
}

// Custom marker icons via CSS class
function makeIcon(online: boolean, playing: boolean): L.DivIcon {
  const color = playing ? "#06b6d4" : online ? "#22c55e" : "#6b7280";
  const pulse = playing || online;
  return L.divIcon({
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
    html: `<div style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center">
      ${pulse ? `<div style="position:absolute;inset:-4px;border-radius:50%;background:${color};opacity:0.3;animation:userPulse 2s ease-in-out infinite"></div>` : ""}
      <div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #0a0a14;box-shadow:0 0 8px ${color}40"></div>
    </div>`,
  });
}

function FitBounds({ users }: { users: MapUser[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !users.length) return;
    fitted.current = true;
    if (users.length === 1) {
      map.setView([users[0]!.latitude, users[0]!.longitude], 6);
    } else {
      const bounds = L.latLngBounds(users.map((u) => [u.latitude, u.longitude]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
    }
  }, [users, map]);
  return null;
}

export function UserMap() {
  const { data } = useApi<{ users: MapUser[] }>("/api/admin/users/map");
  const users = data?.users ?? [];
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Inject pulse animation if not present
    if (!document.getElementById("user-map-styles")) {
      const style = document.createElement("style");
      style.id = "user-map-styles";
      style.textContent = `
        @keyframes userPulse { 0%,100% { transform:scale(1); opacity:0.3; } 50% { transform:scale(1.8); opacity:0; } }
        .user-map-container .leaflet-container { background: #0a0a14 !important; }
        .user-map-container .leaflet-popup-content-wrapper { background: #16162a; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; color: white; box-shadow: 0 16px 48px rgba(0,0,0,0.7); }
        .user-map-container .leaflet-popup-tip { background: #16162a; border-color: rgba(255,255,255,0.12); }
        .user-map-container .leaflet-popup-close-button { color: rgba(255,255,255,0.4) !important; }
        .user-map-container .leaflet-control-zoom a { background: #1a1a2e !important; color: rgba(255,255,255,0.6) !important; border-color: rgba(255,255,255,0.1) !important; }
        .user-map-container .leaflet-control-attribution { background: rgba(0,0,0,0.6) !important; color: rgba(255,255,255,0.3) !important; font-size: 9px !important; }
        .user-map-container .leaflet-control-attribution a { color: rgba(255,255,255,0.4) !important; }
      `;
      document.head.appendChild(style);
    }
    setReady(true);
  }, []);

  if (!users.length) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-xl border border-white/8 bg-white/[0.02] text-sm text-white/30">
        <MapPin size={16} className="mr-2" /> No users with location data
      </div>
    );
  }

  if (!ready) return null;

  return (
    <div className="user-map-container overflow-hidden rounded-xl border border-white/8">
      <MapContainer
        center={[users[0]?.latitude ?? 40, users[0]?.longitude ?? -3]}
        zoom={4}
        style={{ height: 340, width: "100%" }}
        zoomControl={true}
        attributionControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />
        <FitBounds users={users} />
        {users.map((user) => (
          <Marker
            key={user.id}
            position={[user.latitude, user.longitude]}
            icon={makeIcon(user.online, !!user.now_playing)}
          >
            <Popup>
              <div className="min-w-[200px] space-y-2.5 p-1">
                <div className="flex items-center gap-3">
                  {user.avatar ? (
                    <img src={user.avatar} alt="" className="h-10 w-10 rounded-full object-cover border border-white/10 shadow-md" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/8 text-sm font-semibold text-white/60">
                      {(user.name || "?")[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{user.name}</div>
                    <div className="text-[11px] text-white/45 truncate">{user.city}{user.city && user.country ? ", " : ""}{user.country}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${
                    user.online ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-white/10 bg-white/5 text-white/40"
                  }`}>
                    <Activity size={9} />
                    {user.online ? "Online" : "Offline"}
                  </span>
                  {user.now_playing && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-200">
                      <Headphones size={9} />
                      Listening
                    </span>
                  )}
                </div>
                {user.now_playing && (
                  <div className="border-t border-white/8 pt-1.5">
                    <div className="text-[11px] text-white/70 truncate">{user.now_playing.title}</div>
                    <div className="text-[10px] text-white/40 truncate">{user.now_playing.artist}</div>
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
