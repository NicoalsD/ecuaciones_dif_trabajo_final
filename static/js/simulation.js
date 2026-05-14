/* ════════════════════════════════════════════════════════════════════
   EDO-LIVE / BLOOPER-SIM  ·  Cliente
   --------------------------------------------------------------------
   Coreografia visual de las dos EDO del trabajo final.

   - El backend Flask es la unica fuente de verdad matematica.
     Cada ~50 ms (20 Hz) consultamos /api/virus?t=X  o  /api/cpu?t=X
     y refrescamos todos los indicadores con los valores devueltos.
   - El render visual (canvas, particulas, escala de LEDs, etc.) corre
     a 60 fps via requestAnimationFrame y usa la ultima respuesta como
     estado autoritativo.
   ════════════════════════════════════════════════════════════════════ */
'use strict';

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const fmt   = (x, n = 3)  => Number(x).toFixed(n);

function pad(x, n) {
    const s = '' + x;
    return s.length >= n ? s : '0'.repeat(n - s.length) + s;
}

function nowTimeStr() {
    const d = new Date();
    return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
}


// ════════════════════════════════════════════════════════════════════
//   CONSOLA virtual
// ════════════════════════════════════════════════════════════════════
class ConsoleLog {
    constructor(el, max = 80) {
        this.el = el;
        this.max = max;
    }
    push(msg, level = 'info') {
        const line = document.createElement('span');
        line.className = 'console-line';
        line.innerHTML = `<span class="ts">[${nowTimeStr()}]</span><span class="lvl-${level}">${msg}</span>`;
        this.el.appendChild(line);
        while (this.el.children.length > this.max) this.el.removeChild(this.el.firstChild);
        this.el.scrollTop = this.el.scrollHeight;
    }
    clear() { this.el.innerHTML = ''; }
}


// ════════════════════════════════════════════════════════════════════
//   GRAFICA · canvas line chart con cursor
// ════════════════════════════════════════════════════════════════════
class CurveChart {
    constructor(canvas, opts) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.points = [];
        this.seriesList = [];        // [{points, color, glow, dash, label}, ...]
        this.markers = [];           // [{t, y, color, label, shape}]
        this.tUnit = opts.tUnit || 's';
        this.tMax = opts.tMax || 1;
        this.yMin = opts.yMin || 0;
        this.yMax = opts.yMax || 1;
        this.color = opts.color || '#00ffaa';
        this.glow  = opts.glow  || 'rgba(0,255,170,0.55)';
        this.gridColor = opts.gridColor || 'rgba(120,140,220,0.15)';
        this.dpr = window.devicePixelRatio || 1;
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }
    resize() {
        const r = this.canvas.getBoundingClientRect();
        if (r.width < 2) return;
        this.canvas.width  = r.width  * this.dpr;
        this.canvas.height = r.height * this.dpr;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.w = r.width;
        this.h = r.height;
    }
    setSeries(points) { this.points = points; }
    setSeriesList(list) { this.seriesList = list || []; }
    setMarkers(list) { this.markers = list || []; }
    setRange(tMax, yMin, yMax) { this.tMax = tMax; this.yMin = yMin; this.yMax = yMax; }
    setRefLines(lines) { this.refLines = lines || []; }
    setTUnit(u) { this.tUnit = u || 's'; }
    draw(cursorT, cursorY) {
        const { ctx, w, h, points, tMax, yMin, yMax, color, glow, gridColor } = this;
        if (!w || !h) return;
        ctx.clearRect(0, 0, w, h);

        const padLeft = 44;
        const padRight = 12;
        const padTop = 6;
        const padBottom = 22;
        const plotW = w - padLeft - padRight;
        const plotH = h - padTop - padBottom;

        const xOf = t => padLeft + (t / tMax) * plotW;
        const yOf = v => padTop + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

        // formato compacto para etiquetas (k = miles para magnitudes grandes)
        const fmtY = v => {
            const a = Math.abs(v);
            if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
            if (a >= 10)   return Math.round(v).toString();
            if (a >= 1)    return v.toFixed(1);
            if (a < 1e-6)  return '0';
            return v.toFixed(2);
        };

        // grid y + etiquetas
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(220,230,255,0.78)';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const ySteps = 4;
        for (let i = 0; i <= ySteps; i++) {
            const val = yMin + (i / ySteps) * (yMax - yMin);
            const yPos = yOf(val);
            ctx.beginPath(); ctx.moveTo(padLeft, yPos); ctx.lineTo(padLeft + plotW, yPos); ctx.stroke();
            ctx.fillText(fmtY(val), padLeft - 4, yPos);
        }

        // grid x + etiquetas
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const xSteps = 6;
        const unit = this.tUnit || 's';
        for (let i = 0; i <= xSteps; i++) {
            const val = (i / xSteps) * tMax;
            const xPos = xOf(val);
            ctx.beginPath(); ctx.moveTo(xPos, padTop); ctx.lineTo(xPos, padTop + plotH); ctx.stroke();
            ctx.fillText(val.toFixed(2) + unit, xPos, padTop + plotH + 4);
        }

        // eje cero (si yMin < 0 < yMax)
        if (yMin < 0 && yMax > 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 1;
            const y0 = yOf(0);
            ctx.beginPath(); ctx.moveTo(padLeft, y0); ctx.lineTo(padLeft + plotW, y0); ctx.stroke();
        }

        // lineas de referencia (umbrales)
        if (this.refLines && this.refLines.length) {
            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (const ref of this.refLines) {
                if (ref.value < yMin || ref.value > yMax) continue;
                ctx.strokeStyle = ref.color || 'rgba(255,80,80,0.55)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                const ry = yOf(ref.value);
                ctx.beginPath(); ctx.moveTo(padLeft, ry); ctx.lineTo(padLeft + plotW, ry); ctx.stroke();
                ctx.setLineDash([]);
                if (ref.label) {
                    ctx.fillStyle = ref.color || 'rgba(255,120,120,0.95)';
                    ctx.fillText(ref.label, padLeft + 4, ry - 8);
                }
            }
        }

        // recorte al area de plot para evitar trazos fuera del marco
        ctx.save();
        ctx.beginPath();
        ctx.rect(padLeft, padTop, plotW, plotH);
        ctx.clip();

        // serie principal (compatibilidad con setSeries)
        if (points.length) {
            ctx.shadowColor = glow;
            ctx.shadowBlur = 12;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < points.length; i++) {
                const p = points[i];
                if (p.t > tMax) break;
                const x = xOf(p.t);
                const y = yOf(p.y);
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // series secundarias (multi-curve)
        for (const s of (this.seriesList || [])) {
            if (!s.points || !s.points.length) continue;
            ctx.shadowColor = s.glow || 'rgba(0,0,0,0)';
            ctx.shadowBlur = s.glow ? 10 : 0;
            ctx.strokeStyle = s.color || '#888';
            ctx.lineWidth = s.lineWidth || 1.6;
            ctx.setLineDash(s.dash || []);
            ctx.beginPath();
            let started2 = false;
            for (let i = 0; i < s.points.length; i++) {
                const p = s.points[i];
                if (p.t > tMax) break;
                const x = xOf(p.t);
                const yv = yOf(p.y);
                if (!started2) { ctx.moveTo(x, yv); started2 = true; }
                else ctx.lineTo(x, yv);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
        }

        // markers estaticos (cruce por cero, condicion inicial, etc.)
        for (const m of (this.markers || [])) {
            if (m.t < 0 || m.t > tMax) continue;
            if (m.y < yMin || m.y > yMax) continue;
            const mx = xOf(m.t);
            const my = yOf(m.y);
            ctx.fillStyle = m.color || '#fff';
            ctx.strokeStyle = m.color || '#fff';
            ctx.shadowColor = m.glow || (m.color || 'rgba(255,255,255,0.6)');
            ctx.shadowBlur = 10;
            ctx.lineWidth = 1.5;
            if (m.shape === 'square') {
                const sz = 5;
                ctx.fillRect(mx - sz, my - sz, sz * 2, sz * 2);
            } else {
                ctx.beginPath();
                ctx.arc(mx, my, 4, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;
            if (m.label) {
                ctx.font = '9px "JetBrains Mono", monospace';
                ctx.textAlign = m.labelAlign || 'left';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = m.color || '#fff';
                const lx = mx + (m.labelAlign === 'right' ? -8 : 8);
                const ly = my + (m.labelDy || -10);
                ctx.fillText(m.label, lx, ly);
            }
        }
        ctx.restore();

        if (cursorT !== undefined && cursorT >= 0 && cursorT <= tMax) {
            const cx = xOf(cursorT);
            ctx.strokeStyle = 'rgba(255,255,255,0.28)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(cx, padTop); ctx.lineTo(cx, padTop + plotH); ctx.stroke();
            if (cursorY !== undefined) {
                const cy = yOf(cursorY);
                ctx.fillStyle = color;
                ctx.shadowColor = glow;
                ctx.shadowBlur = 12;
                ctx.beginPath();
                ctx.arc(cx, cy, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;

                // tag con valor actual
                ctx.font = '10px "JetBrains Mono", monospace';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                const tag = fmtY(cursorY);
                const tw = ctx.measureText(tag).width + 8;
                let tagX = cx + 8;
                if (tagX + tw > padLeft + plotW) tagX = cx - 8 - tw;
                ctx.fillStyle = 'rgba(10,14,28,0.85)';
                ctx.fillRect(tagX, cy - 8, tw, 16);
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.strokeRect(tagX, cy - 8, tw, 16);
                ctx.fillStyle = color;
                ctx.fillText(tag, tagX + 4, cy);
            }
        }
    }
}


// ════════════════════════════════════════════════════════════════════
//   SIMULACION BASE
// ════════════════════════════════════════════════════════════════════
class Simulation {
    constructor() {
        this.t = 0;
        this.speed = 1;
        this.running = false;
        this.finished = false;
        this.lastWall = 0;
        this.lastFetch = 0;
        this.fetchEveryMs = 50;
        this.latestState = null;
        this.animTime = 0;
        this.pendingFetch = false;
        this.active = false;  // solo pollea si es la simulacion activa
    }
    play() {
        if (this.finished) this.reset();
        this.running = true;
        this.lastWall = performance.now();
    }
    pause() { this.running = false; }
    reset() {
        this.t = 0;
        this.running = false;
        this.finished = false;
        this.latestState = null;
    }
    setSpeed(v) { this.speed = v; }

    step(wallNow) {
        const dt = (wallNow - this.lastWall) / 1000;
        this.lastWall = wallNow;
        if (this.running && !this.finished) {
            this.t += dt * this.speed;
            this.onTimeAdvance();
        }
        this.animTime += dt;

        /* Solo pollea si esta activa y corriendo (o al menos visible) */
        if (this.active && !this.finished &&
            wallNow - this.lastFetch >= this.fetchEveryMs && !this.pendingFetch) {
            this.lastFetch = wallNow;
            this.fetchState();
        }
        if (this.active) this.render(this.animTime);
    }

    async fetchState() {
        this.pendingFetch = true;
        try {
            const r = await fetch(this.apiUrl + '?t=' + encodeURIComponent(this.t.toFixed(4)));
            if (r.ok) {
                const data = await r.json();
                this.latestState = data;
                this.applyState(data);
            }
        } catch (e) {
            // localhost · errores transitorios ignorados
        } finally {
            this.pendingFetch = false;
        }
    }

    onTimeAdvance() {}
    applyState(data) {}
    render(animTime) {}
}


// ════════════════════════════════════════════════════════════════════
//   VIRUS · Blooper Grand Prix
// ════════════════════════════════════════════════════════════════════
class VirusSim extends Simulation {
    constructor() {
        super();
        this.apiUrl = '/api/virus';
        this.totalRacers = 12;
        this.tEnd = 4.5237;                       // 2 ln(12) / ln(3)
        this.k = Math.log(3) / 2;

        this.kartColors = [
            '#ffd23f', '#ff6b35', '#ff4d8b', '#a07cff',
            '#54e6ff', '#3effb7', '#f7c948', '#ff7676',
            '#ff9bcb', '#76d6ff', '#9fe870', '#ffb35a',
        ];

        this.canvas = $('#race-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;

        this.karts = [];
        this.particles = [];
        this.lastAnnouncedCount = 0;
        this.schedule = [];

        this.chart = new CurveChart($('#virus-chart'), {
            tMax: this.tEnd,
            yMin: 0, yMax: this.totalRacers,
            color: '#00ffaa',
            glow:  'rgba(0,255,170,0.55)',
        });
        this.console = new ConsoleLog($('#v-console'));

        this.elements = {
            chip: $('#v-chip'),
            pnum: $('#v-pnum'),
            bar:  $('#v-bar'),
            count:$('#v-count'),
            rate: $('#v-rate'),
            hudP: $('#hud-p'),
            hudT: $('#hud-t'),
            hudI: $('#hud-infected'),
            timePill: $('#time-pill'),
            statusPill: $('#status-pill'),
            statusText: $('#status-text'),
            finishOverlay: $('#race-finish-overlay'),
            finishTime: $('#finish-time-val'),
            raceTag: $('#v-race-tag'),
        };

        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.initKarts();
    }

    resizeCanvas() {
        const r = this.canvas.getBoundingClientRect();
        if (r.width < 2) return;
        this.canvas.width  = r.width  * this.dpr;
        this.canvas.height = r.height * this.dpr;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.viewW = r.width;
        this.viewH = r.height;
    }

    /* El orden de infeccion es 1..12 segun la EDO. Para que la propagacion
       luzca contagiosa, asignamos cada nuevo n a un slot adyacente al
       anterior. La asignacion es ESTATICA y deterministica. */
    initKarts() {
        this.karts = [];
        const order = [0, 1, 11, 2, 10, 3, 9, 4, 8, 5, 7, 6];
        for (let n = 1; n <= this.totalRacers; n++) {
            const slot = order[n - 1];
            this.karts.push({
                n,
                slot,
                color: this.kartColors[(n - 1) % this.kartColors.length],
                infected: false,
                infectedAt: -1,
                phaseOffset: 0,     // compensa cambio de omega para evitar salto angular
                shakeUntil: 0,
                _x: 0, _y: 0, _ang: 0,
            });
        }
        // paciente cero
        this.karts[0].infected = true;
        this.karts[0].infectedAt = 0;
    }

    reset() {
        super.reset();
        this.particles = [];
        this.lastAnnouncedCount = 1;
        this.initKarts();
        $$('.schedule-item').forEach(it => it.classList.remove('hit'));
        const first = $$('.schedule-item')[0];
        if (first) first.classList.add('hit');
        this.elements.finishOverlay.classList.remove('show');
        this.elements.statusPill.classList.remove('running');
        this.elements.statusText.textContent = 'EN ESPERA';
        this.console.clear();
        this.console.push('sistema iniciado · vector blooper en cuarentena', 'info');
        this.console.push('P(0) = 1 · paciente cero detectado en KART-01', 'info');
        this.applyState({ ok: true, t: 0, P: 1, dPdt: this.k, infected: 1, total: 12 });
    }

    play() {
        super.play();
        this.elements.statusPill.classList.add('running');
        this.elements.statusText.textContent = 'CONTAGIO ACTIVO';
        this.console.push('propagacion iniciada · dP/dt = k·P · k = ln(3)/2', 'warn');
    }

    pause() {
        super.pause();
        this.elements.statusPill.classList.remove('running');
        this.elements.statusText.textContent = 'PAUSA';
        this.console.push('simulacion pausada', 'info');
    }

    onTimeAdvance() {
        if (this.t >= this.tEnd && !this.finished) {
            this.t = this.tEnd;
            this.finished = true;
            this.running = false;
            /* Forzar infeccion de TODOS los restantes */
            for (let n = 1; n <= this.totalRacers; n++) {
                this.infectKart(n);
            }
            this.lastAnnouncedCount = this.totalRacers;
            this.elements.pnum.textContent = fmt(this.totalRacers, 3);
            this.elements.bar.style.width = '100%';
            this.elements.count.textContent = `${this.totalRacers} / ${this.totalRacers}`;
            this.elements.hudI.textContent = `${this.totalRacers} / ${this.totalRacers}`;
            this.elements.statusPill.classList.remove('running');
            this.elements.statusText.textContent = 'RED COMPROMETIDA';
            this.elements.finishOverlay.classList.add('show');
            this.elements.finishTime.textContent = fmt(this.tEnd, 3);
            this.console.push('!! alerta !! · 12 / 12 jugadores infectados', 'crit');
            this.console.push('cierre del circuito · partida arruinada', 'crit');
        }
    }

    loadSchedule(sched) {
        this.schedule = sched.schedule;
        const ul = $('#v-schedule');
        ul.innerHTML = '';
        sched.schedule.forEach(s => {
            const li = document.createElement('li');
            li.className = 'schedule-item';
            li.dataset.racer = s.racer;
            li.innerHTML = `
                <span class="schedule-num">${pad(s.racer, 2)}</span>
                <span class="schedule-label">KART-${pad(s.racer, 2)}</span>
                <span class="schedule-time">${fmt(s.t, 3)} s</span>
            `;
            ul.appendChild(li);
        });
        ul.children[0].classList.add('hit');
    }

    async preload() {
        try {
            const [scheduleR, seriesR] = await Promise.all([
                fetch('/api/virus/schedule').then(r => r.json()),
                fetch('/api/virus/series?n=240&t_end=' + this.tEnd).then(r => r.json()),
            ]);
            this.loadSchedule(scheduleR);
            this.chart.setSeries(seriesR.points.map(p => ({ t: p.t, y: p.P })));
        } catch (e) {
            console.error('virus preload failed', e);
        }
    }

    applyState(data) {
        if (!data || !data.ok) return;
        const { P, dPdt, infected, total } = data;

        this.elements.pnum.textContent = fmt(P, 3);
        this.elements.bar.style.width = clamp(P / total * 100, 0, 100) + '%';
        this.elements.count.textContent = `${infected} / ${total}`;
        this.elements.rate.textContent = fmt(dPdt, 2);
        this.elements.hudP.textContent = fmt(P, 3);
        this.elements.hudI.textContent = `${infected} / ${total}`;
        this.elements.hudT.textContent = fmt(this.t, 3) + ' s';
        this.elements.timePill.textContent = 't = ' + fmt(this.t, 3) + ' s';
        this.elements.raceTag.textContent = 'VUELTA ' + (Math.floor(this.animTime / 8) + 1);

        const chip = this.elements.chip;
        chip.classList.remove('warn', 'crit');
        if (infected <= 3) { chip.textContent = 'CALMA'; }
        else if (infected <= 8) { chip.textContent = 'BROTE'; chip.classList.add('warn'); }
        else { chip.textContent = 'PANDEMIA'; chip.classList.add('crit'); }

        // infectar karts en orden 1..n
        for (let n = this.lastAnnouncedCount + 1; n <= infected && n <= this.totalRacers; n++) {
            this.infectKart(n);
        }
        this.lastAnnouncedCount = Math.max(this.lastAnnouncedCount, infected);
    }

    infectKart(n) {
        const k = this.karts[n - 1];
        if (!k || k.infected) return;

        /* Compensar el cambio de omega para que el angulo NO salte.
         * Sano: ang = phase + animTime * omegaBase
         * Infectado: ang = phase + offset + animTime * omegaBase * 0.55
         * Igualar ambos en el instante de infeccion → offset = animTime * omegaBase * 0.45 */
        const omegaBase = 2 * Math.PI / 8;
        k.phaseOffset = this.animTime * omegaBase * 0.45;

        k.infected = true;
        k.infectedAt = this.t;
        k.shakeUntil = this.animTime + 0.6;
        for (let i = 0; i < 22; i++) {
            this.particles.push({
                x: k._x || this.viewW / 2,
                y: k._y || this.viewH / 2,
                vx: (Math.random() - 0.5) * 140,
                vy: (Math.random() - 0.5) * 140 - 40,
                life: 1.0,
                size: 3 + Math.random() * 4,
                burst: true,
            });
        }
        const t = this.schedule[n - 1] ? this.schedule[n - 1].t : this.t;
        this.console.push(`KART-${pad(n, 2)} contagiado · t = ${fmt(t, 3)} s`, n >= 9 ? 'crit' : 'warn');

        const li = $$('.schedule-item').find(el => +el.dataset.racer === n);
        if (li) li.classList.add('hit');
    }

    render(animTime) {
        const { ctx, viewW: W, viewH: H } = this;
        if (!W || !H) return;
        ctx.clearRect(0, 0, W, H);
        this.drawTrack(W, H);
        this.updateKarts(animTime, W, H);
        this.updateParticles();
        const Pnow = this.latestState ? this.latestState.P : 1;
        this.chart.draw(this.t, Pnow);
    }

    drawTrack(W, H) {
        const ctx = this.ctx;
        const cx = W / 2, cy = H / 2 + 10;
        const rxO = W * 0.42, ryO = H * 0.38;
        const rxI = W * 0.22, ryI = H * 0.16;

        ctx.fillStyle = '#070a16';
        ctx.fillRect(0, 0, W, H);

        // grass interior
        ctx.fillStyle = '#0e2030';
        ctx.beginPath();
        ctx.ellipse(cx, cy, rxI, ryI, 0, 0, Math.PI * 2);
        ctx.fill();

        // asfalto (anillo)
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rxO, ryO, 0, 0, Math.PI * 2);
        ctx.ellipse(cx, cy, rxI, ryI, 0, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fillStyle = '#1a1d2c';
        ctx.fill();
        ctx.restore();

        // bordes
        ctx.strokeStyle = '#54e6ff';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(84,230,255,0.45)';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rxO, ryO, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = 'rgba(84,230,255,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rxI, ryI, 0, 0, Math.PI * 2);
        ctx.stroke();

        // linea central discontinua
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([14, 14]);
        ctx.beginPath();
        ctx.ellipse(cx, cy, (rxO + rxI) / 2, (ryO + ryI) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // linea de meta
        const fa = -Math.PI / 2;
        const fx1 = cx + Math.cos(fa) * rxI;
        const fy1 = cy + Math.sin(fa) * ryI;
        const fx2 = cx + Math.cos(fa) * rxO;
        const fy2 = cy + Math.sin(fa) * ryO;
        ctx.save();
        ctx.translate(fx1, fy1);
        const dx = fx2 - fx1, dy = fy2 - fy1;
        const len = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        ctx.rotate(ang);
        const tiles = 8;
        const tw = len / tiles;
        for (let i = 0; i < tiles; i++) {
            ctx.fillStyle = i % 2 === 0 ? '#fff' : '#15192a';
            ctx.fillRect(0, i % 2 === 0 ? -6 : 0, tw, 6);
            ctx.translate(tw, 0);
        }
        ctx.restore();

        // logo central
        ctx.fillStyle = 'rgba(120,140,220,0.18)';
        ctx.font = '600 14px "Major Mono Display", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('BLOOPER · GRAND PRIX', cx, cy - 4);
        ctx.font = '600 9px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(120,140,220,0.32)';
        ctx.fillText('CIRCUITO  /  12  CORREDORES', cx, cy + 14);
    }

    updateKarts(animTime, W, H) {
        const ctx = this.ctx;
        const cx = W / 2, cy = H / 2 + 10;
        const rxM = W * 0.32, ryM = H * 0.27;
        const omegaBase = 2 * Math.PI / 8;

        for (const k of this.karts) {
            const phase = (k.slot / this.totalRacers) * Math.PI * 2;
            const omega = omegaBase * (k.infected ? 0.55 : 1.0);
            const ang = phase + (k.phaseOffset || 0) + animTime * omega;
            const x = cx + Math.cos(ang) * rxM;
            const y = cy + Math.sin(ang) * ryM;
            const heading = ang + Math.PI / 2;
            k._x = x; k._y = y; k._ang = heading;

            if (k.infected && this.particles.length < 240) {
                if ((Math.floor(animTime * 22 + k.slot) % 2) === 0) {
                    this.particles.push({
                        x: x + (Math.random() - 0.5) * 8,
                        y: y + (Math.random() - 0.5) * 8,
                        vx: (Math.random() - 0.5) * 30,
                        vy: -10 - Math.random() * 30,
                        life: 1.0,
                        size: 2 + Math.random() * 3,
                        burst: false,
                    });
                }
            }
            this.drawKart(ctx, k, animTime);
        }
    }

    drawKart(ctx, k, animTime) {
        const { _x: x, _y: y, _ang: a } = k;
        ctx.save();
        if (k.shakeUntil > animTime) {
            const sh = (Math.random() - 0.5) * 4;
            ctx.translate(x + sh, y + sh);
        } else {
            ctx.translate(x, y);
        }
        ctx.rotate(a);

        const w = 16, h = 22;

        // sombra
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.ellipse(0, h * 0.55, w * 0.7, h * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();

        // ruedas
        ctx.fillStyle = '#0a0d18';
        ctx.fillRect(-w / 2 - 3, -h / 2 + 2, 3, 5);
        ctx.fillRect( w / 2,     -h / 2 + 2, 3, 5);
        ctx.fillRect(-w / 2 - 3,  h / 2 - 7, 3, 5);
        ctx.fillRect( w / 2,      h / 2 - 7, 3, 5);

        // chasis
        const body = k.infected ? '#3b1d52' : k.color;
        const stroke = k.infected ? '#7fff00' : 'rgba(0,0,0,0.6)';
        ctx.fillStyle = body;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = k.infected ? 1.6 : 1.2;
        if (k.infected) {
            ctx.shadowColor = 'rgba(127,255,0,0.7)';
            ctx.shadowBlur = 14;
        }
        roundRect(ctx, -w / 2, -h / 2, w, h, 4);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        // morro
        ctx.fillStyle = k.infected ? '#1a0e26' : 'rgba(0,0,0,0.25)';
        roundRect(ctx, -w / 2 + 2, -h / 2 - 4, w - 4, 6, 2);
        ctx.fill();

        // cabeza del piloto
        ctx.fillStyle = k.infected ? '#0aff8e' : '#f4d8a8';
        ctx.beginPath();
        ctx.arc(0, -2, 4, 0, Math.PI * 2);
        ctx.fill();

        // ojos
        if (k.infected) {
            ctx.strokeStyle = '#0a0d18';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(-2, -3);   ctx.lineTo(-0.5, -1.2);
            ctx.moveTo(-0.5, -3); ctx.lineTo(-2, -1.2);
            ctx.moveTo(0.5, -3);  ctx.lineTo(2, -1.2);
            ctx.moveTo(2, -3);    ctx.lineTo(0.5, -1.2);
            ctx.stroke();
        } else {
            ctx.fillStyle = '#0a0d18';
            ctx.fillRect(-1.5, -2.5, 0.8, 1);
            ctx.fillRect( 0.7, -2.5, 0.8, 1);
        }

        // numero
        ctx.fillStyle = k.infected ? '#7fff00' : 'rgba(0,0,0,0.7)';
        ctx.font = '700 7px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.rotate(-a);
        ctx.fillText(pad(k.n, 2), 0, 7);

        // aura toxica
        if (k.infected) {
            const pulse = 0.25 + 0.25 * Math.sin(animTime * 6 + k.slot);
            ctx.strokeStyle = `rgba(127,255,0,${pulse})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(0, 0, 16, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    updateParticles() {
        const ctx = this.ctx;
        const dt = 1 / 60;
        const out = [];
        for (const p of this.particles) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 80 * dt * 0.4;
            p.life -= dt * (p.burst ? 1.2 : 0.65);
            if (p.life > 0) out.push(p);
        }
        this.particles = out;

        ctx.save();
        for (const p of this.particles) {
            const a = clamp(p.life, 0, 1);
            ctx.fillStyle = `rgba(${100 + 80 * a}, ${30 + 80 * a}, 200, ${0.65 * a})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = `rgba(127,255,0,${0.35 * a})`;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        ctx.restore();
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}


// ════════════════════════════════════════════════════════════════════
//   CPU · NODE-PRIME meltdown
// ════════════════════════════════════════════════════════════════════
class CpuSim extends Simulation {
    constructor() {
        super();
        this.apiUrl = '/api/cpu';
        /*
         * y(t) = 110e^(2t) - 70e^(3t)  cruza cero en t≈0.452
         * y hits |y|=100 at t≈0.667. Despues todo es divergencia brutal.
         * tEnd=1.0 es suficiente para mostrar la muerte completa.
         * Default speed 0.15 → degradacion visible en ~4.5 segundos reales.
         */
        this.tEnd = 1.0;
        this.collapseT = 0.667;
        this.speed = 0.15;
        this.numBars = 24;
        this.numLEDs = 12;
        this.numDIMMs = 4;

        this.barEls = [];
        this.ledEls = [];
        this.dimmEls = [];

        this.console = new ConsoleLog($('#c-console'));
        this.console.el.classList.add('cpu-mode');

        this.elements = {
            chip: $('#c-chip'),
            pct: $('#c-pct'),
            bar: $('#c-bar'),
            y:   $('#c-y'),
            yp:  $('#c-yp'),
            temp: $('#c-temp'),
            fan:  $('#c-fan'),
            ram:  $('#c-ram'),
            proc: $('#c-proc'),
            statusTag: $('#c-status-tag'),
            alertTag:  $('#c-alert-tag'),
            screenCpu: $('#screen-cpu'),
            screenStatus: $('#screen-status'),
            serverScreen: $('#server-screen'),
            serverArea:   $('#server-area'),
            chassis:      $('#server-chassis'),
            socketDie:    $('#socket-die'),
            warning:      $('#c-warning-card'),
            predictT:     $('#c-predict'),
            metricCardCpu:document.querySelector('.metric-card-cpu'),
            bgGlow:       $('#bg-glow-cpu'),
            timePill:     $('#time-pill'),
            statusPill:   $('#status-pill'),
            statusText:   $('#status-text'),
        };

        /* Ventana fija que reproduce la figura del trabajo final
         * (dominio LaTeX 0:0.5). El rango Y abarca el pico (y≈40.24
         * cerca de t=ln(22/21)) y la entrada a la rama negativa
         * (y≈-14.7 en t=0.5). */
        this.viewTMax = 0.5;
        this.viewYMax = 50;
        this.viewYMin = -20;

        /* Cruce por cero exacto: t = ln(11/7) ~= 0.45199. El backend lo
         * confirma en /api/cpu/series; aqui lo precargamos por estabilidad. */
        this.tZero = Math.log(11 / 7);
        this.tPeak = Math.log(22 / 21);

        this.chart = new CurveChart($('#cpu-chart'), {
            tMax: this.viewTMax,
            yMin: this.viewYMin, yMax: this.viewYMax,
            color: '#3b82f6',
            glow:  'rgba(59,130,246,0.55)',
            tUnit: 'h',
        });

        this.buildScreenBars();
        this.buildLEDs();
        this.buildDIMMs();

        this.thresholdsLogged = { warn: false, crit: false, overload: false };
    }

    buildScreenBars() {
        const host = $('#screen-bars');
        host.innerHTML = '';
        for (let i = 0; i < this.numBars; i++) {
            const b = document.createElement('div');
            b.className = 'screen-bar';
            host.appendChild(b);
            this.barEls.push(b);
        }
    }
    buildLEDs() {
        const host = $('#chassis-leds');
        for (let i = 0; i < this.numLEDs; i++) {
            const l = document.createElement('div');
            l.className = 'led';
            host.appendChild(l);
            this.ledEls.push(l);
        }
    }
    buildDIMMs() {
        const host = $('#dimm-slots');
        host.innerHTML = '';
        for (let i = 0; i < this.numDIMMs; i++) {
            const d = document.createElement('div');
            d.className = 'dimm';
            const f = document.createElement('div');
            f.className = 'dimm-fill';
            d.appendChild(f);
            host.appendChild(d);
            this.dimmEls.push(f);
        }
    }

    async preload() {
        try {
            /* Muestreamos la curva exacta en el dominio de la figura LaTeX
             * (0 a 0.5 h, 200 muestras como en la figura del trabajo). */
            const r = await fetch('/api/cpu/series?n=200&t_end=' + this.viewTMax).then(r => r.json());
            this.chart.setSeries(r.points.map(p => ({ t: p.t, y: p.y })));
            const collapseR = await fetch('/api/cpu/collapse').then(r => r.json());
            this.collapseT = collapseR.collapse_t;
            /* Unico marcador (en rojo) reproduciendo la condicion inicial
             * de la figura del trabajo: punto solido sobre (0, 40). */
            this.chart.setMarkers([
                { t: 0, y: 40, color: '#ef4444', label: 'Condición inicial', shape: 'circle',
                  glow: 'rgba(239,68,68,0.7)', labelAlign: 'left', labelDy: -10 },
            ]);
            this.elements.predictT.textContent = fmt(this.collapseT, 3) + ' h';
        } catch (e) {
            console.error('cpu preload failed', e);
        }
    }

    reset() {
        super.reset();
        this.speed = 0.15;
        this.viewTMax = 0.5;
        this.viewYMax = 50;
        this.viewYMin = -20;
        this.thresholdsLogged = { warn: false, crit: false, overload: false };
        /* Reset all progressive log flags */
        for (let i = 1; i <= 12; i++) this['_log' + String(i).padStart(2, '0')] = false;
        this.elements.warning.classList.remove('active');
        this.elements.serverScreen.classList.remove('warn', 'crit', 'glitch', 'overload');
        this.elements.serverArea.classList.remove('warn', 'crit');
        this.elements.chassis.classList.remove('shake', 'shake-hard');
        this.elements.bgGlow.classList.remove('active');
        this.elements.alertTag.textContent = 'OK';
        this.elements.alertTag.classList.remove('panel-tag-warn');
        this.elements.statusPill.classList.remove('cpu-running');
        this.elements.statusText.textContent = 'EN ESPERA';
        this.elements.socketDie.classList.remove('heat-1', 'heat-2', 'heat-3');
        this.console.clear();
        this.console.push('boot · node-prime listo · y(0) = 40 %, y′(0) = 10 %/h', 'info');
        this.console.push('modelo · y″ − 5y′ + 6y = 0 · m₁=2, m₂=3 · y(t) = 110 e²ᵗ − 70 e³ᵗ', 'info');
        this.console.push('clasificacion · INESTABLE · y(t) → −∞ · cruce t = ln(11/7) ≈ 0.452 h', 'warn');
        this.applyState({ ok: true, t: 0, y: 40, y_prime: 10, cpu_percent: 40,
                         ram_percent: 73, temperature_c: 54, processes: 49, fan_rpm: 2160 });
    }

    play() {
        super.play();
        this.speed = this._userSpeed || 0.15;
        this.elements.statusPill.classList.add('cpu-running');
        this.elements.statusText.textContent = 'CARGA EN CURSO';
        this.console.push('stress test iniciado · inyectando carga al kernel', 'warn');
        this.console.push('velocidad simulacion ×' + this.speed.toFixed(2) + ' · |y(t)| → ∞', 'info');
        /* Fetch inmediato para poblar estado antes del primer frame */
        this.fetchState();
    }

    pause() {
        super.pause();
        this.elements.statusPill.classList.remove('cpu-running');
        this.elements.statusText.textContent = 'PAUSA';
        this.console.push('test pausado · medicion congelada', 'info');
    }

    onTimeAdvance() {
        /* Log progresivo de degradacion — tiempos exactos del modelo
         * y(t) = 110 e^(2t) - 70 e^(3t), t en horas:
         *   t = 0.000   y = +40.00   y' = +10.00
         *   t ≈ 0.047   y = +40.24   y' = 0       (maximo local: ln(22/21))
         *   t = 0.200   y ≈ +36.55                (rama positiva, decae)
         *   t = 0.350   y ≈ +21.47                (decae rapidamente)
         *   t = 0.452   y ≈   0.00                (cruce por cero: ln(11/7))
         *   t = 0.500   y ≈ −14.71                (entra en rama negativa)
         *   t = 0.550   y ≈ −34.04
         *   t = 0.600   y ≈ −58.26
         *   t = 0.630   y ≈ −75.56
         *   t ≈ 0.667   y ≈ −100.00               (|y|=100% · COLAPSO)
         */
        if (this.running && !this.finished) {
            const t = this.t;
            if (t > 0.05 && !this._log01) {
                this._log01 = true;
                this.console.push('carga inyectada · procesos escalando', 'info');
            }
            if (t > 0.12 && !this._log02) {
                this._log02 = true;
                this.console.push('cache L2 miss rate incrementando · latencia +12%', 'info');
            }
            if (t > 0.20 && !this._log03) {
                this._log03 = true;
                this.console.push('context switches > 8000/s · scheduler bajo presion', 'info');
            }
            if (t > 0.28 && !this._log04) {
                this._log04 = true;
                this.console.push('y(t) descendiendo · ecuacion entrando en fase critica', 'warn');
            }
            if (t > 0.35 && !this._log05) {
                this._log05 = true;
                this.console.push('page faults incrementando · swap activado', 'warn');
            }
            if (t > 0.42 && !this._log06) {
                this._log06 = true;
                this.console.push('!! cruce por cero inminente · t → ln(11/7) ≈ 0.452 h !!', 'warn');
            }
            if (t > 0.4520 && !this._log07) {
                this._log07 = true;
                this.console.push('y(t) < 0 · rama negativa activa · solucion diverge a −∞', 'crit');
            }
            if (t > 0.50 && !this._log08) {
                this._log08 = true;
                this.console.push('|y(t)| acelerando · e^(3t) dominando · inestabilidad exponencial', 'crit');
            }
            if (t > 0.55 && !this._log09) {
                this._log09 = true;
                this.console.push('temperatura critica · throttle forzado · iowait > 80%', 'crit');
            }
            if (t > 0.58 && !this._log10) {
                this._log10 = true;
                this.console.push('OOM killer evaluando procesos · memoria insuficiente', 'crit');
            }
            if (t > 0.62 && !this._log11) {
                this._log11 = true;
                this.console.push('disk I/O stall · journal corruption · fs read-only', 'crit');
            }
            if (t > 0.667 && !this._log12) {
                this._log12 = true;
                this.console.push('!! |y(t)| ≥ 100 · umbral de colapso alcanzado · y ≈ −100 !!', 'crit');
            }
        }
        if (this.t >= this.tEnd && !this.finished) {
            this.t = this.tEnd;
            this.finished = true;
            this.running = false;
            this.elements.statusPill.classList.remove('cpu-running');
            this.elements.statusText.textContent = 'NODO CAIDO';
            this.console.push('!! KERNEL PANIC - not syncing: softlockup !!', 'crit');
            this.console.push('watchdog: BUG: soft lockup - CPU#0 stuck', 'crit');
            this.console.push('nodo-prime desconectado del cluster', 'crit');
        }
    }

    applyState(data) {
        if (!data || !data.ok) return;
        const { y, y_prime, cpu_percent, ram_percent, temperature_c, processes, fan_rpm } = data;
        const absY = Math.abs(y);

        this.elements.pct.textContent = fmt(cpu_percent, 1);
        this.elements.bar.style.width = cpu_percent + '%';
        this.elements.y.textContent  = (y >= 0 ? '+' : '') + fmt(y, 3);
        this.elements.yp.textContent = (y_prime >= 0 ? '+' : '') + fmt(y_prime, 3);
        this.elements.temp.textContent = fmt(temperature_c, 1) + ' °C';
        this.elements.fan.textContent  = fan_rpm + ' RPM';
        this.elements.ram.textContent  = fmt(ram_percent, 1) + ' %';
        this.elements.proc.textContent = processes;
        this.elements.screenCpu.textContent = fmt(cpu_percent, 1) + '%';
        this.elements.timePill.textContent = 't = ' + fmt(this.t, 3) + ' h';

        const chip = this.elements.chip;
        const statusTag = this.elements.statusTag;
        const screen = this.elements.serverScreen;
        const area = this.elements.serverArea;
        const die  = this.elements.socketDie;
        const chassis = this.elements.chassis;
        const card = this.elements.metricCardCpu;

        chip.classList.remove('warn', 'crit', 'metric-chip-cpu');
        screen.classList.remove('warn', 'crit', 'glitch', 'overload');
        area.classList.remove('warn', 'crit');
        die.classList.remove('heat-1', 'heat-2', 'heat-3');
        chassis.classList.remove('shake', 'shake-hard');
        card.classList.remove('crit');

        let chipText = 'NOMINAL';
        let statusText = '▮ IDLE';
        let alertText = 'OK';

        if (cpu_percent >= 100) {
            chip.classList.add('crit');
            screen.classList.add('crit', 'glitch', 'overload');
            area.classList.add('crit');
            die.classList.add('heat-3');
            chassis.classList.add('shake-hard');
            card.classList.add('crit');
            this.elements.bgGlow.classList.add('active');
            chipText = 'OVERLOAD';
            statusText = '!! KERNEL PANIC';
            alertText = 'CRITICAL';
            this.elements.alertTag.classList.add('panel-tag-warn');
            this.elements.screenStatus.textContent = 'OVERLOAD';
            if (!this.thresholdsLogged.overload) {
                this.console.push('!! kernel panic · |y(t)| ≥ 100 · servidor saturado', 'crit');
                this.console.push('cores en runaway thermal · cierre del rack', 'crit');
                this.thresholdsLogged.overload = true;
            }
        } else if (cpu_percent >= 80) {
            chip.classList.add('crit');
            screen.classList.add('crit', 'glitch');
            area.classList.add('crit');
            die.classList.add('heat-2');
            chassis.classList.add('shake');
            this.elements.bgGlow.classList.add('active');
            chipText = 'CRITICAL';
            statusText = '!! CRITICAL';
            alertText = 'WARN';
            this.elements.alertTag.classList.add('panel-tag-warn');
            this.elements.screenStatus.textContent = 'CRITICAL';
            if (!this.thresholdsLogged.crit) {
                this.console.push('!! warning · |y(t)| > 80 · cpu en runaway exponencial', 'crit');
                this.thresholdsLogged.crit = true;
            }
        } else if (cpu_percent >= 50) {
            chip.classList.add('warn');
            screen.classList.add('warn');
            area.classList.add('warn');
            die.classList.add('heat-1');
            chipText = 'WARNING';
            statusText = '▮ WARNING';
            alertText = 'WARN';
            this.elements.alertTag.classList.add('panel-tag-warn');
            this.elements.screenStatus.textContent = 'WARNING';
            if (!this.thresholdsLogged.warn) {
                this.console.push('aviso · |y(t)| > 50 · degradacion del nodo', 'warn');
                this.thresholdsLogged.warn = true;
            }
        } else {
            chip.classList.add('metric-chip-cpu');
            this.elements.alertTag.classList.remove('panel-tag-warn');
            this.elements.screenStatus.textContent = 'NOMINAL';
            this.elements.bgGlow.classList.remove('active');
        }

        chip.textContent = chipText;
        statusTag.textContent = statusText;
        this.elements.alertTag.textContent = alertText;
        this.elements.warning.classList.toggle('active', cpu_percent >= 70);

        // ventiladores
        const fanDur = clamp(2.4 / (1 + absY / 60), 0.05, 4.0).toFixed(3);
        document.documentElement.style.setProperty('--fan-dur', fanDur + 's');

        // DIMMs
        const ramFrac = ram_percent / 100;
        for (let i = 0; i < this.numDIMMs; i++) {
            const local = clamp(ramFrac * (0.8 + 0.05 * i), 0, 1);
            this.dimmEls[i].style.height = (local * 100) + '%';
        }

        // LEDs
        const onCount = Math.round(cpu_percent / 100 * this.numLEDs);
        for (let i = 0; i < this.numLEDs; i++) {
            const el = this.ledEls[i];
            el.classList.remove('on-g', 'on-y', 'on-r');
            if (i < onCount) {
                if (cpu_percent >= 80) el.classList.add('on-r');
                else if (cpu_percent >= 50) el.classList.add('on-y');
                else el.classList.add('on-g');
            }
        }
    }

    render(animTime) {
        const data = this.latestState;
        const pct = data ? data.cpu_percent : 40;
        for (let i = 0; i < this.numBars; i++) {
            const wave = Math.abs(Math.sin(this.t * 6.0 + i * 0.52)) * 0.55 + 0.45;
            const h = clamp(pct * wave, 5, 100);
            this.barEls[i].style.height = h + '%';
        }

        /* Cursor = y(t) firmado. Sigue la curva de la solucion exacta:
         * parte en +40, pasa por el maximo en t=ln(22/21), cruza cero
         * en t=ln(11/7) y entra en la rama negativa.  El rango del
         * grafico es estatico (igual que la figura del trabajo); cuando
         * la simulacion supera t=0.5 h el cursor sale del cuadro. */
        const ySigned = data ? data.y : 40;
        this.chart.setRange(this.viewTMax, this.viewYMin, this.viewYMax);
        this.chart.draw(this.t, ySigned);
    }
}


// ════════════════════════════════════════════════════════════════════
//   APP · orquestador
// ════════════════════════════════════════════════════════════════════
const App = {
    stage: 'virus',
    virus: null,
    cpu: null,

    async init() {
        this.virus = new VirusSim();
        this.cpu = new CpuSim();

        await Promise.all([this.virus.preload(), this.cpu.preload()]);
        this.virus.reset();
        this.cpu.reset();

        /* Activar solo la simulacion visible */
        this.virus.active = true;
        this.cpu.active = false;

        this.bindTabs();
        this.bindVirusControls();
        this.bindCpuControls();

        this.lastWall = performance.now();
        requestAnimationFrame(this.tick.bind(this));
    },

    tick(wallNow) {
        this.virus.step(wallNow);
        this.cpu.step(wallNow);
        requestAnimationFrame(this.tick.bind(this));
    },

    bindTabs() {
        $$('.scenario-tab').forEach(btn => {
            btn.addEventListener('click', () => this.switchTo(btn.dataset.scenario));
        });
    },

    switchTo(stage) {
        this.stage = stage;

        /* Marcar cual simulacion esta activa para polling selectivo */
        this.virus.active = (stage === 'virus');
        this.cpu.active   = (stage === 'cpu');

        document.body.classList.toggle('stage-cpu-active', stage === 'cpu');
        document.body.classList.toggle('stage-virus-active', stage === 'virus');
        $$('.scenario-tab').forEach(b => {
            const a = b.dataset.scenario === stage;
            b.classList.toggle('active', a);
            b.setAttribute('aria-selected', a ? 'true' : 'false');
        });
        $$('.sim-stage').forEach(s => {
            s.classList.toggle('active', s.dataset.stage === stage);
        });
        setTimeout(() => {
            this.virus.resizeCanvas();
            this.virus.chart.resize();
            this.cpu.chart.resize();
        }, 50);
    },

    bindVirusControls() {
        $('#v-play').addEventListener('click',  () => this.virus.play());
        $('#v-pause').addEventListener('click', () => this.virus.pause());
        $('#v-reset').addEventListener('click', () => this.virus.reset());
        const speed = $('#v-speed'); const speedVal = $('#v-speed-val');
        speed.addEventListener('input', () => {
            this.virus.setSpeed(parseFloat(speed.value));
            speedVal.textContent = parseFloat(speed.value).toFixed(2);
        });
    },

    bindCpuControls() {
        $('#c-play').addEventListener('click',  () => this.cpu.play());
        $('#c-pause').addEventListener('click', () => this.cpu.pause());
        const speed = $('#c-speed'); const speedVal = $('#c-speed-val');
        $('#c-reset').addEventListener('click', () => {
            this.cpu.reset();
            speed.value = '0.15';
            speedVal.textContent = '0.15';
            this.cpu._userSpeed = 0.15;
        });
        speed.addEventListener('input', () => {
            const v = parseFloat(speed.value);
            this.cpu._userSpeed = v;
            this.cpu.setSpeed(v);
            speedVal.textContent = v.toFixed(2);
        });
    },
};

window.addEventListener('DOMContentLoaded', () => App.init());
