import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Truck,
  Shield,
  Activity,
  Layers,
  Database,
  Search,
  RefreshCw,
  LogOut,
  MapPin,
  Fuel,
  Gauge,
  Radio,
  History,
  Terminal,
  ChevronRight,
  TrendingUp,
  Cpu,
  Zap,
  Clock,
  Compass,
  CheckCircle2,
  AlertTriangle,
  Copy,
  PlusCircle,
  X,
  FileSpreadsheet,
  Navigation,
  Download,
  Bot,
  ThermometerSnowflake,
  Mountain,
  Command,
  BellRing
} from "lucide-react";
import L from "leaflet";

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : "http://localhost:5000/api";
const createCustomMarker = (status, isSelected) => {
  const isSOS = status === "SOS";
  const pinColor = isSOS ? "#f43f5e" : status === "IN TRANSIT" ? "#38bdf8" : status === "IDLE" ? "#fbbf24" : "#94a3b8";
  return L.divIcon({
    className: "custom-chic-pin",
    html: `
      <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
        <div style="
          position: absolute;
          width: ${isSelected || isSOS ? "36px" : "24px"};
          height: ${isSelected || isSOS ? "36px" : "24px"};
          border-radius: 9999px;
          background-color: ${pinColor};
          opacity: ${isSOS ? "0.6" : "0.3"};
          animation: ping ${isSOS ? "0.9s" : "2.2s"} cubic-bezier(0, 0, 0.2, 1) infinite;
        "></div>
        <div style="
          width: ${isSelected ? "16px" : "12px"};
          height: ${isSelected ? "16px" : "12px"};
          border-radius: 9999px;
          background-color: ${pinColor};
          border: 2px solid #ffffff;
          box-shadow: 0 0 14px ${pinColor};
          position: relative;
          z-index: 10;
        "></div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
};

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("fleetflow_jwt") || null);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("fleetflow_user") || "null");
    } catch {
      return null;
    }
  });

  const [vehicles, setVehicles] = useState([]);
  const [geofences, setGeofences] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [activeTab, setActiveTab] = useState("manifest");
  const [systemAlert, setSystemAlert] = useState(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const geofenceLayersRef = useRef([]);

  const notify = (type, message) => {
    setSystemAlert({ type, message });
    setTimeout(() => setSystemAlert(null), 3500);
  };

  const playChirp = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch { }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleLogin = async (email) => {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "password123" })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Login failed");

      setToken(data.token);
      setCurrentUser(data.user);
      localStorage.setItem("fleetflow_jwt", data.token);
      localStorage.setItem("fleetflow_user", JSON.stringify(data.user));
      playChirp();
      notify("success", `Authorized as ${data.user.name}`);
    } catch (err) {
      notify("error", err.message || "Gateway disconnected");
    }
  };

  const handleLogout = () => {
    setToken(null);
    setCurrentUser(null);
    localStorage.removeItem("fleetflow_jwt");
    localStorage.removeItem("fleetflow_user");
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
  };

  const fetchFleet = async () => {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (searchQuery.trim()) params.append("q", searchQuery.trim());

      const res = await fetch(`${API_BASE}/vehicles?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.status === 401) {
        handleLogout();
        return;
      }

      const data = await res.json();
      if (res.ok) {
        setVehicles(data.vehicles || []);
        setGeofences(data.geofences || []);
        setAuditLogs(data.audit_logs || []);
        if (!selectedVehicle && data.vehicles?.length > 0) {
          setSelectedVehicle(data.vehicles[0]);
        } else if (selectedVehicle) {
          const fresh = data.vehicles.find((v) => v.id === selectedVehicle.id);
          if (fresh) setSelectedVehicle(fresh);
        }
      }
    } catch (err) {
      console.error(err);
      notify("error", "Telemetry gateway sync error.");
    }
  };

  useEffect(() => {
    if (token) fetchFleet();
  }, [token, statusFilter]);

  // Leaflet Map Initialization with Pure Free OpenStreetMap (No Watermark)
  useEffect(() => {
    if (!token || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false
      }).setView([18.7500, 73.8000], 7);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18
      }).addTo(map);

      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapInstanceRef.current = map;

      setTimeout(() => map.invalidateSize(), 200);
    }

    const map = mapInstanceRef.current;
    map.invalidateSize();

    // Geofences
    geofenceLayersRef.current.forEach((l) => map.removeLayer(l));
    geofenceLayersRef.current = [];

    geofences.forEach((hub) => {
      const circle = L.circle([hub.lat, hub.lng], {
        radius: hub.radius_km * 1000,
        color: "#38bdf8",
        weight: 1.5,
        fillColor: "#0ea5e9",
        fillOpacity: 0.1,
        dashArray: "5, 8"
      }).addTo(map);

      circle.bindTooltip(`<strong>GEOFENCE:</strong> ${hub.name}`, {
        permanent: false,
        direction: "top"
      });

      geofenceLayersRef.current.push(circle);
    });

    // Markers
    Object.values(markersRef.current).forEach((m) => map.removeLayer(m));
    markersRef.current = {};

    vehicles.forEach((v) => {
      const isSelected = selectedVehicle?.id === v.id;
      const marker = L.marker([v.lat, v.lng], {
        icon: createCustomMarker(v.status, isSelected)
      }).addTo(map);

      marker.bindPopup(`
        <div style="font-family: monospace; font-size: 11px; padding: 4px;">
          <div style="font-weight: 700; color: #38bdf8; font-size: 13px;">${v.vehicle_id}</div>
          <div style="color: #94a3b8;">Pilot: ${v.driver_name}</div>
          <div style="color: #cbd5e1; margin-top: 4px;">Zone: <strong>${v.current_geofence}</strong></div>
          <div style="color: #38bdf8; font-size: 11px; margin-top: 2px;">Speed: ${v.speed_kmh} km/h • Temp: ${v.cargo_temp}°C</div>
        </div>
      `);

      marker.on("click", () => {
        playChirp();
        setSelectedVehicle(v);
      });

      markersRef.current[v.id] = marker;
    });
  }, [token, vehicles, geofences, selectedVehicle]);

  useEffect(() => {
    if (selectedVehicle && mapInstanceRef.current) {
      mapInstanceRef.current.panTo([selectedVehicle.lat, selectedVehicle.lng], {
        animate: true,
        duration: 0.6
      });
    }
  }, [selectedVehicle?.id]);

  // Simulation Pulse
  useEffect(() => {
    if (!token || !isSimulating) return;

    const interval = setInterval(async () => {
      try {
        await fetch(`${API_BASE}/vehicles/simulate-telemetry`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        fetchFleet();
      } catch (err) {
        console.error(err);
      }
    }, 3200);

    return () => clearInterval(interval);
  }, [token, isSimulating]);

  const handleUpdateStatus = async (vehicleId, newStatus) => {
    try {
      playChirp();
      const res = await fetch(`${API_BASE}/vehicles/${vehicleId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      notify(newStatus === "SOS" ? "error" : "success", `Asset ${vehicleId} marked ${newStatus}`);
      fetchFleet();
    } catch (err) {
      notify("error", err.message || "Failed update");
    }
  };

  const exportCSV = () => {
    playChirp();
    const headers = "Vehicle ID,Driver,Corridor,Payload (kg),Speed (km/h),Fuel (%),Status,Reefer Temp (°C),Altitude (m),Geofence\n";
    const rows = vehicles
      .map(
        (v) =>
          `"${v.vehicle_id}","${v.driver_name}","${v.corridor}",${v.cargo_weight},${v.speed_kmh},${v.fuel_level},"${v.status}",${v.cargo_temp},${v.altitude_m},"${v.current_geofence}"`
      )
      .join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fleetflow-telemetry-manifest.csv`;
    a.click();
    notify("success", "Exported telemetry records to CSV format.");
  };

  const metrics = useMemo(() => {
    const total = vehicles.length;
    const inTransit = vehicles.filter((v) => v.status === "IN TRANSIT").length;
    const sosCount = vehicles.filter((v) => v.status === "SOS").length;
    const totalPayload = vehicles.reduce((sum, v) => sum + (v.cargo_weight || 0), 0);
    const avgVelocity = total
      ? Math.round(vehicles.reduce((sum, v) => sum + (v.speed_kmh || 0), 0) / total)
      : 0;
    const avgFuel = total
      ? Math.round(vehicles.reduce((sum, v) => sum + (v.fuel_level || 0), 0) / total)
      : 0;

    return {
      total,
      inTransit,
      sosCount,
      totalPayload,
      avgVelocity,
      avgFuel,
      utilization: total ? Math.round((inTransit / total) * 100) : 0
    };
  }, [vehicles]);

  const filteredCommandVehicles = useMemo(() => {
    if (!commandQuery.trim()) return vehicles;
    const term = commandQuery.toLowerCase();
    return vehicles.filter(
      (v) =>
        v.vehicle_id.toLowerCase().includes(term) ||
        v.driver_name.toLowerCase().includes(term) ||
        v.corridor.toLowerCase().includes(term)
    );
  }, [vehicles, commandQuery]);

  // ---------------- AUTHENTICATION VIEW ----------------
  if (!token || !currentUser) {
    return (
      <div className="min-h-screen bg-brand-dark flex flex-col justify-center items-center px-4 font-sans text-slate-100 relative">
        <div className="w-full max-w-md bg-brand-card border border-brand-border rounded-2xl p-8 shadow-2xl relative z-10 space-y-6">
          <div className="flex items-center space-x-3.5 border-b border-brand-border pb-5">
            <div className="p-3 bg-sky-500/10 border border-sky-500/20 text-sky-400 rounded-xl">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg font-bold tracking-tight text-white font-mono">FLEETFLOW COMMAND</h1>
                <span className="text-[10px] font-mono uppercase bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded font-semibold">
                  v2.4 LTS
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">High-Density Telemetry & Spatial Control Plane</p>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => handleLogin("manager@fleetflow.io")}
              className="w-full p-4 bg-brand-surface hover:bg-slate-800 border border-brand-border hover:border-sky-500/40 rounded-xl text-left transition flex items-center justify-between group"
            >
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-sky-500/10 text-sky-400 rounded-lg group-hover:bg-sky-500/20 transition">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white group-hover:text-sky-300 transition">
                    Dispatch Director
                  </div>
                  <div className="text-xs text-slate-400 font-mono">manager@fleetflow.io • Full Fleet Orchestration</div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-sky-400 transition" />
            </button>

            <button
              onClick={() => handleLogin("driver@fleetflow.io")}
              className="w-full p-4 bg-brand-surface hover:bg-slate-800 border border-brand-border hover:border-emerald-500/40 rounded-xl text-left transition flex items-center justify-between group"
            >
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg group-hover:bg-emerald-500/20 transition">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white group-hover:text-emerald-300 transition">
                    Field Pilot
                  </div>
                  <div className="text-xs text-slate-400 font-mono">driver@fleetflow.io • Restricted Cockpit Readout</div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition" />
            </button>
          </div>

          <div className="p-3 bg-brand-dark border border-brand-border rounded-lg font-mono text-[11px] text-slate-400 flex items-center justify-between">
            <span className="flex items-center space-x-1.5">
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <span>JWT HS256 Verified Handshake</span>
            </span>
            <span>Cluster: Ready</span>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- OPERATIONS COMMAND DASHBOARD ----------------
  return (
    <div className="min-h-screen bg-brand-dark text-slate-100 flex flex-col font-sans">
      {/* Toast Alert */}
      {systemAlert && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl border text-xs font-mono shadow-2xl flex items-center space-x-2 backdrop-blur-md transition ${systemAlert.type === "error"
            ? "bg-rose-950/90 border-rose-500/40 text-rose-300"
            : "bg-emerald-950/90 border-emerald-500/40 text-emerald-300"
            }`}
        >
          {systemAlert.type === "error" ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          <span>{systemAlert.message}</span>
        </div>
      )}

      {/* Global Header */}
      <header className="border-b border-brand-border bg-brand-card/90 backdrop-blur sticky top-0 z-40 px-6 py-2.5 flex items-center justify-between">
        <div className="flex items-center space-x-5">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-sky-500/10 border border-sky-500/20 text-sky-400 rounded-lg">
              <Truck className="w-4 h-4" />
            </div>
            <div>
              <span className="font-mono font-bold text-sm tracking-tight text-white flex items-center space-x-2">
                <span>FLEETFLOW</span>
                <span className="text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-semibold">
                  LIVE TELEMETRY
                </span>
              </span>
            </div>
          </div>

          <div className="hidden lg:flex items-center space-x-4 border-l border-brand-border pl-5 text-xs text-slate-400 font-mono">
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-slate-300">WGS84 Sub-Second Pipeline</span>
            </div>
            <span>•</span>
            <div>Active Corridors: <span className="text-sky-400 font-semibold">{metrics.total} Units</span></div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setCommandOpen(true)}
            className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 bg-brand-surface hover:bg-slate-800 text-slate-300 rounded-lg text-xs font-mono border border-brand-border transition"
          >
            <Command className="w-3.5 h-3.5 text-slate-400" />
            <span>Search (Ctrl+K)</span>
          </button>

          <button
            onClick={() => {
              playChirp();
              setIsSimulating(!isSimulating);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold flex items-center space-x-2 transition ${isSimulating
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-brand-surface hover:bg-slate-800 text-slate-300 border border-brand-border"
              }`}
          >
            <Radio className={`w-3.5 h-3.5 ${isSimulating ? "animate-spin text-emerald-400" : ""}`} />
            <span>{isSimulating ? "LIVE RADAR ACTIVE" : "START LIVE FEED"}</span>
          </button>

          <button
            onClick={exportCSV}
            className="p-1.5 bg-brand-surface hover:bg-slate-800 text-slate-300 rounded-lg border border-brand-border transition"
            title="Export Manifest CSV"
          >
            <Download className="w-4 h-4" />
          </button>

          <div className="border-l border-brand-border pl-4 text-right">
            <div className="text-xs font-semibold text-white">{currentUser.name}</div>
            <div className="text-[10px] text-slate-400 font-mono capitalize">
              {currentUser.badge_id || "DIR-409"} • {currentUser.role} scope
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-brand-surface rounded-lg transition"
            title="Log Out Session"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Operations Body */}
      <main className="flex-1 p-6 space-y-6 max-w-[1720px] w-full mx-auto">
        {/* KPI Ribbons */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-brand-card border border-brand-border rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider">Fleet Operational Units</span>
              <Activity className="w-4 h-4 text-sky-400" />
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-bold font-mono text-white">{metrics.inTransit}</span>
              <span className="text-xs text-slate-400 font-mono">/ {metrics.total} Units Deployed</span>
            </div>
            <div className="text-[11px] text-emerald-400 font-mono mt-2 flex items-center space-x-1.5">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>{metrics.utilization}% Network Utilization</span>
            </div>
          </div>

          <div className="bg-brand-card border border-brand-border rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider">In-Transit Freight Mass</span>
              <Layers className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-bold font-mono text-white">{metrics.totalPayload.toLocaleString()}</span>
              <span className="text-xs text-slate-400 font-mono">kg Total</span>
            </div>
            <div className="text-[11px] text-sky-400 font-mono mt-2 flex items-center space-x-1">
              <Navigation className="w-3.5 h-3.5" />
              <span>3 Geofenced Perimeters Synced</span>
            </div>
          </div>

          <div className="bg-brand-card border border-brand-border rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider">Corridor Mean Velocity</span>
              <Gauge className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-bold font-mono text-white">{metrics.avgVelocity}</span>
              <span className="text-xs text-slate-400 font-mono">km/h Index</span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono mt-2">Sahyadri Mountain Pass Governed</div>
          </div>

          <div className="bg-brand-card border border-brand-border rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-[11px] font-mono uppercase tracking-wider">Safety & Incident Radar</span>
              <BellRing className={`w-4 h-4 ${metrics.sosCount > 0 ? "text-rose-400 animate-bounce" : "text-purple-400"}`} />
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-2xl font-bold font-mono text-white">
                {metrics.sosCount > 0 ? `${metrics.sosCount} SOS BEACONS` : "NOMINAL"}
              </span>
              <span className="text-xs text-slate-400 font-mono">Guard Active</span>
            </div>
            <div className="text-[11px] text-purple-400 font-mono mt-2 flex items-center space-x-1.5">
              <Zap className="w-3.5 h-3.5" />
              <span>CAN Bus TPMS Telemetry Active</span>
            </div>
          </div>
        </div>

        {/* Central Tactical Split: Map + Unit HUD */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Working Leaflet Map with Pure Free Dark-Inverted Tiles (No Watermark) */}
          <div className="lg:col-span-2 bg-brand-card border border-brand-border rounded-xl overflow-hidden flex flex-col h-[500px]">
            <div className="px-4 py-2.5 bg-brand-surface border-b border-brand-border flex items-center justify-between text-xs font-mono">
              <div className="flex items-center space-x-2 text-slate-300">
                <Compass className="w-4 h-4 text-sky-400" />
                <span className="font-semibold tracking-wide">SPATIAL RADAR & ACTIVE GEOFENCE PERIMETERS</span>
              </div>
              <div className="flex items-center space-x-3 text-[11px] text-slate-400">
                <span className="flex items-center space-x-1">
                  <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                  <span>Transit</span>
                </span>
                <span className="flex items-center space-x-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                  <span>Idle</span>
                </span>
                <span className="flex items-center space-x-1">
                  <span className="w-2 h-2 rounded-full bg-rose-400"></span>
                  <span>SOS</span>
                </span>
              </div>
            </div>
            <div ref={mapContainerRef} className="flex-1 w-full h-full bg-brand-dark" />
          </div>

          {/* Unit Diagnostic HUD */}
          <div className="bg-brand-card border border-brand-border rounded-xl p-5 flex flex-col justify-between">
            {selectedVehicle ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-brand-border pb-3">
                  <div>
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">UNIT DESIGNATOR</span>
                    <h2 className="text-xl font-bold text-white font-mono">{selectedVehicle.vehicle_id}</h2>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded font-mono text-xs font-semibold ${selectedVehicle.status === "SOS"
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse"
                      : selectedVehicle.status === "IN TRANSIT"
                        ? "bg-sky-500/10 text-sky-400 border border-sky-500/30"
                        : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                      }`}
                  >
                    {selectedVehicle.status}
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-slate-400 font-mono text-[10px]">PILOT IN CHARGE</span>
                      <div className="font-semibold text-slate-200 text-sm mt-0.5">{selectedVehicle.driver_name}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-400 font-mono text-[10px]">HOS ON-DUTY</span>
                      <div className="font-mono font-bold text-sky-400">
                        {Math.floor((selectedVehicle.hos_minutes || 240) / 60)}h {(selectedVehicle.hos_minutes || 240) % 60}m
                      </div>
                    </div>
                  </div>

                  <div className="p-2.5 bg-brand-surface rounded-lg border border-brand-border text-xs">
                    <span className="text-[10px] font-mono text-slate-400">DETECTED GEOFENCE HUB</span>
                    <div className="font-mono text-sky-400 font-semibold mt-0.5">{selectedVehicle.current_geofence}</div>
                  </div>

                  {/* 4-Wheel TPMS System */}
                  <div className="p-3 bg-brand-surface rounded-lg border border-brand-border">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-2">
                      <span>CAN BUS TPMS PRESSURE</span>
                      <span className="text-emerald-400">CALIBRATED</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center font-mono text-xs">
                      <div className="bg-brand-card p-1.5 rounded border border-brand-border">
                        <span className="text-[10px] text-slate-500 block">FL</span>
                        <span className="font-bold text-white">{selectedVehicle.tpms_fl || 34} PSI</span>
                      </div>
                      <div className="bg-brand-card p-1.5 rounded border border-brand-border">
                        <span className="text-[10px] text-slate-500 block">FR</span>
                        <span className="font-bold text-white">{selectedVehicle.tpms_fr || 34} PSI</span>
                      </div>
                      <div className="bg-brand-card p-1.5 rounded border border-brand-border">
                        <span className="text-[10px] text-slate-500 block">RL</span>
                        <span className="font-bold text-white">{selectedVehicle.tpms_rl || 35} PSI</span>
                      </div>
                      <div className="bg-brand-card p-1.5 rounded border border-brand-border">
                        <span className="text-[10px] text-slate-500 block">RR</span>
                        <span className="font-bold text-white">{selectedVehicle.tpms_rr || 35} PSI</span>
                      </div>
                    </div>
                  </div>

                  {/* Cold-Chain Reefer & Elevation Profile */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="bg-brand-surface p-2.5 rounded-lg border border-brand-border">
                      <div className="flex items-center space-x-1.5 text-slate-400 text-[10px] font-mono mb-1">
                        <ThermometerSnowflake className="w-3.5 h-3.5 text-sky-400" />
                        <span>REEFER TEMP</span>
                      </div>
                      <div className="text-base font-bold font-mono text-white">{selectedVehicle.cargo_temp}°C</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">{selectedVehicle.cargo_type}</div>
                    </div>

                    <div className="bg-brand-surface p-2.5 rounded-lg border border-brand-border">
                      <div className="flex items-center space-x-1.5 text-slate-400 text-[10px] font-mono mb-1">
                        <Mountain className="w-3.5 h-3.5 text-amber-400" />
                        <span>ALTITUDE</span>
                      </div>
                      <div className="text-base font-bold font-mono text-white">{selectedVehicle.altitude_m} m</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Bhor Ghat Ridge</div>
                    </div>
                  </div>
                </div>

                {/* Operations & Emergency SOS Trigger */}
                <div className="pt-3 border-t border-brand-border space-y-2">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleUpdateStatus(selectedVehicle.vehicle_id, "IN TRANSIT")}
                      className="flex-1 py-1.5 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 rounded-lg text-xs font-mono font-semibold transition"
                    >
                      DISPATCH VECTOR
                    </button>
                    <button
                      onClick={() => handleUpdateStatus(selectedVehicle.vehicle_id, "IDLE")}
                      className="flex-1 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-lg text-xs font-mono font-semibold transition"
                    >
                      HOLD / PARK
                    </button>
                  </div>

                  <button
                    onClick={() => handleUpdateStatus(selectedVehicle.vehicle_id, "SOS")}
                    className="w-full py-2 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 rounded-lg text-xs font-mono font-bold flex items-center justify-center space-x-1.5 transition"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    <span>BROADCAST DRIVER EMERGENCY (SOS)</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-28 text-xs text-slate-500 font-mono">
                Select any telemetry node from the map or table to inspect diagnostics.
              </div>
            )}
          </div>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center justify-between border-b border-brand-border pb-2">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveTab("manifest")}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold flex items-center space-x-2 transition ${activeTab === "manifest"
                ? "bg-sky-600 text-white shadow-sm"
                : "bg-brand-card text-slate-400 hover:text-white border border-brand-border"
                }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>MANIFEST MATRIX</span>
            </button>

            <button
              onClick={() => setActiveTab("ledger")}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold flex items-center space-x-2 transition ${activeTab === "ledger"
                ? "bg-purple-600 text-white shadow-sm"
                : "bg-brand-card text-slate-400 hover:text-white border border-brand-border"
                }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>AUDIT LEDGER</span>
            </button>
          </div>

          <div className="flex items-center space-x-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search unit, pilot, hub..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchFleet()}
                className="pl-8 pr-3 py-1.5 bg-brand-card border border-brand-border rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono w-60"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 bg-brand-card border border-brand-border rounded-lg text-xs text-slate-300 font-mono focus:outline-none"
            >
              <option value="ALL">ALL STATES</option>
              <option value="IN TRANSIT">IN TRANSIT</option>
              <option value="IDLE">IDLE</option>
              <option value="SOS">SOS BEACONS</option>
              <option value="MAINTENANCE">MAINTENANCE</option>
            </select>

            <button
              onClick={fetchFleet}
              className="p-1.5 bg-brand-card text-slate-400 hover:text-white rounded-lg border border-brand-border transition"
              title="Refresh Telemetry Pool"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tab Content Display */}
        {activeTab === "manifest" ? (
          <div className="bg-brand-card border border-brand-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-brand-surface text-slate-400 uppercase text-[10px] tracking-wider border-b border-brand-border">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Identifier</th>
                    <th className="py-3 px-4 font-semibold">Pilot</th>
                    <th className="py-3 px-4 font-semibold">Active Geofence Hub</th>
                    <th className="py-3 px-4 font-semibold">Reefer Temp</th>
                    <th className="py-3 px-4 font-semibold">Altitude</th>
                    <th className="py-3 px-4 font-semibold">Velocity</th>
                    <th className="py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4 text-right font-semibold">Quick Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border/60">
                  {vehicles.map((v) => (
                    <tr
                      key={v.id}
                      onClick={() => {
                        playChirp();
                        setSelectedVehicle(v);
                      }}
                      className={`cursor-pointer transition hover:bg-brand-surface/70 ${selectedVehicle?.id === v.id ? "bg-sky-500/10 border-l-2 border-sky-400" : ""
                        }`}
                    >
                      <td className="py-3 px-4 font-bold text-white">{v.vehicle_id}</td>
                      <td className="py-3 px-4 font-sans text-slate-300">{v.driver_name}</td>
                      <td className="py-3 px-4 text-slate-400">{v.current_geofence}</td>
                      <td className="py-3 px-4 text-slate-300 font-bold">{v.cargo_temp}°C</td>
                      <td className="py-3 px-4 text-slate-400">{v.altitude_m} m</td>
                      <td className="py-3 px-4 text-sky-400 font-semibold">{v.speed_kmh} km/h</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${v.status === "SOS"
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse"
                            : v.status === "IN TRANSIT"
                              ? "bg-sky-500/10 text-sky-400 border border-sky-500/30"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                            }`}
                        >
                          {v.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleUpdateStatus(v.vehicle_id, "IN TRANSIT")}
                          className="px-2 py-1 bg-brand-surface hover:bg-sky-500/20 hover:text-sky-300 rounded text-[10px] text-slate-300 border border-brand-border transition"
                        >
                          Transit
                        </button>
                        <button
                          onClick={() => handleUpdateStatus(v.vehicle_id, "IDLE")}
                          className="px-2 py-1 bg-brand-surface hover:bg-amber-500/20 hover:text-amber-300 rounded text-[10px] text-slate-300 border border-brand-border transition"
                        >
                          Idle
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-brand-card border border-brand-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-brand-border pb-3">
              <div className="flex items-center space-x-2 font-mono text-sm text-slate-200">
                <Shield className="w-4 h-4 text-purple-400" />
                <span className="font-bold">CRYPTOGRAPHIC AUDIT LEDGER & GEOFENCE LOGS</span>
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                Append-only immutable operational journal
              </div>
            </div>

            <div className="space-y-2.5 font-mono">
              {auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-3 bg-brand-surface border border-brand-border rounded-lg flex items-start justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2 text-[11px]">
                      <span className="text-purple-400 font-bold">{log.actor_name}</span>
                      <span className="text-slate-500">•</span>
                      <span className="px-1.5 py-0.5 rounded bg-brand-card text-slate-300 text-[10px] border border-brand-border">
                        {log.action}
                      </span>
                      <span className="text-slate-500 text-[10px]">{log.timestamp} UTC</span>
                    </div>
                    <div className="text-xs text-slate-300 font-sans">{log.details}</div>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(log));
                      notify("success", "Audit signature copied.");
                    }}
                    className="p-1.5 text-slate-500 hover:text-slate-300 rounded"
                    title="Copy record hash"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Feature 6: Command Spotlight Terminal (Ctrl + K) */}
      {commandOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-24 p-4">
          <div className="w-full max-w-lg bg-brand-card border border-brand-border rounded-xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center space-x-2.5 border-b border-brand-border pb-3">
              <Command className="w-4 h-4 text-sky-400" />
              <input
                type="text"
                autoFocus
                placeholder="Type unit plate, pilot, or corridor..."
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                className="w-full font-mono text-xs bg-transparent text-white placeholder-slate-500 focus:outline-none"
              />
              <button onClick={() => setCommandOpen(false)} className="text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5 max-h-64 overflow-y-auto font-mono text-xs">
              {filteredCommandVehicles.map((v) => (
                <div
                  key={v.id}
                  onClick={() => {
                    playChirp();
                    setSelectedVehicle(v);
                    setCommandOpen(false);
                  }}
                  className="p-2.5 bg-brand-surface hover:bg-slate-800 rounded-lg cursor-pointer flex items-center justify-between border border-transparent hover:border-sky-500/30 transition"
                >
                  <div>
                    <span className="font-bold text-white">{v.vehicle_id}</span>
                    <span className="text-slate-500 mx-2">•</span>
                    <span className="text-slate-400 font-sans">{v.driver_name}</span>
                  </div>
                  <span className="text-sky-400 font-semibold">{v.speed_kmh} km/h</span>
                </div>
              ))}
            </div>

            <div className="text-[10px] font-mono text-slate-500 flex items-center justify-between border-t border-brand-border pt-2">
              <span>Press ESC to dismiss</span>
              <span>FleetFlow Spotlight Mode</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}