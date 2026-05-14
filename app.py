"""
EDO-LIVE / BLOOPER-SIM
======================
Servidor Flask que expone los modelos diferenciales EXACTOS del informe
academico (Universidad Cooperativa de Colombia, Ecuaciones Diferenciales).

Modelo A — Propagacion del virus Blooper (1.er orden):
    dP/dt = k * P,    P(0) = 1,   P(2) = 3
    => k = ln(3)/2  ~= 0.5493
    => P(t) = 3^(t/2)
    => 12 jugadores infectados en t = 2 ln(12)/ln(3)  ~= 4.5237 s

Modelo B — Uso de CPU del servidor (2.do orden):
    y'' - 5y' + 6y = 0,    y(0) = 40,   y'(0) = 10
    => raices m1=2, m2=3  (sistema INESTABLE)
    => y(t) = 110 e^(2t) - 70 e^(3t)

Toda la matematica vive en este archivo. El frontend obtiene el estado
en tiempo real consultando los endpoints /api/virus y /api/cpu.
"""

import math
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)


# ════════════════════════════════════════════════════════════════════════
#   MODELO A — VIRUS BLOOPER
# ════════════════════════════════════════════════════════════════════════

VIRUS_K = math.log(3) / 2.0                 # k = ln(3)/2  ~= 0.5493
VIRUS_TOTAL = 12                             # 12 corredores en la pista
VIRUS_T_FULL = 2.0 * math.log(VIRUS_TOTAL) / math.log(3)  # ~= 4.5237 s


def virus_P(t: float) -> float:
    """Solucion exacta: P(t) = 3^(t/2)."""
    return 3.0 ** (t / 2.0)


def virus_dPdt(t: float) -> float:
    """Derivada del modelo: dP/dt = k * P."""
    return VIRUS_K * virus_P(t)


def virus_time_for_racer(n: int) -> float:
    """Instante exacto en que la P(t) alcanza al corredor n.

    P(t) = n  =>  3^(t/2) = n  =>  t = 2 * ln(n) / ln(3).
    Corredor 1 = paciente cero (t = 0).
    """
    if n <= 1:
        return 0.0
    return 2.0 * math.log(n) / math.log(3)


def virus_infected_count(t: float) -> int:
    """Cantidad discreta de corredores infectados en el instante t."""
    if t <= 0.0:
        return 1
    return min(VIRUS_TOTAL, max(1, int(math.floor(virus_P(t)))))


# ════════════════════════════════════════════════════════════════════════
#   MODELO B — USO DE CPU
# ════════════════════════════════════════════════════════════════════════

CPU_C1 = 110.0      # constante C1 del informe
CPU_C2 = -70.0      # constante C2 del informe
CPU_M1 = 2.0        # raiz 1 del polinomio caracteristico
CPU_M2 = 3.0        # raiz 2 del polinomio caracteristico

# Cruce por cero exacto: y(t)=0  =>  110 e^(2t) = 70 e^(3t)  =>  t = ln(11/7)
CPU_T_ZERO = math.log(11.0 / 7.0)          # ~= 0.45199
# Maximo local de y(t):  y'(t)=0  =>  220 e^(2t) = 210 e^(3t)  =>  t = ln(22/21)
CPU_T_PEAK = math.log(22.0 / 21.0)          # ~= 0.04652


def cpu_y(t: float) -> float:
    """Solucion exacta: y(t) = 110 * e^(2t) - 70 * e^(3t)."""
    return CPU_C1 * math.exp(CPU_M1 * t) + CPU_C2 * math.exp(CPU_M2 * t)


def cpu_yp(t: float) -> float:
    """Derivada: y'(t) = 220 * e^(2t) - 210 * e^(3t)."""
    return CPU_C1 * CPU_M1 * math.exp(CPU_M1 * t) + CPU_C2 * CPU_M2 * math.exp(CPU_M2 * t)


def cpu_percent(t: float) -> float:
    """Magnitud |y(t)| recortada al rango [0, 100] para la barra visual.

    El informe clasifica el sistema como INESTABLE: |y(t)| -> infinito.
    Visualmente la CPU se 'satura' cuando |y(t)| >= 100.
    """
    return max(0.0, min(100.0, abs(cpu_y(t))))


def cpu_temperature_c(t: float) -> float:
    """Temperatura sintetica derivada de |y(t)|. Reposo = 32 C."""
    return 32.0 + 0.55 * abs(cpu_y(t))


def cpu_ram_percent(t: float) -> float:
    """Uso de RAM complementario derivado de |y(t)| con saturacion suave."""
    return min(99.0, 38.0 + 60.0 * math.tanh(abs(cpu_y(t)) / 60.0))


def cpu_processes(t: float) -> int:
    """Numero de procesos activos derivado de |y'(t)|."""
    return int(48 + abs(cpu_yp(t)) / 6.0)


def cpu_fan_rpm(t: float) -> int:
    """RPM de los ventiladores derivado de |y(t)|. Reposo = 1200 RPM."""
    return int(1200 + 24.0 * abs(cpu_y(t)))


def cpu_collapse_time(threshold: float = 100.0) -> float:
    """Instante en que |y(t)| alcanza el umbral de colapso (default 100%).

    Como y(t) cruza cero en t* = ln(11/7) ~= 0.4520 y luego diverge a
    -infinito, buscamos por biseccion la raiz de |y(t)| = threshold en
    [t*, 4]. Comenzamos justo despues del cruce para que la rama negativa
    sea estrictamente monotona creciente en magnitud.
    """
    lo, hi = CPU_T_ZERO + 1e-4, 4.0
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if abs(cpu_y(mid)) >= threshold:
            hi = mid
        else:
            lo = mid
    return 0.5 * (lo + hi)


# ════════════════════════════════════════════════════════════════════════
#   RUTAS / API
# ════════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    """Pagina principal del laboratorio EDO-LIVE."""
    return render_template("index.html")


# ─── Virus ──────────────────────────────────────────────────────────────

@app.route("/api/virus")
def api_virus():
    """Estado completo del modelo viral en el instante t."""
    try:
        t = float(request.args.get("t", 0.0))
    except ValueError:
        return jsonify({"ok": False, "error": "t invalido"}), 400
    t = max(0.0, t)
    return jsonify({
        "ok": True,
        "t": t,
        "P": virus_P(t),
        "dPdt": virus_dPdt(t),
        "infected": virus_infected_count(t),
        "total": VIRUS_TOTAL,
        "k": VIRUS_K,
        "t_full": VIRUS_T_FULL,
        "model": {
            "ode": "dP/dt = k * P",
            "conditions": {"P(0)": 1, "P(2)": 3},
            "k_exact": "ln(3)/2",
            "solution": "P(t) = 3^(t/2)",
        },
    })


@app.route("/api/virus/schedule")
def api_virus_schedule():
    """Cronograma exacto: instante en que cada uno de los 12 cae infectado."""
    sched = [
        {"racer": n, "t": virus_time_for_racer(n)}
        for n in range(1, VIRUS_TOTAL + 1)
    ]
    return jsonify({
        "ok": True,
        "schedule": sched,
        "t_full": VIRUS_T_FULL,
        "k": VIRUS_K,
    })


@app.route("/api/virus/series")
def api_virus_series():
    """Curva P(t) muestreada para la grafica."""
    try:
        n = max(2, int(request.args.get("n", 200)))
        t_end = float(request.args.get("t_end", VIRUS_T_FULL))
    except ValueError:
        return jsonify({"ok": False, "error": "parametros invalidos"}), 400
    pts = []
    for i in range(n + 1):
        t = t_end * i / n
        pts.append({"t": t, "P": virus_P(t)})
    return jsonify({"ok": True, "points": pts, "t_full": VIRUS_T_FULL})


# ─── CPU ────────────────────────────────────────────────────────────────

@app.route("/api/cpu")
def api_cpu():
    """Estado completo del modelo de CPU en el instante t."""
    try:
        t = float(request.args.get("t", 0.0))
    except ValueError:
        return jsonify({"ok": False, "error": "t invalido"}), 400
    t = max(0.0, t)
    return jsonify({
        "ok": True,
        "t": t,
        "t_unit": "h",
        "y": cpu_y(t),
        "y_prime": cpu_yp(t),
        "abs_y": abs(cpu_y(t)),
        "cpu_percent": cpu_percent(t),
        "ram_percent": cpu_ram_percent(t),
        "temperature_c": cpu_temperature_c(t),
        "processes": cpu_processes(t),
        "fan_rpm": cpu_fan_rpm(t),
        "classification": "INESTABLE",
        "roots": [CPU_M1, CPU_M2],
        "t_zero": CPU_T_ZERO,
        "t_peak": CPU_T_PEAK,
        "model": {
            "ode": "y'' - 5y' + 6y = 0",
            "initial": {"y(0)": 40, "y'(0)": 10},
            "solution": "y(t) = 110 e^(2t) - 70 e^(3t)",
            "C1": CPU_C1,
            "C2": CPU_C2,
            "t_zero_exact": "ln(11/7)",
            "limit": "y(t) -> -inf",
        },
    })


@app.route("/api/cpu/series")
def api_cpu_series():
    """Curva y(t) muestreada para la grafica del osciloscopio."""
    try:
        n = max(2, int(request.args.get("n", 240)))
        t_end = float(request.args.get("t_end", 2.0))
    except ValueError:
        return jsonify({"ok": False, "error": "parametros invalidos"}), 400
    pts = []
    for i in range(n + 1):
        t = t_end * i / n
        yv = cpu_y(t)
        pts.append({
            "t": t,
            "y": yv,
            "abs_y": abs(yv),
            "pct": cpu_percent(t),
        })
    return jsonify({
        "ok": True,
        "points": pts,
        "collapse_t": cpu_collapse_time(),
        "t_zero": CPU_T_ZERO,
        "t_peak": CPU_T_PEAK,
        "y_initial": cpu_y(0.0),
        "y_at_collapse": -100.0,
        "t_unit": "h",
    })


@app.route("/api/cpu/collapse")
def api_cpu_collapse():
    """Instante en que |y(t)| alcanza el umbral de saturacion (100%)."""
    return jsonify({"ok": True, "collapse_t": cpu_collapse_time()})


# ─── Metadatos ──────────────────────────────────────────────────────────

@app.route("/api/info")
def api_info():
    """Metadatos del proyecto y de ambos modelos."""
    return jsonify({
        "ok": True,
        "project": "EDO-LIVE / BLOOPER-SIM",
        "university": "Universidad Cooperativa de Colombia",
        "course": "Ecuaciones Diferenciales",
        "models": {
            "virus": {
                "ode": "dP/dt = k * P",
                "solution": "P(t) = 3^(t/2)",
                "k": VIRUS_K,
                "t_saturate": VIRUS_T_FULL,
            },
            "cpu": {
                "ode": "y'' - 5y' + 6y = 0",
                "solution": "y(t) = 110 e^(2t) - 70 e^(3t)",
                "initial": {"y(0)": 40, "y'(0)": 10},
                "roots": [CPU_M1, CPU_M2],
                "classification": "INESTABLE",
            },
        },
    })


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
