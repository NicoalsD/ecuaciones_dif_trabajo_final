"""ODE models + custom RK4 solver. Python mirror of original models.js."""
import math
import re
import numpy as np
from scipy.integrate import solve_ivp


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _round(x, n=4):
    if not math.isfinite(x):
        return x
    return round(x, n)


def fmt(x, n=3):
    if not math.isfinite(x):
        return str(x)
    if abs(x) < 1e-10:
        return "0"
    r = round(x, n)
    if r == int(r):
        return str(int(r))
    return str(r)


def _stringify(x):
    """JSON-safe value: NaN/inf -> None."""
    if isinstance(x, (np.floating, float)) and not math.isfinite(float(x)):
        return None
    if isinstance(x, np.ndarray):
        return [_stringify(v) for v in x.tolist()]
    return x


# ---------------------------------------------------------------------------
# 2nd order homogeneous solver:  a y'' + b y' + c y = 0
# ---------------------------------------------------------------------------
def solve_homogeneous2(a, b, c, y0, y0p):
    disc = b * b - 4 * a * c
    if disc > 1e-9:
        sq = math.sqrt(disc)
        m1 = (-b + sq) / (2 * a)
        m2 = (-b - sq) / (2 * a)
        C2 = (y0p - m1 * y0) / (m2 - m1)
        C1 = y0 - C2
        return {
            "kind": "real_distinct",
            "roots": [m1, m2],
            "constants": {"C1": C1, "C2": C2},
            "y": lambda t: C1 * np.exp(m1 * t) + C2 * np.exp(m2 * t),
            "latex": f"y(t) = {fmt(C1)} e^{{{fmt(m1)} t}} + {fmt(C2)} e^{{{fmt(m2)} t}}",
        }
    if disc < -1e-9:
        alpha = -b / (2 * a)
        beta = math.sqrt(-disc) / (2 * a)
        C1 = y0
        C2 = (y0p - alpha * y0) / beta
        return {
            "kind": "complex",
            "roots": [{"re": alpha, "im": beta}, {"re": alpha, "im": -beta}],
            "constants": {"C1": C1, "C2": C2, "alpha": alpha, "beta": beta},
            "y": lambda t: np.exp(alpha * t) * (C1 * np.cos(beta * t) + C2 * np.sin(beta * t)),
            "latex": (
                f"y(t) = e^{{{fmt(alpha)} t}}\\left("
                f"{fmt(C1)} \\cos {fmt(beta)} t + {fmt(C2)} \\sin {fmt(beta)} t\\right)"
            ),
        }
    m = -b / (2 * a)
    C1 = y0
    C2 = y0p - m * y0
    return {
        "kind": "real_repeated",
        "roots": [m, m],
        "constants": {"C1": C1, "C2": C2},
        "y": lambda t: np.exp(m * t) * (C1 + C2 * t),
        "latex": f"y(t) = e^{{{fmt(m)} t}}\\left({fmt(C1)} + {fmt(C2)} t\\right)",
    }


def classify_stability(sol):
    r = sol["roots"]
    if sol["kind"] == "real_distinct":
        m1, m2 = r
        if m1 > 0 or m2 > 0:
            if m1 > 0 and m2 > 0:
                return {"label": "Inestable", "tone": "danger",
                        "note": "Ambas raíces son reales y positivas: las soluciones divergen exponencialmente."}
            return {"label": "Inestable (silla)", "tone": "danger",
                    "note": "Una raíz positiva domina y produce divergencia."}
        return {"label": "Sobreamortiguado", "tone": "stable",
                "note": "Raíces reales distintas y negativas. Retorno monótono al equilibrio sin oscilación."}
    if sol["kind"] == "real_repeated":
        m = r[0]
        if m < 0:
            return {"label": "Críticamente amortiguado", "tone": "stable",
                    "note": "Raíz real doble negativa: el sistema retorna al equilibrio en el menor tiempo posible sin oscilar."}
        if m > 0:
            return {"label": "Inestable", "tone": "danger",
                    "note": "Raíz doble positiva: divergencia."}
        return {"label": "Marginal", "tone": "warn", "note": "Raíz doble nula."}
    a = r[0]["re"]
    if a < -1e-9:
        return {"label": "Subamortiguado", "tone": "stable",
                "note": "Raíces complejas conjugadas con parte real negativa. Oscilaciones amortiguadas."}
    if a > 1e-9:
        return {"label": "Inestable oscilatorio", "tone": "danger",
                "note": "Parte real positiva: oscilaciones de amplitud creciente."}
    return {"label": "Marginalmente estable", "tone": "warn",
            "note": "Raíces imaginarias puras: oscila sin amortiguar."}


def roots_latex(sol):
    if sol["kind"] == "real_distinct":
        return f"m_1 = {fmt(sol['roots'][0])}, \\quad m_2 = {fmt(sol['roots'][1])}"
    if sol["kind"] == "real_repeated":
        return f"m_1 = m_2 = {fmt(sol['roots'][0])}"
    re_, im_ = sol["roots"][0]["re"], sol["roots"][0]["im"]
    return f"m_{{1,2}} = {fmt(re_)} \\pm {fmt(abs(im_))} i"


# ---------------------------------------------------------------------------
# Trajectory sampler
# ---------------------------------------------------------------------------
def _sample(solve_fn, t_max, N=600):
    ts = np.linspace(0, t_max, N)
    ys = solve_fn(ts)
    if np.isscalar(ys):
        ys = np.full_like(ts, ys)
    return ts, np.asarray(ys, dtype=float)


# ---------------------------------------------------------------------------
# PART I — First order analytic models
# ---------------------------------------------------------------------------
def virus_analyze(p):
    t_thr = math.log(p["threshold"] / p["P0"]) / p["k"] if p["k"] != 0 else float("inf")
    stability = (
        {"label": "Crecimiento exponencial", "tone": "danger", "note": "k > 0 ⇒ la población crece sin cota."}
        if p["k"] > 0 else
        {"label": "Decaimiento exponencial", "tone": "stable", "note": "k < 0 ⇒ la población decae a cero."}
    )
    ts, ys = _sample(lambda t: p["P0"] * np.exp(p["k"] * t), p["tMax"])
    markers = []
    if math.isfinite(t_thr) and 0 < t_thr < p["tMax"]:
        markers.append({"t": t_thr, "y": p["threshold"], "label": f"Umbral {p['threshold']}"})
    return {
        "ts": ts.tolist(), "ys": ys.tolist(),
        "equationLatex": f"\\dfrac{{dP}}{{dt}} = {fmt(p['k'])}\\,P",
        "solutionLatex": f"P(t) = {fmt(p['P0'])} e^{{{fmt(p['k'])} t}}",
        "stability": stability,
        "metrics": [
            {"label": f"Tiempo para alcanzar {p['threshold']}",
             "value": f"{_round(t_thr, 2)} s" if math.isfinite(t_thr) and t_thr > 0 else "∞"},
            {"label": "P(t_max)", "value": str(_round(p["P0"] * math.exp(p["k"] * p["tMax"]), 2))},
            {"label": "Tiempo de duplicación", "value": f"{_round(math.log(2) / p['k'], 3)} s"},
        ],
        "markers": markers,
        "asymptote": None,
    }


def motor_analyze(p):
    T_at = p["Tm"] + (p["T0"] - p["Tm"]) * math.exp(p["k"] * p["tQuery"])
    ts, ys = _sample(lambda t: p["Tm"] + (p["T0"] - p["Tm"]) * np.exp(p["k"] * t), p["tMax"])
    stability = (
        {"label": "Estable", "tone": "stable", "note": "k < 0 ⇒ T(t) → Tₘ. Enfriamiento."}
        if p["k"] < 0 else
        {"label": "Inestable", "tone": "danger", "note": "k > 0 ⇒ T(t) diverge."}
    )
    return {
        "ts": ts.tolist(), "ys": ys.tolist(),
        "equationLatex": f"\\dfrac{{dT}}{{dt}} = {fmt(p['k'])}\\,(T - {fmt(p['Tm'])})",
        "solutionLatex": f"T(t) = {fmt(p['Tm'])} + {fmt(p['T0'] - p['Tm'])} e^{{{fmt(p['k'])} t}}",
        "stability": stability,
        "metrics": [
            {"label": f"T({p['tQuery']} min)", "value": f"{_round(T_at, 2)} °C"},
            {"label": "Asíntota T∞", "value": f"{_round(p['Tm'], 2)} °C"},
            {"label": "Vida media térmica", "value": f"{_round(math.log(2) / abs(p['k']), 3)} min"},
        ],
        "markers": [{"t": p["tQuery"], "y": T_at, "label": f"T({p['tQuery']}) = {_round(T_at, 2)} °C"}],
        "asymptote": p["Tm"],
    }


def tanque_analyze(p):
    Aeq = p["ce"] * p["V"]
    rate = p["f"] / p["V"]
    A_at = Aeq + (p["A0"] - Aeq) * math.exp(-rate * p["tQuery"])
    ts, ys = _sample(lambda t: Aeq + (p["A0"] - Aeq) * np.exp(-rate * t), p["tMax"])
    return {
        "ts": ts.tolist(), "ys": ys.tolist(),
        "equationLatex": f"\\dfrac{{dA}}{{dt}} = {fmt(p['ce'] * p['f'])} - {fmt(rate)}\\,A",
        "solutionLatex": f"A(t) = {fmt(Aeq)} + {fmt(p['A0'] - Aeq)} e^{{-{fmt(rate)} t}}",
        "stability": {"label": "Estable", "tone": "stable",
                      "note": f"A(t) → cₑ·V = {_round(Aeq, 3)} kg."},
        "metrics": [
            {"label": f"A({p['tQuery']} min)", "value": f"{_round(A_at, 3)} kg"},
            {"label": "Soluto en equilibrio", "value": f"{_round(Aeq, 3)} kg"},
            {"label": "Constante de tiempo τ = V/f", "value": f"{_round(p['V'] / p['f'], 3)} min"},
        ],
        "markers": [{"t": p["tQuery"], "y": A_at, "label": f"A({p['tQuery']}) = {_round(A_at, 3)} kg"}],
        "asymptote": Aeq,
    }


def rc_analyze(p):
    tau = p["R"] * p["C"]
    q_at = p["C"] * p["E"] * (1 - math.exp(-p["tQuery"] / tau))
    ts, ys = _sample(lambda t: p["C"] * p["E"] * (1 - np.exp(-t / tau)), p["tMax"])
    _, ys2 = _sample(lambda t: (p["E"] / p["R"]) * np.exp(-t / tau), p["tMax"])
    return {
        "ts": ts.tolist(), "ys": ys.tolist(), "ys2": ys2.tolist(),
        "secondaryLabel": "i(t) — corriente (A)",
        "equationLatex": f"{fmt(p['R'])}\\dfrac{{dq}}{{dt}} + {fmt(1 / p['C'])} q = {fmt(p['E'])}",
        "solutionLatex": f"q(t) = {fmt(p['C'] * p['E'])}(1 - e^{{-t/{fmt(tau)}}})",
        "stability": {"label": "Estable", "tone": "stable",
                      "note": f"Constante de tiempo τ = RC = {_round(tau, 3)} s."},
        "metrics": [
            {"label": f"q({p['tQuery']} s)", "value": f"{_round(q_at, 4)} C"},
            {"label": "Carga máxima q∞ = CE", "value": f"{_round(p['C'] * p['E'], 4)} C"},
            {"label": "Corriente inicial i(0) = E/R", "value": f"{_round(p['E'] / p['R'], 4)} A"},
            {"label": "τ = RC", "value": f"{_round(tau, 4)} s"},
        ],
        "markers": [{"t": p["tQuery"], "y": q_at, "label": f"q({p['tQuery']}) = {_round(q_at, 3)} C"}],
        "asymptote": p["C"] * p["E"],
    }


def slick_analyze(p):
    k = math.log(2) / p["tHalf"]
    N_at = p["N0"] * math.exp(-k * p["tQuery"])
    ts, ys = _sample(lambda t: p["N0"] * np.exp(-k * t), p["tMax"])
    return {
        "ts": ts.tolist(), "ys": ys.tolist(),
        "equationLatex": f"\\dfrac{{dN}}{{dt}} = -{fmt(k)}\\,N",
        "solutionLatex": f"N(t) = {fmt(p['N0'])} e^{{-{fmt(k)} t}}",
        "stability": {"label": "Decaimiento estable", "tone": "stable",
                      "note": f"k = ln(2)/t½ = {_round(k, 4)}."},
        "metrics": [
            {"label": f"N({p['tQuery']} vueltas)", "value": f"{_round(N_at, 2)} %"},
            {"label": "k (tasa de desgaste)", "value": str(_round(k, 4))},
            {"label": "Vueltas hasta 10%", "value": f"{_round(math.log(p['N0'] / 10) / k, 2)} vueltas"},
        ],
        "markers": [{"t": p["tQuery"], "y": N_at, "label": f"N({p['tQuery']}) = {_round(N_at, 2)} %"}],
        "asymptote": 0,
    }


# ---------------------------------------------------------------------------
# PART II — Second order homogeneous
# ---------------------------------------------------------------------------
def _second_order_factory(coeffs_fn, equation_display_fn):
    def analyze(p):
        a, b, c = coeffs_fn(p)
        sol = solve_homogeneous2(a, b, c, p["y0"], p["y0p"])
        stab = classify_stability(sol)
        ec = f"{fmt(a)} m^2 + {fmt(b)} m + {fmt(c)} = 0".replace("+ -", "- ")
        ts = np.linspace(0, p["tMax"], 600)
        ys = sol["y"](ts)
        y_at = float(sol["y"](np.array(p["tQuery"])))
        kind_label = {
            "real_distinct": "Reales distintas",
            "real_repeated": "Reales repetidas",
            "complex": "Complejas conjugadas",
        }[sol["kind"]]
        return {
            "ts": ts.tolist(), "ys": ys.tolist(),
            "equationLatex": equation_display_fn(p),
            "solutionLatex": sol["latex"],
            "characteristicLatex": ec,
            "rootsLatex": roots_latex(sol),
            "stability": stab,
            "metrics": [
                {"label": f"y({p['tQuery']})", "value": str(_round(y_at, 3))},
                {"label": "Tipo de raíces", "value": kind_label},
                {"label": "Constantes (C₁, C₂)",
                 "value": f"({_round(sol['constants']['C1'], 3)}, {_round(sol['constants']['C2'], 3)})"},
            ],
            "markers": [{"t": p["tQuery"], "y": y_at,
                         "label": f"y({p['tQuery']}) = {_round(y_at, 2)}"}],
            "asymptote": 0 if stab["tone"] == "stable" else None,
        }
    return analyze


def _eq_display_unit_a(p):
    return (f"y'' {'+' if p['b'] >= 0 else '-'} {fmt(abs(p['b']))} y' "
            f"{'+' if p['c'] >= 0 else '-'} {fmt(abs(p['c']))} y = 0")


def _eq_display_with_a(p):
    return (f"{fmt(p['a'])} y'' {'+' if p['b'] >= 0 else '-'} {fmt(abs(p['b']))} y' "
            f"{'+' if p['c'] >= 0 else '-'} {fmt(abs(p['c']))} y = 0")


cpu_analyze = _second_order_factory(
    lambda p: (1, p["b"], p["c"]),
    _eq_display_unit_a,
)
solicitudes_analyze = _second_order_factory(
    lambda p: (1, p["b"], p["c"]),
    _eq_display_unit_a,
)
recuperacion_analyze = _second_order_factory(
    lambda p: (1, p["b"], p["c"]),
    _eq_display_unit_a,
)
balanceador_analyze = _second_order_factory(
    lambda p: (p["a"], p["b"], p["c"]),
    _eq_display_with_a,
)


def paquetes_analyze(p):
    # y'' - 2y' + 5y = A e^t. roots 1 ± 2i, yp = (A/4) e^t
    Aamp = p["A"] / 4
    C1 = p["y0"] - Aamp
    C2 = (p["y0p"] - Aamp - C1) / 2
    ts = np.linspace(0, p["tMax"], 600)
    yc = np.exp(ts) * (C1 * np.cos(2 * ts) + C2 * np.sin(2 * ts))
    yp_arr = Aamp * np.exp(ts)
    ys = yc + yp_arr
    tq = p["tQuery"]
    y_at = math.exp(tq) * (C1 * math.cos(2 * tq) + C2 * math.sin(2 * tq)) + Aamp * math.exp(tq)
    return {
        "ts": ts.tolist(), "ys": ys.tolist(), "ys2": yp_arr.tolist(),
        "secondaryLabel": "yₚ(t) — solución particular",
        "equationLatex": f"y'' - 2y' + 5y = {fmt(p['A'])} e^{{t}}",
        "solutionLatex": (f"y(t) = e^{{t}}\\left({fmt(C1)} \\cos 2t + {fmt(C2)} \\sin 2t\\right) "
                         f"+ {fmt(Aamp)} e^{{t}}"),
        "characteristicLatex": "m^2 - 2m + 5 = 0",
        "rootsLatex": "m_{1,2} = 1 \\pm 2i",
        "stability": {"label": "Inestable oscilatorio", "tone": "danger",
                      "note": "Parte real positiva (α = 1) ⇒ oscilaciones de amplitud creciente."},
        "metrics": [
            {"label": f"y({tq})", "value": str(_round(y_at, 3))},
            {"label": "Raíces", "value": "1 ± 2i (complejas)"},
            {"label": "Solución particular yₚ", "value": f"{_round(Aamp, 3)} e^t"},
            {"label": "Constantes (C₁, C₂)", "value": f"({_round(C1, 3)}, {_round(C2, 3)})"},
        ],
        "markers": [{"t": tq, "y": y_at, "label": f"y({tq}) = {_round(y_at, 2)}"}],
        "asymptote": None,
    }


# ---------------------------------------------------------------------------
# Custom equation — expression compiler + RK4 via scipy
# ---------------------------------------------------------------------------
_SAFE_NS = {
    "np": np, "math": math,
    "sin": np.sin, "cos": np.cos, "tan": np.tan,
    "exp": np.exp, "log": np.log, "ln": np.log,
    "sqrt": np.sqrt, "abs": np.abs,
    "pi": math.pi, "E": math.e,
}


def compile_expr(expr):
    s = str(expr or "").strip()
    if not s:
        raise ValueError("Expresión vacía")
    s = s.replace("^", "**")
    s = re.sub(r"\bsin\b", "sin", s)
    s = re.sub(r"\bcos\b", "cos", s)
    s = re.sub(r"\btan\b", "tan", s)
    s = re.sub(r"\bexp\b", "exp", s)
    s = re.sub(r"\b(ln|log)\b", "log", s)
    s = re.sub(r"\bsqrt\b", "sqrt", s)
    s = re.sub(r"\babs\b", "abs", s)
    s = re.sub(r"\bpi\b", "pi", s, flags=re.IGNORECASE)
    s = re.sub(r"(^|[^a-zA-Z0-9_.])e(?![a-zA-Z0-9_])", r"\1E", s)
    try:
        code = compile(s, "<expr>", "eval")
    except SyntaxError as err:
        raise ValueError(f"Sintaxis inválida: {err.msg}")

    def f(t, y, yp):
        return eval(code, {"__builtins__": {}}, {**_SAFE_NS, "t": t, "y": y, "yp": yp})
    return f


def expr_to_latex(s):
    r = str(s or "")
    r = r.replace("**", "^")
    r = re.sub(r"\bexp\s*\(([^()]*)\)", r"e^{\1}", r)
    r = re.sub(r"\bsqrt\s*\(([^()]*)\)", r"\\sqrt{\1}", r)
    r = re.sub(r"\babs\s*\(([^()]*)\)", r"\\left|\1\\right|", r)
    r = re.sub(r"\bsin\b", r"\\sin", r)
    r = re.sub(r"\bcos\b", r"\\cos", r)
    r = re.sub(r"\btan\b", r"\\tan", r)
    r = re.sub(r"\b(ln|log)\b", r"\\ln", r)
    r = re.sub(r"\bpi\b", r"\\pi", r, flags=re.IGNORECASE)
    r = re.sub(r"\byp\b", r"y'", r)
    r = r.replace("*", " \\cdot ")
    return r


def rk4_solve(order, f, y0, y0p, t_max, N=700):
    t_eval = np.linspace(0, t_max, N)
    if order == 1:
        def rhs(t, state):
            return [f(t, state[0], 0.0)]
        sol = solve_ivp(rhs, (0, t_max), [y0], method="RK45",
                        t_eval=t_eval, rtol=1e-6, atol=1e-8, dense_output=False)
        ys = sol.y[0]
    else:
        def rhs(t, state):
            return [state[1], f(t, state[0], state[1])]
        sol = solve_ivp(rhs, (0, t_max), [y0, y0p or 0.0], method="RK45",
                        t_eval=t_eval, rtol=1e-6, atol=1e-8, dense_output=False)
        ys = sol.y[0]
    # blow-up guard
    ys = np.where(np.isfinite(ys) & (np.abs(ys) < 1e30), ys, np.nan)
    return t_eval, ys, t_max / (N - 1)


def custom_analyze(p):
    err = None
    ts, ys, h = np.array([]), np.array([]), None
    try:
        f = compile_expr(p["expr"])
        probe = f(0.0, float(p["y0"]), float(p.get("y0p", 0) or 0))
        if not (isinstance(probe, (int, float, np.floating)) or math.isfinite(float(probe))):
            raise ValueError("La expresión no es numérica en t=0")
        ts, ys, h = rk4_solve(int(p["order"]), f, float(p["y0"]),
                              float(p.get("y0p", 0) or 0), float(p["tMax"]))
    except Exception as e:
        err = str(e)

    y_at = float("nan")
    if len(ts):
        idx = min(len(ts) - 1, max(0, round((p["tQuery"] / p["tMax"]) * (len(ts) - 1))))
        y_at = float(ys[idx])

    if err:
        stab = {"label": "Error en expresión", "tone": "danger", "note": err}
    else:
        valid = ys[np.isfinite(ys)]
        y_start = float(ys[0]) if len(ys) else 0.0
        y_end = float(valid[-1]) if len(valid) else float("nan")
        y_max_abs = float(np.max(np.abs(valid))) if len(valid) else 0.0
        diffs = np.diff(ys)
        sign_changes = int(np.sum((diffs[:-1] * diffs[1:] < 0) &
                                  np.isfinite(diffs[:-1]) & np.isfinite(diffs[1:])))
        oscillates = sign_changes > 4

        if not math.isfinite(y_end) or y_max_abs > abs(y_start) * 200 + 1e8:
            stab = ({"label": "Inestable oscilatorio", "tone": "danger",
                     "note": "La solución oscila con amplitud creciente."}
                    if oscillates else
                    {"label": "Inestable", "tone": "danger",
                     "note": "La solución diverge en la ventana observada."})
        elif oscillates:
            quarter = max(1, len(ys) // 4)
            recent = np.max(np.abs(valid[-quarter:])) if len(valid) >= quarter else y_max_abs
            early = np.max(np.abs(valid[:quarter])) if len(valid) >= quarter else y_max_abs
            if recent < early * 0.6:
                stab = {"label": "Subamortiguado", "tone": "stable",
                        "note": "Oscilación amortiguada que tiende al equilibrio."}
            elif recent > early * 1.5:
                stab = {"label": "Inestable oscilatorio", "tone": "danger",
                        "note": "Oscilaciones con amplitud creciente."}
            else:
                stab = {"label": "Oscilatorio acotado", "tone": "warn",
                        "note": "Oscilaciones sin amortiguamiento aparente."}
        elif abs(y_end) > abs(y_start) * 2 + 1:
            stab = {"label": "Crecimiento sostenido", "tone": "warn",
                    "note": "La solución crece monótonamente en la ventana observada."}
        else:
            stab = {"label": "Estable", "tone": "stable",
                    "note": "La solución decae o converge a un valor finito."}

    lhs = "\\dfrac{dy}{dt}" if int(p["order"]) == 1 else "y''"
    eq_latex = f"{lhs} = {expr_to_latex(p['expr'])}"
    sol_latex = (f"\\text{{{err}}}" if err
                 else "\\text{Solución numérica obtenida por Runge-Kutta de 4to orden}")

    last_y = float(ys[-1]) if len(ys) and math.isfinite(float(ys[-1])) else None
    return {
        "ts": ts.tolist(), "ys": [v if math.isfinite(v) else None for v in ys.tolist()],
        "equationLatex": eq_latex,
        "solutionLatex": sol_latex,
        "stability": stab,
        "metrics": [
            {"label": f"y({p['tQuery']})",
             "value": str(round(y_at, 4)) if math.isfinite(y_at) else "—"},
            {"label": f"y({p['tMax']})",
             "value": str(round(last_y, 4)) if last_y is not None else "—"},
            {"label": "Método numérico", "value": "Runge-Kutta 4 (scipy RK45)"},
            {"label": "Paso h", "value": str(round(h, 5)) if h else "—"},
        ],
        "markers": ([{"t": p["tQuery"], "y": y_at,
                      "label": f"y({p['tQuery']}) = {round(y_at, 2)}"}]
                    if len(ts) and math.isfinite(y_at) else []),
        "asymptote": None,
        "error": err,
    }


# ---------------------------------------------------------------------------
# Registry — metadata + analyzer dispatch
# ---------------------------------------------------------------------------
MODELS = [
    {
        "id": "virus", "category": "first",
        "title": "Propagación del Virus Blooper",
        "subtitle": "Crecimiento exponencial · Problema 1",
        "description": "En una carrera de 12 corredores, un objeto especial libera un virus cuya razón de propagación es proporcional al número de infectados.",
        "yLabel": "P(t) — corredores infectados",
        "xLabel": "t (segundos)",
        "params": [
            {"id": "P0", "label": "Población inicial P(0)", "min": 1, "max": 50, "step": 1, "default": 1, "unit": ""},
            {"id": "k", "label": "Tasa de contagio k", "min": 0.05, "max": 1.5, "step": 0.01, "default": math.log(3) / 2, "unit": "1/s", "precision": 4},
            {"id": "tMax", "label": "Tiempo de simulación", "min": 1, "max": 30, "step": 0.5, "default": 6, "unit": "s"},
            {"id": "threshold", "label": "Umbral de alerta", "min": 2, "max": 200, "step": 1, "default": 12, "unit": "infect."},
        ],
        "analyzer": virus_analyze,
    },
    {
        "id": "motor", "category": "first",
        "title": "Enfriamiento del Motor de Bowser",
        "subtitle": "Ley de enfriamiento de Newton · Problema 2",
        "description": "El motor del kart alcanza alta temperatura tras un derrape. Al detenerse, se enfría hacia la temperatura ambiente del entorno.",
        "yLabel": "T(t) — temperatura (°C)",
        "xLabel": "t (minutos)",
        "params": [
            {"id": "T0", "label": "Temperatura inicial T(0)", "min": -50, "max": 200, "step": 1, "default": 100, "unit": "°C"},
            {"id": "Tm", "label": "Temperatura ambiente Tₘ", "min": -50, "max": 50, "step": 1, "default": -10, "unit": "°C"},
            {"id": "k", "label": "Constante k", "min": -2, "max": -0.05, "step": 0.01, "default": math.log(7 / 11), "unit": "1/min", "precision": 4},
            {"id": "tMax", "label": "Tiempo de simulación", "min": 1, "max": 30, "step": 0.5, "default": 10, "unit": "min"},
            {"id": "tQuery", "label": "Consultar T en t =", "min": 0, "max": 30, "step": 0.1, "default": 5, "unit": "min"},
        ],
        "analyzer": motor_analyze,
    },
    {
        "id": "tanque", "category": "first",
        "title": "Limpieza del Tanque de Combustible",
        "subtitle": "Modelo de mezclas · Problema 3",
        "description": "Un tanque contiene combustible contaminado con tinta. Entra combustible puro y la mezcla bien agitada sale al mismo caudal.",
        "yLabel": "A(t) — soluto (kg)",
        "xLabel": "t (minutos)",
        "params": [
            {"id": "A0", "label": "Cantidad inicial A(0)", "min": 0.1, "max": 20, "step": 0.1, "default": 2, "unit": "kg"},
            {"id": "V", "label": "Volumen del tanque V", "min": 1, "max": 100, "step": 1, "default": 10, "unit": "L"},
            {"id": "f", "label": "Caudal f (entrada = salida)", "min": 0.1, "max": 20, "step": 0.1, "default": 3, "unit": "L/min"},
            {"id": "ce", "label": "Concentración entrante cₑ", "min": 0, "max": 5, "step": 0.05, "default": 0, "unit": "kg/L"},
            {"id": "tMax", "label": "Tiempo de simulación", "min": 1, "max": 30, "step": 0.5, "default": 12, "unit": "min"},
            {"id": "tQuery", "label": "Consultar A en t =", "min": 0, "max": 30, "step": 0.1, "default": 4, "unit": "min"},
        ],
        "analyzer": tanque_analyze,
    },
    {
        "id": "rc", "category": "first",
        "title": "Carga del Rayo de Energía (Circuito RC)",
        "subtitle": "Circuito RC en serie · Problema 4",
        "description": "Carga de un capacitor en un circuito RC con fuente de voltaje constante. La carga sigue la respuesta clásica de un sistema de primer orden.",
        "yLabel": "q(t) — carga (C) · i(t) — corriente (A)",
        "xLabel": "t (segundos)",
        "secondaryCurve": True,
        "params": [
            {"id": "R", "label": "Resistencia R", "min": 0.5, "max": 200, "step": 0.5, "default": 10, "unit": "Ω"},
            {"id": "C", "label": "Capacitancia C", "min": 0.001, "max": 1, "step": 0.001, "default": 0.1, "unit": "F"},
            {"id": "E", "label": "Voltaje E", "min": 1, "max": 240, "step": 1, "default": 12, "unit": "V"},
            {"id": "tMax", "label": "Tiempo de simulación", "min": 0.5, "max": 30, "step": 0.1, "default": 6, "unit": "s"},
            {"id": "tQuery", "label": "Consultar q en t =", "min": 0, "max": 30, "step": 0.1, "default": 1, "unit": "s"},
        ],
        "analyzer": rc_analyze,
    },
    {
        "id": "slick", "category": "first",
        "title": "Desgaste de Neumáticos Slick",
        "subtitle": "Vida media y decaimiento · Problema 5",
        "description": "Los neumáticos pierden integridad por fricción a una tasa proporcional a la integridad restante. Se conoce la vida media (número de vueltas para reducirse a la mitad).",
        "yLabel": "N(t) — integridad (%)",
        "xLabel": "Vueltas",
        "params": [
            {"id": "N0", "label": "Integridad inicial N(0)", "min": 10, "max": 100, "step": 1, "default": 100, "unit": "%"},
            {"id": "tHalf", "label": "Vida media t½", "min": 0.5, "max": 20, "step": 0.1, "default": 3, "unit": "vueltas"},
            {"id": "tMax", "label": "Vueltas de simulación", "min": 1, "max": 50, "step": 1, "default": 12, "unit": "vueltas"},
            {"id": "tQuery", "label": "Consultar N en t =", "min": 0, "max": 50, "step": 0.5, "default": 7, "unit": "vueltas"},
        ],
        "analyzer": slick_analyze,
    },
    {
        "id": "cpu", "category": "second",
        "title": "Uso de CPU del Servidor",
        "subtitle": "Sistema inestable · Problema 6",
        "description": "El uso de CPU se modela mediante una EDO lineal homogénea de 2do orden. Las raíces de la ecuación característica determinan si el sistema se estabiliza o diverge.",
        "yLabel": "y(t) — uso de CPU (%)", "xLabel": "t (horas)",
        "params": [
            {"id": "y0", "label": "y(0) — CPU inicial", "min": 0, "max": 100, "step": 1, "default": 40, "unit": "%"},
            {"id": "y0p", "label": "y'(0) — tasa inicial", "min": -50, "max": 50, "step": 1, "default": 10, "unit": "%/h"},
            {"id": "b", "label": "Coeficiente b (de y')", "min": -10, "max": 10, "step": 0.1, "default": -5, "unit": ""},
            {"id": "c", "label": "Coeficiente c (de y)", "min": -10, "max": 20, "step": 0.1, "default": 6, "unit": ""},
            {"id": "tMax", "label": "Tiempo de simulación", "min": 0.1, "max": 5, "step": 0.05, "default": 0.6, "unit": "h"},
            {"id": "tQuery", "label": "Consultar y en t =", "min": 0, "max": 5, "step": 0.01, "default": 0.3, "unit": "h"},
        ],
        "analyzer": cpu_analyze,
    },
    {
        "id": "solicitudes", "category": "second",
        "title": "Solicitudes en una Plataforma",
        "subtitle": "Sobreamortiguado · Problema 7",
        "description": "Cola de solicitudes activas modelada por una EDO de 2do orden. Raíces reales distintas y negativas producen un retorno monótono al equilibrio.",
        "yLabel": "y(t) — solicitudes activas", "xLabel": "t (minutos)",
        "params": [
            {"id": "y0", "label": "y(0) — solicitudes iniciales", "min": 0, "max": 500, "step": 5, "default": 120, "unit": ""},
            {"id": "y0p", "label": "y'(0) — tasa inicial", "min": -100, "max": 100, "step": 1, "default": -15, "unit": "/min"},
            {"id": "b", "label": "Coeficiente b (de y')", "min": 0, "max": 15, "step": 0.1, "default": 7, "unit": ""},
            {"id": "c", "label": "Coeficiente c (de y)", "min": 0, "max": 30, "step": 0.1, "default": 10, "unit": ""},
            {"id": "tMax", "label": "Tiempo de simulación", "min": 0.5, "max": 15, "step": 0.1, "default": 4, "unit": "min"},
            {"id": "tQuery", "label": "Consultar y en t =", "min": 0, "max": 15, "step": 0.05, "default": 1, "unit": "min"},
        ],
        "analyzer": solicitudes_analyze,
    },
    {
        "id": "recuperacion", "category": "second",
        "title": "Recuperación de un Servidor",
        "subtitle": "Críticamente amortiguado · Problema 8",
        "description": "Tras una caída, el servidor restaura recursos. La raíz doble negativa produce el retorno al equilibrio en el menor tiempo posible sin oscilar.",
        "yLabel": "y(t) — recursos disponibles (%)", "xLabel": "t (horas)",
        "params": [
            {"id": "y0", "label": "y(0) — recursos iniciales", "min": 0, "max": 100, "step": 1, "default": 70, "unit": "%"},
            {"id": "y0p", "label": "y'(0) — tasa inicial", "min": -50, "max": 50, "step": 1, "default": 8, "unit": "%/h"},
            {"id": "b", "label": "Coeficiente b (de y')", "min": 0, "max": 15, "step": 0.1, "default": 6, "unit": ""},
            {"id": "c", "label": "Coeficiente c (de y)", "min": 0, "max": 30, "step": 0.1, "default": 9, "unit": ""},
            {"id": "tMax", "label": "Tiempo de simulación", "min": 0.5, "max": 10, "step": 0.1, "default": 3, "unit": "h"},
            {"id": "tQuery", "label": "Consultar y en t =", "min": 0, "max": 10, "step": 0.05, "default": 1, "unit": "h"},
        ],
        "analyzer": recuperacion_analyze,
    },
    {
        "id": "balanceador", "category": "second",
        "title": "Balanceador de Carga",
        "subtitle": "Críticamente amortiguado · Problema 9",
        "description": "Las conexiones de un balanceador se redistribuyen suavemente. La raíz doble negativa produce un decaimiento crítico sin oscilación.",
        "yLabel": "y(t) — conexiones activas", "xLabel": "t (segundos)",
        "params": [
            {"id": "y0", "label": "y(0) — conexiones iniciales", "min": 0, "max": 500, "step": 5, "default": 50, "unit": ""},
            {"id": "y0p", "label": "y'(0) — tasa inicial", "min": -100, "max": 100, "step": 1, "default": -5, "unit": "/s"},
            {"id": "a", "label": "Coeficiente a (de y'')", "min": 0.5, "max": 10, "step": 0.1, "default": 4, "unit": ""},
            {"id": "b", "label": "Coeficiente b (de y')", "min": 0, "max": 30, "step": 0.1, "default": 12, "unit": ""},
            {"id": "c", "label": "Coeficiente c (de y)", "min": 0, "max": 30, "step": 0.1, "default": 9, "unit": ""},
            {"id": "tMax", "label": "Tiempo de simulación", "min": 0.5, "max": 15, "step": 0.1, "default": 6, "unit": "s"},
            {"id": "tQuery", "label": "Consultar y en t =", "min": 0, "max": 15, "step": 0.05, "default": 2, "unit": "s"},
        ],
        "analyzer": balanceador_analyze,
    },
    {
        "id": "paquetes", "category": "second",
        "title": "Flujo de Paquetes en una Red",
        "subtitle": "EDO no homogénea · Problema 10",
        "description": "Red con forzamiento exponencial. La parte real positiva de las raíces complejas amplifica oscilaciones; el término particular añade crecimiento exponencial constante.",
        "yLabel": "y(t) — paquetes", "xLabel": "t (segundos)",
        "secondaryCurve": True,
        "params": [
            {"id": "y0", "label": "y(0) — flujo inicial", "min": 0, "max": 100, "step": 1, "default": 5, "unit": ""},
            {"id": "y0p", "label": "y'(0) — tasa inicial", "min": -50, "max": 100, "step": 1, "default": 5, "unit": "/s"},
            {"id": "A", "label": "Amplitud del forzamiento", "min": 0, "max": 60, "step": 1, "default": 15, "unit": ""},
            {"id": "tMax", "label": "Tiempo de simulación", "min": 0.5, "max": 8, "step": 0.1, "default": 3, "unit": "s"},
            {"id": "tQuery", "label": "Consultar y en t =", "min": 0, "max": 8, "step": 0.05, "default": 1.5, "unit": "s"},
        ],
        "analyzer": paquetes_analyze,
    },
    {
        "id": "custom", "category": "custom", "custom": True,
        "title": "Ecuación Personalizada",
        "subtitle": "Define tu propia EDO",
        "description": "Escribe la EDO que quieras simular. Usa t, y, y' (escrito como yp) y funciones matemáticas estándar. El motor integra numéricamente con Runge-Kutta de 4to orden.",
        "yLabel": "y(t)", "xLabel": "t",
        "defaultState": {
            "order": 2, "expr": "-2*yp - 5*y + 10*sin(2*t)",
            "y0": 0, "y0p": 0, "tMax": 10, "tQuery": 2,
        },
        "params": [],
        "presets": [
            {"label": "Crecimiento exponencial", "order": 1, "expr": "0.5*y", "y0": 1, "y0p": 0, "tMax": 10, "tQuery": 4},
            {"label": "Decaimiento radiactivo", "order": 1, "expr": "-0.3*y", "y0": 100, "y0p": 0, "tMax": 15, "tQuery": 5},
            {"label": "Logístico", "order": 1, "expr": "0.5*y*(1 - y/100)", "y0": 5, "y0p": 0, "tMax": 20, "tQuery": 10},
            {"label": "Oscilador armónico", "order": 2, "expr": "-4*y", "y0": 1, "y0p": 0, "tMax": 8, "tQuery": 2},
            {"label": "Amortiguado forzado", "order": 2, "expr": "-2*yp - 5*y + 10*sin(2*t)", "y0": 0, "y0p": 0, "tMax": 10, "tQuery": 3},
            {"label": "Van der Pol", "order": 2, "expr": "2*(1 - y^2)*yp - y", "y0": 2, "y0p": 0, "tMax": 20, "tQuery": 8},
        ],
        "analyzer": custom_analyze,
    },
]

CATEGORIES = [
    {"id": "first", "label": "Primer Orden · Mario Kart"},
    {"id": "second", "label": "Orden Superior · Software"},
    {"id": "custom", "label": "Ecuación Personalizada"},
]


def get_metadata():
    out = []
    for m in MODELS:
        meta = {k: v for k, v in m.items() if k != "analyzer"}
        out.append(meta)
    return {"categories": CATEGORIES, "models": out}


def simulate(model_id, params):
    model = next((m for m in MODELS if m["id"] == model_id), None)
    if model is None:
        raise KeyError(f"Modelo desconocido: {model_id}")
    result = model["analyzer"](params)
    # ensure JSON-safe (None for NaN)
    if "ys" in result:
        result["ys"] = [None if (isinstance(v, float) and not math.isfinite(v)) else v
                       for v in result["ys"]]
    if "ys2" in result:
        result["ys2"] = [None if (isinstance(v, float) and not math.isfinite(v)) else v
                        for v in result["ys2"]]
    return result
