/* App principal — Ecuaciones (cliente delgado, lógica en Flask) */
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// -----------------------------------------------------------------------------
// MathJax
// -----------------------------------------------------------------------------
function TeX({ tex, display = false, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise([ref.current]).catch(() => {});
    }
  }, [tex, display]);
  const wrapped = display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
  return <span ref={ref} className={className}>{wrapped}</span>;
}

// -----------------------------------------------------------------------------
// Param control
// -----------------------------------------------------------------------------
function ParamControl({ param, value, onChange }) {
  const precision = param.precision != null ? param.precision : (param.step < 0.1 ? 3 : (param.step < 1 ? 2 : 0));
  const display = typeof value === "number" ? Number(value.toFixed(precision)) : value;
  return (
    <div className="param">
      <div className="param-head">
        <span className="param-label">{param.label}</span>
        <span className="param-value">{display}{param.unit ? ` ${param.unit}` : ""}</span>
      </div>
      <div className="param-row">
        <input type="range" min={param.min} max={param.max} step={param.step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))} />
        <input type="number" min={param.min} max={param.max} step={param.step} value={display}
          onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Custom panel (builder de ecuación)
// -----------------------------------------------------------------------------
function CustomPanel({ params, setParam, setParams, model }) {
  const exprRef = useRef(null);
  const insertAtCursor = (text) => {
    const ta = exprRef.current;
    if (!ta) { setParam("expr", (params.expr || "") + text); return; }
    const s = ta.selectionStart || 0;
    const e = ta.selectionEnd || 0;
    const v = params.expr || "";
    setParam("expr", v.slice(0, s) + text + v.slice(e));
    requestAnimationFrame(() => { ta.focus(); const pos = s + text.length; ta.setSelectionRange(pos, pos); });
  };
  const chips = [
    { l: "y", i: "y" }, { l: "y'", i: "yp" }, { l: "t", i: "t" },
    { l: "+", i: " + " }, { l: "−", i: " - " }, { l: "×", i: "*" }, { l: "÷", i: "/" }, { l: "x²", i: "^2" }, { l: "^", i: "^" },
    { l: "(", i: "(" }, { l: ")", i: ")" },
    { l: "sin", i: "sin(" }, { l: "cos", i: "cos(" }, { l: "tan", i: "tan(" },
    { l: "eˣ", i: "exp(" }, { l: "ln", i: "ln(" }, { l: "√", i: "sqrt(" },
    { l: "π", i: "pi" }, { l: "e", i: "e" }, { l: "|x|", i: "abs(" },
  ];
  return (
    <>
      <div className="section-label">Orden de la EDO</div>
      <div className="seg">
        <button className={"seg-btn" + (params.order === 1 ? " active" : "")} onClick={() => setParam("order", 1)}>1er orden</button>
        <button className={"seg-btn" + (params.order === 2 ? " active" : "")} onClick={() => setParam("order", 2)}>2do orden</button>
      </div>
      <div className="section-label">Ecuación diferencial</div>
      <div className="eq-builder">
        <div className="eq-lhs">{params.order === 1 ? "dy/dt =" : "y'' ="}</div>
        <textarea ref={exprRef} className="expr-input" value={params.expr}
          onChange={(e) => setParam("expr", e.target.value)}
          placeholder={params.order === 1 ? "ej. 0.5*y" : "ej. -2*yp - 5*y + sin(t)"} rows={2} spellCheck={false} />
      </div>
      <div className="chips">
        {chips.map((c) => (
          <button key={c.l} className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insertAtCursor(c.i)}>{c.l}</button>
        ))}
        <button className="chip chip-danger" onMouseDown={(e) => e.preventDefault()} onClick={() => setParam("expr", "")}>Limpiar</button>
      </div>
      <div className="hint">
        Variables: <code>t</code>, <code>y</code>, y la derivada como <code>yp</code>. Funciones:
        <code> sin</code>, <code>cos</code>, <code>tan</code>, <code>exp</code>, <code>ln</code>, <code>sqrt</code>, <code>abs</code>.
        Constantes: <code>pi</code>, <code>e</code>. Potencia con <code>^</code>.
      </div>
      <div className="section-label">Ejemplos rápidos</div>
      <div className="presets">
        {(model.presets || []).map((p) => (
          <button key={p.label} className="preset" onClick={() => setParams({
            order: p.order, expr: p.expr, y0: p.y0, y0p: p.y0p || 0, tMax: p.tMax, tQuery: p.tQuery,
          })}>{p.label}</button>
        ))}
      </div>
      <div className="section-label">Condiciones iniciales</div>
      <ParamControl param={{ id: "y0", label: "y(0)", min: -1000, max: 1000, step: 0.1, default: 1, precision: 3 }} value={params.y0} onChange={(v) => setParam("y0", v)} />
      {params.order === 2 && (
        <ParamControl param={{ id: "y0p", label: "y'(0)", min: -1000, max: 1000, step: 0.1, default: 0, precision: 3 }} value={params.y0p} onChange={(v) => setParam("y0p", v)} />
      )}
      <div className="section-label">Ventana temporal</div>
      <ParamControl param={{ id: "tMax", label: "Tiempo de simulación", min: 0.5, max: 50, step: 0.1, default: 10, unit: "t", precision: 2 }} value={params.tMax} onChange={(v) => setParam("tMax", v)} />
      <ParamControl param={{ id: "tQuery", label: "Consultar y en t =", min: 0, max: params.tMax, step: 0.05, default: 2, unit: "t", precision: 2 }} value={Math.min(params.tQuery, params.tMax)} onChange={(v) => setParam("tQuery", v)} />
    </>
  );
}

// -----------------------------------------------------------------------------
// Sidebar
// -----------------------------------------------------------------------------
function Sidebar({ categories, models, categoryId, setCategoryId, modelId, setModelId, params, setParam, setParams, onReset, currentModel }) {
  const filtered = models.filter((m) => m.category === categoryId);
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"></div>
        <div className="brand-name">Ecuaciones</div>
        <div className="brand-sub">v1.0 · Flask</div>
      </div>
      <div className="section-label">Categoría</div>
      <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <div className="section-label">Problema</div>
      <select className="select" value={modelId} onChange={(e) => setModelId(e.target.value)}>
        {filtered.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
      </select>
      {currentModel.custom ? (
        <CustomPanel params={params} setParam={setParam} setParams={setParams} model={currentModel} />
      ) : (
        <>
          <div className="section-label">Parámetros</div>
          {currentModel.params.map((p) => (
            <ParamControl key={p.id} param={p} value={params[p.id]} onChange={(v) => setParam(p.id, v)} />
          ))}
        </>
      )}
      <button className="reset-btn" onClick={onReset}>Restablecer valores</button>
    </aside>
  );
}

// -----------------------------------------------------------------------------
// Plot — usa ts/ys del backend
// -----------------------------------------------------------------------------
function Plot({ model, analysis }) {
  const ref = useRef(null);
  const data = useMemo(() => {
    if (!analysis || !analysis.ts) return [];
    const ts = analysis.ts;
    const ys = analysis.ys;
    const tMax = ts[ts.length - 1] || 1;
    const traces = [{
      x: ts, y: ys, mode: "lines",
      name: (model.yLabel || "y").split("—")[0].trim() || "y(t)",
      line: { color: "#1a1a1a", width: 2 },
      hovertemplate: "t = %{x:.3f}<br>y = %{y:.4f}<extra></extra>",
    }];
    if (analysis.ys2) {
      traces.push({
        x: ts, y: analysis.ys2, mode: "lines",
        name: analysis.secondaryLabel || "secundaria",
        line: { color: "oklch(0.45 0.08 250)", width: 1.5, dash: "dot" },
        hovertemplate: "t = %{x:.3f}<br>= %{y:.4f}<extra></extra>",
      });
    }
    if (analysis.asymptote != null && isFinite(analysis.asymptote)) {
      traces.push({
        x: [0, tMax], y: [analysis.asymptote, analysis.asymptote], mode: "lines",
        name: `asíntota = ${Number(analysis.asymptote.toFixed(3))}`,
        line: { color: "#8a8884", width: 1, dash: "dash" }, hoverinfo: "skip",
      });
    }
    if (analysis.markers && analysis.markers.length) {
      const vm = analysis.markers.filter((m) => m.t >= 0 && m.t <= tMax && isFinite(m.y));
      if (vm.length) {
        traces.push({
          x: vm.map((m) => m.t), y: vm.map((m) => m.y),
          mode: "markers+text", name: "consulta",
          marker: { color: "oklch(0.50 0.12 25)", size: 9, symbol: "circle" },
          text: vm.map((m) => m.label), textposition: "top right",
          textfont: { family: "JetBrains Mono, monospace", size: 11, color: "#1a1a1a" },
          hoverinfo: "skip",
        });
      }
    }
    return traces;
  }, [model, analysis]);

  const layout = useMemo(() => ({
    margin: { l: 64, r: 28, t: 16, b: 56 },
    paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff",
    font: { family: "Helvetica Neue, Helvetica, Arial, sans-serif", size: 12, color: "#1a1a1a" },
    xaxis: {
      title: { text: model.xLabel, font: { size: 12, color: "#4a4a48" }, standoff: 12 },
      gridcolor: "#eee8de", zerolinecolor: "#d4cfc5", linecolor: "#d4cfc5",
      ticks: "outside", tickcolor: "#d4cfc5", ticklen: 4,
      tickfont: { family: "JetBrains Mono, monospace", size: 10, color: "#8a8884" },
    },
    yaxis: {
      title: { text: model.yLabel, font: { size: 12, color: "#4a4a48" }, standoff: 12 },
      gridcolor: "#eee8de", zerolinecolor: "#d4cfc5", linecolor: "#d4cfc5",
      ticks: "outside", tickcolor: "#d4cfc5", ticklen: 4,
      tickfont: { family: "JetBrains Mono, monospace", size: 10, color: "#8a8884" },
    },
    legend: { orientation: "h", x: 0, y: 1.08, bgcolor: "rgba(0,0,0,0)",
      font: { size: 11, family: "Helvetica Neue, sans-serif", color: "#4a4a48" } },
    hoverlabel: { bgcolor: "#1a1a1a", bordercolor: "#1a1a1a",
      font: { family: "JetBrains Mono, monospace", size: 11, color: "#ffffff" } },
    showlegend: true,
  }), [model]);

  useEffect(() => {
    if (!ref.current) return;
    window.Plotly.react(ref.current, data, layout, { displayModeBar: false, responsive: true });
  }, [data, layout]);

  useEffect(() => {
    const handle = () => { if (ref.current) window.Plotly.Plots.resize(ref.current); };
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);

  return <div className="plot-card"><div ref={ref} className="plot-host"></div></div>;
}

// -----------------------------------------------------------------------------
// Main panel
// -----------------------------------------------------------------------------
function MainPanel({ model, analysis }) {
  const isSecondOrder = model.category === "second";
  if (!analysis) {
    return (
      <main className="main">
        <div className="crumb">Cargando…</div>
        <h1 className="title">{model.title}</h1>
        <p className="description">{model.description}</p>
      </main>
    );
  }
  return (
    <main className="main">
      <div className="crumb">
        {model.category === "first" ? "Parte I · Primer Orden"
          : model.category === "second" ? "Parte II · Orden Superior"
          : "Parte III · Personalizada"}
        {" · "}{model.subtitle}
      </div>
      <h1 className="title">{model.title}</h1>
      <p className="description">{model.description}</p>

      <div className="eq-block">
        <div className="eq-block-header">
          <span className="eq-block-title">Modelo matemático</span>
          <span className={`badge ${analysis.stability.tone}`}>
            <span className="dot"></span>{analysis.stability.label}
          </span>
        </div>
        <div className="eq-display"><TeX tex={analysis.equationLatex} display={true} /></div>
        <div style={{ marginTop: 14 }}>
          <div className="aux-block-label">Solución (condiciones iniciales aplicadas)</div>
          <div className="aux-eq"><TeX tex={analysis.solutionLatex} display={false} /></div>
        </div>
      </div>

      <Plot model={model} analysis={analysis} />

      <div className={isSecondOrder ? "grid-3" : "grid-2"}>
        <div className="card">
          <h3 className="card-title">Predicción numérica</h3>
          {analysis.metrics.map((m, i) => (
            <div className="kv-row" key={i}>
              <span className="kv-key">{m.label}</span>
              <span className="kv-value">{m.value}</span>
            </div>
          ))}
        </div>
        {isSecondOrder && analysis.characteristicLatex && (
          <div className="card">
            <h3 className="card-title">Ecuación característica</h3>
            <div className="aux-block">
              <div className="aux-block-label">Ecuación auxiliar</div>
              <div className="aux-eq"><TeX tex={analysis.characteristicLatex} display={false} /></div>
            </div>
            <div className="aux-block">
              <div className="aux-block-label">Raíces</div>
              <div className="aux-eq"><TeX tex={analysis.rootsLatex} display={false} /></div>
            </div>
          </div>
        )}
        <div className="card">
          <h3 className="card-title">Diagnóstico de estabilidad</h3>
          <span className={`badge ${analysis.stability.tone}`}>
            <span className="dot"></span>{analysis.stability.label}
          </span>
          <p className="stability-note">{analysis.stability.note}</p>
        </div>
      </div>

      <div className="footer">
        <span>Ecuaciones Diferenciales · Ingeniería de Software</span>
        <span>Universidad Cooperativa de Colombia · Mayo 2026</span>
      </div>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Defaults helper
// -----------------------------------------------------------------------------
function defaultParams(model) {
  if (model.custom && model.defaultState) return { ...model.defaultState };
  const p = {};
  (model.params || []).forEach((par) => { p[par.id] = par.default; });
  return p;
}

// -----------------------------------------------------------------------------
// App — fetch metadata + simulate via API
// -----------------------------------------------------------------------------
function App() {
  const [meta, setMeta] = useState(null);
  const [categoryId, setCategoryId] = useState("first");
  const [modelId, setModelId] = useState(null);
  const [allParams, setAllParams] = useState({});
  const [analysis, setAnalysis] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    fetch("/api/metadata").then((r) => r.json()).then((data) => {
      setMeta(data);
      const initParams = {};
      data.models.forEach((m) => { initParams[m.id] = defaultParams(m); });
      setAllParams(initParams);
      setModelId(data.models[0].id);
    });
  }, []);

  const currentModel = useMemo(
    () => meta ? (meta.models.find((m) => m.id === modelId) || meta.models[0]) : null,
    [meta, modelId]
  );
  const params = currentModel ? allParams[currentModel.id] : null;

  const setParam = useCallback((key, value) => {
    setAllParams((prev) => ({ ...prev, [currentModel.id]: { ...prev[currentModel.id], [key]: value } }));
  }, [currentModel]);

  const setParams = useCallback((patch) => {
    setAllParams((prev) => ({ ...prev, [currentModel.id]: { ...prev[currentModel.id], ...patch } }));
  }, [currentModel]);

  const resetParams = useCallback(() => {
    setAllParams((prev) => ({ ...prev, [currentModel.id]: defaultParams(currentModel) }));
  }, [currentModel]);

  useEffect(() => {
    if (!meta) return;
    const inCat = meta.models.filter((m) => m.category === categoryId);
    if (!inCat.find((m) => m.id === modelId)) setModelId(inCat[0].id);
  }, [categoryId, meta]);

  useEffect(() => {
    if (!currentModel || !params) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: currentModel.id, params }),
      })
        .then((r) => r.json())
        .then((res) => setAnalysis(res))
        .catch((e) => setAnalysis({
          ts: [], ys: [],
          equationLatex: "", solutionLatex: `\\text{Error: ${e.message}}`,
          stability: { label: "Error", tone: "danger", note: e.message },
          metrics: [], markers: [], asymptote: null,
        }));
    }, 120);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [currentModel, params]);

  if (!meta || !currentModel || !params) {
    return (
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark"></div>
            <div className="brand-name">Ecuaciones</div>
          </div>
        </aside>
        <main className="main"><div className="crumb">Cargando…</div></main>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar categories={meta.categories} models={meta.models}
        categoryId={categoryId} setCategoryId={setCategoryId}
        modelId={modelId} setModelId={setModelId}
        params={params} setParam={setParam} setParams={setParams}
        onReset={resetParams} currentModel={currentModel} />
      <MainPanel model={currentModel} analysis={analysis} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
