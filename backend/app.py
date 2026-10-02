import os
import sqlite3
import datetime
import random
import math
from functools import wraps
from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
import jwt
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)

# Complete CORS Support
CORS(
    app,
    resources={r"/*": {"origins": "*"}},
    supports_credentials=True,
    allow_headers=["*"],
    methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
)

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Accept, Origin"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, PUT, DELETE, OPTIONS"
    return response

SECRET_KEY = os.environ.get("SECRET_KEY", "fleetflow-enterprise-production-key-2026")
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fleetflow.db")

def get_db():
    conn = sqlite3.connect(DB_FILE, timeout=20)
    conn.row_factory = sqlite3.Row
    return conn

GEOFENCE_HUBS = [
    {"id": "GEO-JNPT", "name": "JNPT Maritime Port Zone", "lat": 18.9499, "lng": 72.9510, "radius_km": 12.0},
    {"id": "GEO-CHAKAN", "name": "Pune Chakan MIDC Industrial Quad", "lat": 18.7606, "lng": 73.8611, "radius_km": 10.0},
    {"id": "GEO-BHIWANDI", "name": "Bhiwandi Warehousing & Logistics Nexus", "lat": 19.2967, "lng": 73.0631, "radius_km": 14.0}
]

def calculate_haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                badge_id TEXT DEFAULT 'DIR-409'
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS vehicles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vehicle_id TEXT UNIQUE NOT NULL,
                driver_name TEXT NOT NULL,
                corridor TEXT NOT NULL,
                status TEXT NOT NULL,
                cargo_weight INTEGER NOT NULL,
                fuel_level INTEGER DEFAULT 88,
                speed_kmh INTEGER DEFAULT 0,
                engine_temp INTEGER DEFAULT 84,
                battery_voltage REAL DEFAULT 24.2,
                tpms_fl INTEGER DEFAULT 34,
                tpms_fr INTEGER DEFAULT 34,
                tpms_rl INTEGER DEFAULT 35,
                tpms_rr INTEGER DEFAULT 35,
                cargo_temp REAL DEFAULT 4.2,
                cargo_type TEXT DEFAULT 'General Freight',
                hos_minutes INTEGER DEFAULT 310,
                altitude_m INTEGER DEFAULT 540,
                current_geofence TEXT DEFAULT 'Transit Corridor',
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                route_progress INTEGER DEFAULT 45,
                destination_eta TEXT DEFAULT '2h 15m',
                last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                actor_name TEXT NOT NULL,
                action TEXT NOT NULL,
                details TEXT NOT NULL
            )
        ''')

        cursor.execute("SELECT COUNT(*) FROM users")
        if cursor.fetchone()[0] == 0:
            pw = generate_password_hash("password123")
            cursor.execute(
                "INSERT INTO users (email, password, name, role, badge_id) VALUES (?, ?, ?, ?, ?)",
                ("manager@fleetflow.io", pw, "Aditi Raj (Dispatch Director)", "manager", "DIR-409")
            )
            cursor.execute(
                "INSERT INTO users (email, password, name, role, badge_id) VALUES (?, ?, ?, ?, ?)",
                ("driver@fleetflow.io", pw, "Rajesh Sharma (Senior Field Pilot)", "driver", "DRV-112")
            )

        cursor.execute("SELECT COUNT(*) FROM vehicles")
        if cursor.fetchone()[0] == 0:
            fleet_seed = [
                ("MH-12-TR-4091", "Rajesh Sharma", "Pune (Hinjawadi) → Mumbai (JNPT Port)", "IN TRANSIT", 4200, 78, 64, 86, 24.4, 34, 34, 35, 35, -18.2, "Refrigerated Pharma", 290, 580, "Western Ghats Corridor", 18.7500, 73.4000, 62, "1h 45m"),
                ("MH-14-AZ-8820", "Amit Kulkarni", "Pune Chakan MIDC → Bengaluru Expressway", "IN TRANSIT", 6400, 92, 72, 88, 24.1, 33, 34, 36, 36, 18.0, "Heavy Machinery", 185, 620, "Pune Chakan MIDC", 18.7610, 73.8620, 38, "6h 20m"),
                ("MH-04-DL-1102", "Vikram Patil", "Mumbai Air Cargo Complex → Surat Hub", "IDLE", 0, 48, 0, 72, 24.6, 32, 32, 34, 34, 22.0, "Dry Goods", 440, 14, "Mumbai Port Zone", 19.0760, 72.8777, 100, "Completed"),
                ("MH-12-QX-9031", "Suresh Deshmukh", "Pune Express Ring Road Loop", "MAINTENANCE", 0, 18, 0, 68, 23.8, 28, 30, 31, 30, 24.0, "Empty Container", 60, 560, "Depot Standby", 18.6298, 73.7997, 0, "Standby"),
                ("MH-09-EM-5510", "Pooja Varma", "Nashik Agro Hub → Navi Mumbai Cold Terminal", "IN TRANSIT", 4600, 84, 58, 83, 24.2, 34, 34, 35, 35, -19.4, "Cold-Chain Agriculture", 210, 490, "Nashik Expressway", 19.5000, 73.3000, 75, "45m"),
                ("MH-31-CA-2209", "Anand Shinde", "Nagpur Logistics Quad → Aurangabad MIDC", "IN TRANSIT", 5800, 65, 68, 87, 24.0, 35, 34, 36, 35, 16.5, "Electronics Payload", 340, 310, "Samruddhi Mahamarg", 20.2000, 76.5000, 52, "3h 10m")
            ]
            cursor.executemany('''
                INSERT INTO vehicles (
                    vehicle_id, driver_name, corridor, status, cargo_weight, 
                    fuel_level, speed_kmh, engine_temp, battery_voltage,
                    tpms_fl, tpms_fr, tpms_rl, tpms_rr, cargo_temp, cargo_type,
                    hos_minutes, altitude_m, current_geofence, lat, lng, route_progress, destination_eta
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', fleet_seed)

            cursor.execute('''
                INSERT INTO audit_logs (actor_name, action, details)
                VALUES ('CORE_DAEMON', 'SYSTEM_BOOT', 'Maharashtra corridor telemetry cluster initialized.')
            ''')

        conn.commit()

init_db()

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return jsonify({"error": "Unauthorized", "message": "Missing Bearer token"}), 401
        token = auth_header.split(" ")[1]
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            request.user = payload
        except Exception:
            return jsonify({"error": "Unauthorized", "message": "Session expired or invalid"}), 401
        return f(*args, **kwargs)
    return decorated

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "OPERATIONAL",
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "geofences": GEOFENCE_HUBS
    }), 200

@app.route("/api/auth/login", methods=["POST"])
def login():
    try:
        data = request.get_json() or {}
        email = data.get("email")
        password = data.get("password")

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
            user = cursor.fetchone()

        if not user or not check_password_hash(user["password"], password):
            return jsonify({"error": "Unauthorized", "message": "Invalid login credentials"}), 401

        user_dict = dict(user)
        badge = user_dict.get("badge_id", "DIR-409")

        token = jwt.encode({
            "user_id": user_dict["id"],
            "email": user_dict["email"],
            "name": user_dict["name"],
            "role": user_dict["role"],
            "badge_id": badge,
            "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=48)
        }, SECRET_KEY, algorithm="HS256")

        return jsonify({
            "token": token,
            "user": {
                "id": user_dict["id"],
                "email": user_dict["email"],
                "name": user_dict["name"],
                "role": user_dict["role"],
                "badge_id": badge
            }
        }), 200
    except Exception as e:
        return jsonify({"error": "Server Error", "message": str(e)}), 500

@app.route("/api/vehicles", methods=["GET"])
@token_required
def get_vehicles():
    try:
        status_filter = request.args.get("status")
        search_query = request.args.get("q")

        query = "SELECT * FROM vehicles WHERE 1=1"
        params = []

        if status_filter and status_filter != "ALL":
            query += " AND status = ?"
            params.append(status_filter.upper())

        if search_query:
            query += " AND (vehicle_id LIKE ? OR driver_name LIKE ? OR corridor LIKE ? OR current_geofence LIKE ?)"
            term = f"%{search_query}%"
            params.extend([term, term, term, term])

        query += " ORDER BY CASE status WHEN 'SOS' THEN 1 WHEN 'IN TRANSIT' THEN 2 WHEN 'IDLE' THEN 3 ELSE 4 END, last_ping DESC"

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params)
            vehicles_list = [dict(row) for row in cursor.fetchall()]

            cursor.execute("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 20")
            logs_list = [dict(row) for row in cursor.fetchall()]

        return jsonify({
            "count": len(vehicles_list),
            "vehicles": vehicles_list,
            "geofences": GEOFENCE_HUBS,
            "audit_logs": logs_list
        }), 200
    except Exception as e:
        return jsonify({"error": "Query Error", "message": str(e)}), 500

@app.route("/api/vehicles/<vehicle_id>/status", methods=["PATCH"])
@token_required
def update_status(vehicle_id):
    try:
        data = request.get_json() or {}
        new_status = data.get("status", "").upper()

        if new_status not in ["IN TRANSIT", "IDLE", "MAINTENANCE", "SOS"]:
            return jsonify({"error": "Bad Request", "message": "Invalid status"}), 400

        new_speed = random.randint(55, 78) if new_status in ["IN TRANSIT", "SOS"] else 0

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE vehicles 
                SET status = ?, speed_kmh = ?, last_ping = CURRENT_TIMESTAMP 
                WHERE vehicle_id = ?
            ''', (new_status, new_speed, vehicle_id.upper()))

            if cursor.rowcount == 0:
                return jsonify({"error": "Not Found", "message": "Vehicle not found"}), 404

            actor = request.user.get("name", "Dispatcher")
            action_type = "EMERGENCY_BEACON" if new_status == "SOS" else "DISPATCH_MUTATION"
            cursor.execute('''
                INSERT INTO audit_logs (actor_name, action, details)
                VALUES (?, ?, ?)
            ''', (actor, action_type, f"Status transition: {vehicle_id.upper()} transitioned to {new_status} state."))
            conn.commit()

        return jsonify({"message": f"Updated {vehicle_id} to {new_status}"}), 200
    except Exception as e:
        return jsonify({"error": "Mutation Error", "message": str(e)}), 500

@app.route("/api/vehicles/simulate-telemetry", methods=["POST"])
@token_required
def simulate():
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, vehicle_id, driver_name, lat, lng, fuel_level, speed_kmh, engine_temp, route_progress, altitude_m, cargo_temp, current_geofence, hos_minutes FROM vehicles WHERE status IN ('IN TRANSIT', 'SOS')")
            units = cursor.fetchall()

            for u in units:
                d_lat = u["lat"] + random.uniform(-0.002, 0.002)
                d_lng = u["lng"] + random.uniform(-0.002, 0.002)
                n_fuel = max(u["fuel_level"] - random.choice([0, 1]), 6)
                n_speed = min(max(u["speed_kmh"] + random.randint(-3, 3), 48), 84)
                n_temp = min(max(u["engine_temp"] + random.randint(-1, 1), 78), 94)
                n_prog = min(u["route_progress"] + 1, 99)
                n_alt = min(max(u["altitude_m"] + random.randint(-8, 8), 10), 720)
                n_cargo_temp = round(u["cargo_temp"] + random.uniform(-0.1, 0.1), 1)
                n_hos = u["hos_minutes"] + 1

                detected_fence = "Transit Corridor"
                for hub in GEOFENCE_HUBS:
                    dist = calculate_haversine(d_lat, d_lng, hub["lat"], hub["lng"])
                    if dist <= hub["radius_km"]:
                        detected_fence = hub["name"]
                        break

                if detected_fence != u["current_geofence"] and detected_fence != "Transit Corridor":
                    cursor.execute('''
                        INSERT INTO audit_logs (actor_name, action, details)
                        VALUES ('GEOFENCE_ENGINE', 'ZONE_ENTRY', ?)
                    ''', (f"Asset {u['vehicle_id']} entered perimeter: {detected_fence}",))

                cursor.execute('''
                    UPDATE vehicles 
                    SET lat = ?, lng = ?, fuel_level = ?, speed_kmh = ?, engine_temp = ?, 
                        route_progress = ?, altitude_m = ?, cargo_temp = ?, current_geofence = ?, 
                        hos_minutes = ?, last_ping = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (d_lat, d_lng, n_fuel, n_speed, n_temp, n_prog, n_alt, n_cargo_temp, detected_fence, n_hos, u["id"]))

            conn.commit()
        return jsonify({"status": "Telemetry broadcast complete"}), 200
    except Exception as e:
        return jsonify({"error": "Sim Error", "message": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)