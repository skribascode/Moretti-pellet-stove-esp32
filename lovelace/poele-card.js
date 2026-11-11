/* poele-card — Lovelace card for a Micronova pellet stove driven by ESPHome
 * https://github.com/skribascode/moretti-pellet-stove-esp32 — MIT licence
 * No dependency. Copy to /config/www/poele-card.js, add resource /local/poele-card.js (JavaScript module).
 * UI text is in French.
 */
const PC_VERSION = "1.4.0";

const DEFAULTS = {
  title: "Poêle",
  switch: "switch.poele_poele",
  state: "sensor.poele_etat",
  room: "sensor.room_temperature",                  // your room thermometer (preferred)
  room_remote: "sensor.poele_temperature_ambiante", // stove reading (fallback)
  setpoint: "input_number.poele_consigne",
  flame: "number.poele_niveau_de_flamme",
  power: "sensor.poele_puissance",
  fumes: "sensor.poele_temperature_fumees",
  prog: "input_boolean.poele_programmation",
  mode: "input_select.poele_mode_programmation",
  schedule: "schedule.poele_plages_horaires",
  automation: "automation.poele_programmation",
  wifi: "sensor.poele_signal_wifi",
  ip: "sensor.poele_adresse_ip",
  uptime: "sensor.poele_dernier_redemarrage_esp",
  version: "sensor.poele_version_esphome",
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_SHORT = ["L", "M", "M", "J", "V", "S", "D"];
const DAY_LONG = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

const fmt = (v, d = 1) =>
  v === null || v === undefined || isNaN(v) ? "—" : Number(v).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const hhmm = (t) => (t || "").slice(0, 5);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function phase(state) {
  const s = (state || "").toLowerCase();
  if (!s || s === "unavailable" || s === "unknown") return { key: "na", label: "Indisponible", color: "var(--disabled-text-color, #888)" };
  if (s.startsWith("alarme") || s.includes("alarm")) return { key: "alarm", label: state, color: "#e5484d" };
  if (s.includes("chauffe") || s === "working") return { key: "heat", label: state, color: "var(--pc-accent)" };
  if (s.includes("démarrage") || s.includes("chargement") || s.includes("allumage") || s === "start" || s === "ignition")
    return { key: "ignite", label: state, color: "#f5a524" };
  if (s.includes("nettoyage du brasier")) return { key: "clean", label: state, color: "#f5a524" };
  if (s.includes("extinction") || s.includes("final")) return { key: "stop", label: state, color: "#7c8ea3" };
  if (s.includes("veille") || s === "standby") return { key: "standby", label: state, color: "#4c9aff" };
  return { key: "off", label: state, color: "var(--secondary-text-color)" };
}

class PoeleCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }
  setConfig(config) {
    this._cfg = { ...DEFAULTS, ...(config || {}) };
    this._pendingSp = null;
    this._confirmUntil = 0;
    this._techOpen = false;
    this._editor = null;
    this._sched = null;
    this._hist = null;
    this._lastSig = "";
    if (!this.shadowRoot) this._build();
  }
  getCardSize() {
    return 12;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._cfg) return;
    const sig = Object.values(this._cfg)
      .map((e) => (typeof e === "string" && hass.states[e] ? hass.states[e].last_updated + hass.states[e].state : ""))
      .join("|");
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._render();
    }
    const now = Date.now();
    if (!this._histAt || now - this._histAt > 5 * 60 * 1000) {
      this._histAt = now;
      this._loadHistory();
    }
    if (!this._schedAt || now - this._schedAt > 10 * 60 * 1000) {
      this._schedAt = now;
      this._loadSchedule();
    }
  }

  connectedCallback() {
    this._tick = setInterval(() => this._renderProg(), 60 * 1000);
  }
  disconnectedCallback() {
    clearInterval(this._tick);
  }

  /* ---------- helpers ---------- */
  _s(key) {
    const id = this._cfg[key];
    return id && this._hass ? this._hass.states[id] : undefined;
  }
  _roomKey() {
    const a = this._s("room");
    const v = a ? parseFloat(a.state) : NaN;
    return !isNaN(v) && v > 3 ? "room" : "room_remote";
  }
  _room() {
    const v = this._n(this._roomKey());
    return v !== null && v > 3 ? v : null;
  }
  _n(key) {
    const st = this._s(key);
    const v = st ? parseFloat(st.state) : NaN;
    return isNaN(v) ? null : v;
  }
  _call(domain, service, data) {
    return Promise.resolve(this._hass.callService(domain, service, data)).catch((err) => {
      const ev = new Event("hass-notification", { bubbles: true, composed: true });
      ev.detail = { message: `Poêle : échec de la commande (${(err && err.message) || "module injoignable"})` };
      this.dispatchEvent(ev);
    });
  }
  _moreInfo(entityId) {
    const ev = new Event("hass-more-info", { bubbles: true, composed: true });
    ev.detail = { entityId };
    this.dispatchEvent(ev);
  }

  /* ---------- data ---------- */
  async _loadSchedule() {
    try {
      const list = await this._hass.callWS({ type: "schedule/list" });
      const id = this._cfg.schedule.split(".")[1];
      this._sched = list.find((s) => s.id === id) || null;
      this._renderProg();
    } catch (e) {
      this._sched = null;
    }
  }
  async _loadHistory() {
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 3600 * 1000);
      const ids = [this._cfg[this._roomKey()], this._cfg.setpoint, this._cfg.state];
      const r = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const pts = (id) =>
        (r[id] || []).map((p) => ({ t: (p.lu || p.lc) * 1000, v: p.s })).filter((p) => p.t);
      this._hist = { start: start.getTime(), end: end.getTime(), room: pts(ids[0]), sp: pts(ids[1]), st: pts(ids[2]) };
      this._renderSuivi();
    } catch (e) {
      this._hist = null;
    }
  }

  /* ---------- skeleton ---------- */
  _build() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${PoeleCard.styles}</style>
      <ha-card>
        <div id="top"></div>
        <div id="prog" class="section"></div>
        <div id="editor"></div>
        <div id="suivi" class="section"></div>
        <div id="tech" class="section"></div>
      </ha-card>`;
    root.addEventListener("click", (ev) => this._onClick(ev));
    root.addEventListener("change", (ev) => this._onChange(ev));
  }

  _render() {
    if (!this.shadowRoot || !this._hass) return;
    this._renderTop();
    this._renderProg();
    this._renderSuivi();
    this._renderTech();
  }

  /* ---------- top: poêle + consigne ---------- */
  _stoveSvg(ph, level) {
    const on = ["heat", "ignite", "clean"].includes(ph.key);
    const warm = on || ph.key === "standby";
    const lv = Math.max(1, Math.min(5, level || 1));
    const scale = on ? (ph.key === "heat" ? 0.55 + lv * 0.1 : 0.45) : 0;
    const glow = on ? (ph.key === "heat" ? 0.35 + lv * 0.09 : 0.3) : 0;
    const flames = on
      ? `<g class="flames" style="--fs:${scale}">
          <path class="f f1" d="M74 184 C56 184 50 166 60 150 C64 160 68 158 68 150 C68 136 76 128 74 114 C88 126 96 144 90 160 C96 156 98 150 98 146 C106 164 96 184 74 184Z"/>
          <path class="f f2" d="M74 184 C62 184 58 172 64 162 C67 168 70 167 70 162 C70 152 76 146 75 138 C84 146 88 158 84 168 C88 166 90 162 90 160 C94 172 88 184 74 184Z"/>
          <path class="f f3" d="M74 184 C67 184 65 177 68 171 C70 174 72 173 72 170 C72 165 75 161 75 157 C80 162 82 169 80 175 C82 174 83 172 83 171 C85 178 81 184 74 184Z"/>
        </g>`
      : warm
        ? `<g class="embers"><ellipse cx="74" cy="184" rx="14" ry="2.2"/></g>`
        : "";
    const heat = on
      ? `<g class="smoke">
          <path class="s s1" d="M50 -2 C46 -10 54 -14 50 -22"/>
          <path class="s s2" d="M70 -2 C74 -10 66 -14 70 -24"/>
          <path class="s s3" d="M90 -2 C86 -10 94 -14 90 -20"/>
        </g>`
      : "";
    const bars = [9, 12, 15, 18]
      .map((y) => `<path d="M7 ${y} Q70 ${y + 1.4} 133 ${y}" class="bar" stroke="url(#pcChrome)"/>`)
      .join("");
    return `
      <svg viewBox="0 -28 140 340" class="stove ${on ? "on" : ""} ${ph.key}">
        <defs>
          <linearGradient id="pcGlassBase" x1="0" x2="1">
            <stop offset="0" stop-color="#030304"/><stop offset=".22" stop-color="#16181c"/>
            <stop offset=".5" stop-color="#08090a"/><stop offset=".82" stop-color="#121417"/><stop offset="1" stop-color="#020203"/>
          </linearGradient>
          <linearGradient id="pcTint" x1="0" x2="1">
            <stop offset="0" stop-color="#000" stop-opacity=".78"/><stop offset=".25" stop-color="#000" stop-opacity=".5"/>
            <stop offset=".6" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="#000" stop-opacity=".8"/>
          </linearGradient>
          <linearGradient id="pcChrome" x1="0" x2="1">
            <stop offset="0" stop-color="#6d737b"/><stop offset=".3" stop-color="#e3e6ea"/>
            <stop offset=".7" stop-color="#b9bec4"/><stop offset="1" stop-color="#5c6168"/>
          </linearGradient>
          <radialGradient id="pcFire" cx=".5" cy=".9" r=".85">
            <stop offset="0" stop-color="#ffb04a"/><stop offset=".45" stop-color="#c2410c"/>
            <stop offset="1" stop-color="#1a0802"/>
          </radialGradient>
          <radialGradient id="pcSpill" cx=".5" cy=".5" r=".5">
            <stop offset="0" stop-color="#ff8a2a" stop-opacity=".55"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/>
          </radialGradient>
          <filter id="pcSoft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
          <filter id="pcSoft2" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation=".7"/></filter>
          <clipPath id="pcWin"><rect x="42" y="110" width="64" height="77" rx="2"/></clipPath>
          <clipPath id="pcFront"><path d="M6 21 Q70 24 134 21 L134 293 Q70 302 6 293 Z"/></clipPath>
        </defs>
        ${heat}
        <ellipse cx="70" cy="306" rx="70" ry="4" fill="#000" opacity=".25"/>
        <rect x="3" y="20" width="134" height="282" rx="2" fill="#1c1d20"/>
        <path d="M6 21 Q70 24 134 21 L134 293 Q70 302 6 293 Z" fill="url(#pcGlassBase)"/>
        <g clip-path="url(#pcFront)">
          ${
            on
              ? `<g filter="url(#pcSoft)" style="opacity:${glow + 0.15}"><rect x="42" y="110" width="64" height="77" rx="3" fill="url(#pcFire)" class="firebox"/></g>
          <g clip-path="url(#pcWin)" filter="url(#pcSoft2)" opacity=".85">${flames}</g>`
              : flames
          }
          <path d="M6 21 Q70 24 134 21 L134 293 Q70 302 6 293 Z" fill="url(#pcTint)"/>
          ${on ? `<ellipse cx="74" cy="150" rx="70" ry="80" fill="url(#pcSpill)" class="spill" style="--gl:${glow}"/>` : ""}
          <rect x="20" y="20" width="7" height="282" fill="#fff" opacity=".06"/>
          <rect x="29" y="20" width="1.6" height="282" fill="#fff" opacity=".13"/>
          <rect x="112" y="20" width="4" height="282" fill="#fff" opacity=".05"/>
          <path d="M6 21 Q70 24 134 21 L134 30 Q70 33 6 30 Z" fill="#fff" opacity=".03"/>
        </g>
        <path d="M6 293 Q70 302 134 293" fill="none" stroke="#2c2e32" stroke-width="1"/>
        <rect x="3" y="20" width="3.2" height="282" fill="#121315"/>
        <rect x="133.8" y="20" width="3.2" height="282" fill="#121315"/>
        <rect x="2" y="5" width="136" height="16" fill="#0b0c0d"/>
        ${bars}
        <rect x="1" y="0" width="138" height="5.5" rx="1.2" fill="#18191b"/>
        <rect x="1" y="0" width="138" height="1.2" rx=".6" fill="#3a3c40"/>
        <rect x="0" y="302" width="140" height="4" rx="1" fill="#141517"/>
      </svg>`;
  }

  _arcPath(cx, cy, r, a0, a1) {
    const p = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  _gauge(ph) {
    const spSt = this._s("setpoint");
    const min = spSt ? Number(spSt.attributes.min) : 15;
    const max = spSt ? Number(spSt.attributes.max) : 25;
    const sp = this._pendingSp ?? this._n("setpoint");
    const room = this._room();
    const A0 = 135, A1 = 405;
    const ang = (v) => A0 + ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (A1 - A0);
    const heatingNow = ["heat", "ignite"].includes(ph.key);
    const col = heatingNow ? "var(--pc-accent)" : ph.key === "standby" ? "#4c9aff" : "var(--secondary-text-color)";
    const pt = (a, r = 80) => [100 + r * Math.cos((a * Math.PI) / 180), 100 + r * Math.sin((a * Math.PI) / 180)];
    const spA = sp !== null ? ang(sp) : A0;
    const [hx, hy] = pt(spA);
    let roomMark = "";
    if (room !== null) {
      const [rx, ry] = pt(ang(room));
      roomMark = `<circle cx="${rx}" cy="${ry}" r="4.5" class="roomdot"/>`;
    }
    const spTxt = sp !== null ? fmt(sp, 1).split(",") : ["—", ""];
    const verb = heatingNow ? "Chauffage" : ph.key === "standby" ? "Température atteinte" : ph.key === "off" ? "À l'arrêt" : ph.label.split(" (")[0];
    return `
      <div class="gauge">
        <div class="cur">Température actuelle<br><b>${fmt(room, 1)} °C</b></div>
        <svg viewBox="0 0 200 175" data-action="arc">
          <path d="${this._arcPath(100, 100, 80, A0, A1)}" class="track"/>
          ${sp !== null ? `<path d="${this._arcPath(100, 100, 80, A0, Math.max(A0 + 0.5, spA))}" class="fill" style="stroke:${col}"/>` : ""}
          ${roomMark}
          <circle cx="${hx}" cy="${hy}" r="9" class="handle" style="stroke:${col}"/>
          <text x="100" y="78" class="verb">${esc(verb)}</text>
          <text x="96" y="122" class="spbig">${spTxt[0]}</text>
          <text x="${spTxt[0].length > 1 ? 127 : 113}" y="96" class="unit">°C</text>
          <text x="${spTxt[0].length > 1 ? 127 : 113}" y="122" class="dec">,${spTxt[1] || "0"}</text>
        </svg>
        <div class="pm">
          <button class="round" data-action="sp-" aria-label="Baisser la consigne">−</button>
          <button class="round" data-action="sp+" aria-label="Monter la consigne">+</button>
        </div>
      </div>`;
  }

  _renderTop() {
    const el = this.shadowRoot.getElementById("top");
    const st = this._s("state");
    const ph = phase(st ? st.state : "");
    const sw = this._s("switch");
    const isOn = sw && sw.state === "on";
    const offline = !sw || sw.state === "unavailable" || sw.state === "unknown";
    const realLevel = this._n("flame");
    if (this._pendingFlame != null && (realLevel === this._pendingFlame || Date.now() - this._pendingFlameAt > 30000)) this._pendingFlame = null;
    const level = this._pendingFlame ?? realLevel;
    const power = this._n("power");
    const fumes = this._n("fumes");
    const room = this._room();
    const sp = this._pendingSp ?? this._n("setpoint");
    const mode = this._s("mode");
    const confirming = Date.now() < this._confirmUntil;
    const flameMax = this._s("flame") ? Number(this._s("flame").attributes.max) || 5 : 5;
    let seg = "";
    for (let i = 1; i <= flameMax; i++) {
      seg += `<button class="seg ${level === i ? "sel" : ""} ${level === i && this._pendingFlame != null ? "pending" : ""}" data-action="flame" data-v="${i}">P${i}</button>`;
    }
    el.style.setProperty("--pc-phase", ph.color);
    el.innerHTML = `
      <div class="head">
        <div>
          <div class="title">${esc(this._cfg.title)}</div>
          <div class="sub"><ha-icon icon="mdi:thermometer"></ha-icon> Pièce : <b>${fmt(room, 1)} °C</b></div>
          <div class="phase" style="color:${ph.color}">${esc(ph.label)}</div>
        </div>
        ${mode ? `<button class="chip" data-action="more" data-e="${this._cfg.mode}"><ha-icon icon="mdi:calendar-clock"></ha-icon>${esc(mode.state)}</button>` : ""}
      </div>
      <div class="hero">
        <div class="stovewrap">
          ${this._stoveSvg(ph, power ?? level)}
          <div class="lcd">${fmt(room, 1)}°›${fmt(sp, 1)}° P${power !== null ? fmt(power, 0) : "–"}</div>
        </div>
        ${this._gauge(ph)}
      </div>
      <div class="info">Fumées ${fmt(fumes, 0)} °C · Puissance réelle P${power !== null ? fmt(power, 0) : "–"}</div>
      <div class="actions">
        ${
          offline
            ? `<button class="big offline" disabled>
          <ha-icon icon="mdi:wifi-off"></ha-icon>
          <span>Module hors ligne</span>
        </button>`
            : `<button class="big ${isOn ? "on" : ""} ${confirming ? "confirm" : ""}" data-action="power">
          <ha-icon icon="${isOn ? "mdi:fire" : "mdi:power"}"></ha-icon>
          <span>${confirming ? (isOn ? "Confirmer l'arrêt ?" : "Confirmer l'allumage ?") : isOn ? "Allumé" : "Éteint"}</span>
        </button>`
        }
        <div class="flamebox">
          <div class="lbl"><ha-icon icon="mdi:fire-circle"></ha-icon> Niveau de flamme</div>
          <div class="segs">${seg}</div>
        </div>
      </div>`;
  }

  /* ---------- programmation ---------- */
  _todaySlots() {
    if (!this._sched) return [];
    const d = (new Date().getDay() + 6) % 7;
    return this._sched[DAYS[d]] || [];
  }
  _daysLabel() {
    if (!this._sched) return "";
    const sig = (d) => JSON.stringify(this._sched[d] || []);
    if (DAYS.every((d) => sig(d) === sig(DAYS[0]))) return "tous les jours";
    if (DAYS.slice(0, 5).every((d) => sig(d) === sig("monday")) && sig("saturday") === sig("sunday")) return "semaine / week-end différents";
    return "selon le jour";
  }

  _renderProg() {
    const el = this.shadowRoot && this.shadowRoot.getElementById("prog");
    if (!el || !this._hass) return;
    const prog = this._s("prog");
    const progOn = prog && prog.state === "on";
    const mode = this._s("mode");
    const sch = this._s("schedule");
    const inSlot = sch && sch.state === "on";
    const next = sch && sch.attributes.next_event ? new Date(sch.attributes.next_event) : null;
    const now = new Date();
    const minsNow = now.getHours() * 60 + now.getMinutes();
    const slots = this._todaySlots();
    const toMin = (t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    const bars = slots
      .map((s) => {
        const a = toMin(s.from), b = s.to.startsWith("00:00") ? 1440 : toMin(s.to);
        const act = minsNow >= a && minsNow < b;
        return `<div class="slot ${act ? "act" : ""}" style="left:${(a / 1440) * 100}%;width:${((b - a) / 1440) * 100}%"></div>`;
      })
      .join("");
    const sp = this._n("setpoint");
    const cards = slots
      .map((s) => {
        const a = toMin(s.from), b = s.to.startsWith("00:00") ? 1440 : toMin(s.to);
        const act = minsNow >= a && minsNow < b;
        const done = minsNow >= b;
        return `<div class="pl ${act ? "act" : ""} ${done ? "done" : ""}">
            <div class="plt">${hhmm(s.from)} → ${hhmm(s.to)}</div>
            <div class="pls">${act ? "en cours" : done ? "terminée" : "à venir"}${mode && mode.state !== "Horaire seul" ? ` · ${fmt(sp, 1)} °C` : ""}</div>
          </div>`;
      })
      .join("");
    const modes = mode ? mode.attributes.options || [] : [];
    const short = { "Horaire + température": "Horaire + T°", "Horaire seul": "Horaire", "Température seule": "T° seule" };
    el.innerHTML = `
      <div class="shead">
        <div class="stitle">Programmation</div>
        <button class="pill ${progOn ? "ok" : ""}" data-action="prog">
          <ha-icon icon="${progOn ? "mdi:calendar-check" : "mdi:calendar-remove"}"></ha-icon>
          ${progOn ? "Programmation activée" : "Programmation désactivée"}
        </button>
      </div>
      <div class="segs modes ${progOn ? "" : "dim"}">
        ${modes.map((m) => `<button class="seg ${mode.state === m ? "sel" : ""}" data-action="mode" data-v="${esc(m)}">${esc(short[m] || m)}</button>`).join("")}
      </div>
      <div class="day ${progOn ? "" : "dim"}">
        <div class="dayhead"><span>Aujourd'hui · ${this._daysLabel()}</span>
          <span>${inSlot ? "Dans une plage" : "Hors plage"}${next ? ` · prochain changement ${next.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}</span></div>
        <div class="timeline">${bars}<div class="nowmark" style="left:${(minsNow / 1440) * 100}%"></div></div>
        <div class="ticks"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>
        <div class="pls-wrap">${cards || `<div class="muted">Aucune plage aujourd'hui</div>`}</div>
      </div>
      <button class="dashed" data-action="edit"><ha-icon icon="mdi:calendar-edit"></ha-icon> ${this._editor ? "Fermer l'éditeur" : "Modifier les plages horaires"}</button>`;
  }

  /* ---------- éditeur de plages ---------- */
  _openEditor() {
    if (!this._sched) return;
    const days = {};
    DAYS.forEach((d) => (days[d] = (this._sched[d] || []).map((s) => ({ from: hhmm(s.from), to: hhmm(s.to) }))));
    const same = DAYS.every((d) => JSON.stringify(days[d]) === JSON.stringify(days.monday));
    this._editor = { days, sel: same ? [...DAYS] : [DAYS[(new Date().getDay() + 6) % 7]], err: "", saving: false };
    this._renderEditor();
  }
  _renderEditor() {
    const el = this.shadowRoot.getElementById("editor");
    const ed = this._editor;
    if (!ed) {
      el.innerHTML = "";
      return;
    }
    const ref = ed.sel[0];
    const slots = ed.days[ref];
    el.innerHTML = `
      <div class="section ed">
        <div class="stitle">Plages horaires</div>
        <div class="muted">Jours modifiés ensemble :</div>
        <div class="daysel">
          ${DAYS.map((d, i) => `<button class="dchip ${ed.sel.includes(d) ? "sel" : ""}" data-action="ed-day" data-v="${d}" title="${DAY_LONG[i]}">${DAY_SHORT[i]}</button>`).join("")}
          <button class="dchip wide" data-action="ed-all">Tous</button>
        </div>
        <div class="slots">
          ${slots
            .map(
              (s, i) => `<div class="srow">
              <input type="time" step="300" value="${s.from}" data-ed="from" data-i="${i}">
              <span>→</span>
              <input type="time" step="300" value="${s.to}" data-ed="to" data-i="${i}">
              <button class="round sm" data-action="ed-del" data-i="${i}" aria-label="Supprimer">✕</button>
            </div>`
            )
            .join("") || `<div class="muted">Aucune plage : le poêle ne s'allumera pas ces jours-là (mode horaire).</div>`}
        </div>
        <button class="dashed sm" data-action="ed-add">+ Ajouter une plage</button>
        ${ed.err ? `<div class="err">${esc(ed.err)}</div>` : ""}
        <div class="edbtns">
          <button class="btn" data-action="ed-cancel">Annuler</button>
          <button class="btn primary" data-action="ed-save" ${ed.saving ? "disabled" : ""}>${ed.saving ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </div>`;
  }
  _edApply(slots) {
    const ed = this._editor;
    ed.sel.forEach((d) => (ed.days[d] = slots.map((s) => ({ ...s }))));
  }
  async _edSave() {
    const ed = this._editor;
    const toMin = (t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    for (const d of DAYS) {
      const list = ed.days[d].slice().sort((a, b) => toMin(a.from) - toMin(b.from));
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!s.from || !s.to || (toMin(s.to) <= toMin(s.from) && s.to !== "00:00")) {
          ed.err = `Plage invalide le ${DAY_LONG[DAYS.indexOf(d)]} (${s.from} → ${s.to}).`;
          return this._renderEditor();
        }
        if (i > 0 && toMin(s.from) < toMin(list[i - 1].to)) {
          ed.err = `Plages qui se chevauchent le ${DAY_LONG[DAYS.indexOf(d)]}.`;
          return this._renderEditor();
        }
      }
      ed.days[d] = list;
    }
    ed.err = "";
    ed.saving = true;
    this._renderEditor();
    const payload = { type: "schedule/update", schedule_id: this._sched.id, name: this._sched.name };
    if (this._sched.icon) payload.icon = this._sched.icon;
    DAYS.forEach((d) => (payload[d] = ed.days[d].map((s) => ({ from: s.from + ":00", to: s.to + ":00" }))));
    try {
      await this._hass.callWS(payload);
      this._editor = null;
      this._renderEditor();
      await this._loadSchedule();
    } catch (e) {
      ed.saving = false;
      ed.err = "Échec de l'enregistrement : " + (e.message || e.code || e);
      this._renderEditor();
    }
  }

  /* ---------- suivi ---------- */
  _renderSuivi() {
    const el = this.shadowRoot && this.shadowRoot.getElementById("suivi");
    if (!el || !this._hass) return;
    const h = this._hist;
    let chart = `<div class="muted">Chargement de l'historique…</div>`;
    let ignitions = "—", heatHours = "—";
    if (h) {
      const W = 600, H = 150, L = 30, R = 8, T = 10, B = 22;
      const x = (t) => L + ((t - h.start) / (h.end - h.start)) * (W - L - R);
      const nums = (arr) => arr.map((p) => ({ t: Math.max(p.t, h.start), v: parseFloat(p.v) })).filter((p) => !isNaN(p.v));
      const room = nums(h.room), sp = nums(h.sp);
      const all = [...room, ...sp].map((p) => p.v);
      let lo = all.length ? Math.floor(Math.min(...all) - 0.5) : 15;
      let hi = all.length ? Math.ceil(Math.max(...all) + 0.5) : 25;
      if (hi - lo < 3) hi = lo + 3;
      const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
      const line = (arr, step) => {
        if (!arr.length) return "";
        let d = `M ${x(arr[0].t).toFixed(1)} ${y(arr[0].v).toFixed(1)}`;
        for (let i = 1; i < arr.length; i++) {
          if (step) d += ` H ${x(arr[i].t).toFixed(1)}`;
          d += ` L ${x(arr[i].t).toFixed(1)} ${y(arr[i].v).toFixed(1)}`;
        }
        d += ` H ${x(h.end).toFixed(1)}`;
        return d;
      };
      // périodes de chauffe
      let bands = "", heatMs = 0, ign = 0, prev = null;
      const st = h.st.map((p) => ({ t: Math.max(p.t, h.start), ph: phase(p.v).key }));
      st.forEach((p, i) => {
        const tEnd = i + 1 < st.length ? st[i + 1].t : h.end;
        if (["heat", "ignite", "clean"].includes(p.ph)) {
          bands += `<rect x="${x(p.t).toFixed(1)}" y="${T}" width="${Math.max(0.5, x(tEnd) - x(p.t)).toFixed(1)}" height="${H - T - B}" class="band"/>`;
          heatMs += tEnd - p.t;
        }
        if (p.ph === "ignite" && prev !== "ignite") ign++;
        prev = p.ph;
      });
      ignitions = String(ign);
      heatHours = fmt(heatMs / 3600000, 1) + " h";
      let grid = "";
      for (let v = lo; v <= hi; v += hi - lo > 6 ? 2 : 1) {
        grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 3}" class="axis" text-anchor="end">${v}</text>`;
      }
      let xt = "";
      const first = new Date(h.start);
      first.setMinutes(0, 0, 0);
      for (let t = first.getTime() + 3600000; t < h.end; t += 3600000) {
        const hr = new Date(t).getHours();
        if (hr % 6 === 0) xt += `<text x="${x(t)}" y="${H - 6}" class="axis" text-anchor="middle">${hr}h</text>`;
      }
      chart = `
        <svg viewBox="0 0 ${W} ${H}" class="chart" data-action="more" data-e="${this._cfg[this._roomKey()]}">
          ${bands}${grid}${xt}
          <path d="${line(sp, true)}" class="lsp"/>
          <path d="${line(room, false)}" class="lroom"/>
        </svg>
        <div class="legend"><span class="lg room"></span>T° ambiante <span class="lg sp"></span>T° réglée <span class="lg band"></span>Poêle en marche</div>`;
    }
    el.innerHTML = `
      <div class="stitle">Suivi 24 h</div>
      ${chart}
      <div class="tiles">
        <div class="tile"><ha-icon icon="mdi:fire"></ha-icon><div class="tl">Allumages</div><div class="tv">${ignitions}</div></div>
        <div class="tile"><ha-icon icon="mdi:clock-outline"></ha-icon><div class="tl">Temps de chauffe</div><div class="tv">${heatHours}</div></div>
        <div class="tile" data-action="more" data-e="${this._cfg.fumes}"><ha-icon icon="mdi:smoke"></ha-icon><div class="tl">Fumées</div><div class="tv">${fmt(this._n("fumes"), 0)} °C</div></div>
      </div>`;
  }

  /* ---------- infos techniques ---------- */
  _renderTech() {
    const el = this.shadowRoot.getElementById("tech");
    const wifi = this._n("wifi");
    const ip = this._s("ip");
    const up = this._s("uptime");
    const ver = this._s("version");
    const sw = this._s("switch");
    const online = sw && sw.state !== "unavailable";
    const upTxt = up && !isNaN(Date.parse(up.state)) ? new Date(up.state).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";
    const q = wifi === null ? "—" : wifi > -60 ? "excellent" : wifi > -70 ? "bon" : wifi > -80 ? "faible" : "très faible";
    el.innerHTML = `
      <button class="tech-toggle" data-action="tech">
        <span><ha-icon icon="mdi:chip"></ha-icon> Infos techniques</span>
        <span class="dot ${online ? "ok" : "ko"}"></span>
        <ha-icon icon="${this._techOpen ? "mdi:chevron-up" : "mdi:chevron-down"}"></ha-icon>
      </button>
      ${
        this._techOpen
          ? `<div class="rows">
        <div class="row" data-action="more" data-e="${this._cfg.fumes}"><span>Température fumées</span><b>${fmt(this._n("fumes"), 0)} °C</b></div>
        <div class="row" data-action="more" data-e="${this._cfg.power}"><span>Puissance réelle</span><b>P${fmt(this._n("power"), 0)}</b></div>
        <div class="row" data-action="more" data-e="${this._cfg.wifi}"><span>Signal wifi du module</span><b>${fmt(wifi, 0)} dBm · ${q}</b></div>
        <div class="row"><span>Adresse IP</span><b>${esc(ip ? ip.state : "—")}</b></div>
        <div class="row"><span>Dernier redémarrage ESP</span><b>${upTxt}</b></div>
        <div class="row"><span>Version ESPHome</span><b>${esc(ver ? ver.state.split(" ")[0] : "—")}</b></div>
        <div class="row" data-action="more" data-e="${this._cfg.automation}"><span>Automatisation de programmation</span><b>${this._s("automation") && this._s("automation").state === "on" ? "active" : "inactive"}</b></div>
      </div>`
          : ""
      }`;
  }

  /* ---------- événements ---------- */
  _onChange(ev) {
    const t = ev.target;
    if (t.dataset.ed && this._editor) {
      const ed = this._editor;
      const slots = ed.days[ed.sel[0]].map((s) => ({ ...s }));
      slots[+t.dataset.i][t.dataset.ed] = t.value;
      this._edApply(slots);
    }
  }

  _onClick(ev) {
    const btn = ev.composedPath().find((n) => n.dataset && n.dataset.action);
    if (!btn) return;
    const a = btn.dataset.action;
    const c = this._cfg;
    switch (a) {
      case "power": {
        const sw = this._s("switch");
        if (Date.now() < this._confirmUntil) {
          this._confirmUntil = 0;
          this._call("switch", sw && sw.state === "on" ? "turn_off" : "turn_on", { entity_id: c.switch });
        } else {
          this._confirmUntil = Date.now() + 4000;
          setTimeout(() => this._renderTop(), 4100);
        }
        this._renderTop();
        break;
      }
      case "flame":
        this._pendingFlame = Number(btn.dataset.v);
        this._pendingFlameAt = Date.now();
        this._renderTop();
        this._call("number", "set_value", { entity_id: c.flame, value: this._pendingFlame });
        clearTimeout(this._flameTimer);
        this._flameTimer = setTimeout(() => this._renderTop(), 30500);
        break;
      case "sp+":
      case "sp-": {
        const st = this._s("setpoint");
        if (!st) break;
        const stp = Number(st.attributes.step) || 0.5;
        const cur = this._pendingSp ?? parseFloat(st.state);
        const v = Math.max(Number(st.attributes.min), Math.min(Number(st.attributes.max), cur + (a === "sp+" ? stp : -stp)));
        this._pendingSp = v;
        this._renderTop();
        clearTimeout(this._spTimer);
        this._spTimer = setTimeout(async () => {
          await this._call("input_number", "set_value", { entity_id: c.setpoint, value: this._pendingSp });
          this._pendingSp = null;
        }, 900);
        break;
      }
      case "prog":
        this._call("input_boolean", "toggle", { entity_id: c.prog });
        break;
      case "mode":
        this._call("input_select", "select_option", { entity_id: c.mode, option: btn.dataset.v });
        break;
      case "edit":
        if (this._editor) {
          this._editor = null;
          this._renderEditor();
        } else this._openEditor();
        this._renderProg();
        break;
      case "ed-day": {
        const ed = this._editor;
        const d = btn.dataset.v;
        if (ed.sel.includes(d)) {
          if (ed.sel.length > 1) ed.sel = ed.sel.filter((x) => x !== d);
        } else {
          ed.sel = [...ed.sel, d];
          ed.days[d] = ed.days[ed.sel[0]].map((s) => ({ ...s }));
        }
        this._renderEditor();
        break;
      }
      case "ed-all": {
        const ed = this._editor;
        const src = ed.days[ed.sel[0]];
        ed.sel = [...DAYS];
        this._edApply(src);
        this._renderEditor();
        break;
      }
      case "ed-add": {
        const ed = this._editor;
        const slots = ed.days[ed.sel[0]].map((s) => ({ ...s }));
        const last = slots[slots.length - 1];
        let from = "19:00", to = "21:00";
        if (last) {
          const [hh, mm] = last.to.split(":").map(Number);
          const f = Math.min(22 * 60, hh * 60 + mm + 60);
          from = `${String(Math.floor(f / 60)).padStart(2, "0")}:${String(f % 60).padStart(2, "0")}`;
          to = `${String(Math.min(23, Math.floor(f / 60) + 1)).padStart(2, "0")}:${String(f % 60).padStart(2, "0")}`;
        }
        slots.push({ from, to });
        this._edApply(slots);
        this._renderEditor();
        break;
      }
      case "ed-del": {
        const ed = this._editor;
        const slots = ed.days[ed.sel[0]].filter((_, i) => i !== +btn.dataset.i);
        this._edApply(slots);
        this._renderEditor();
        break;
      }
      case "ed-cancel":
        this._editor = null;
        this._renderEditor();
        this._renderProg();
        break;
      case "ed-save":
        this._edSave().then(() => this._renderProg());
        break;
      case "tech":
        this._techOpen = !this._techOpen;
        this._renderTech();
        break;
      case "more":
        this._moreInfo(btn.dataset.e);
        break;
      case "arc":
        this._moreInfo(c.setpoint);
        break;
    }
  }
}

PoeleCard.styles = `
  :host { display: block; container-type: inline-size; padding: 12px 16px 16px; --pc-accent: #ff7a1a; --pc-accent-soft: rgba(255,122,26,.16); --pc-radius: 16px; }
  ha-card { padding: 18px 18px 8px; overflow: hidden; max-width: 1600px; margin: 0 auto; border-radius: 20px; }
  @media (max-width: 600px) { :host { padding: 8px 8px 12px; } }
  #top, #prog, #editor, #suivi, #tech { min-width: 0; }
  button { font: inherit; color: inherit; cursor: pointer; border: none; background: none; }
  ha-icon { --mdc-icon-size: 20px; }
  .muted { color: var(--secondary-text-color); font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .title { font-size: 22px; font-weight: 600; }
  .sub { margin-top: 4px; color: var(--primary-text-color); display: flex; align-items: center; gap: 4px; }
  .sub ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
  .phase { margin-top: 6px; font-weight: 600; font-size: 17px; }
  .chip { display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px;
    background: var(--secondary-background-color); font-weight: 600; font-size: 13px; white-space: nowrap; }
  .chip ha-icon { --mdc-icon-size: 18px; }
  .hero { display: grid; grid-template-columns: minmax(110px, 0.85fr) 1.15fr; gap: 10px; align-items: center; margin-top: 4px; }
  .stovewrap { display: flex; flex-direction: column; align-items: center; }
  .stove { width: 100%; max-width: 112px; max-height: 280px; overflow: visible; }
  .stove.on { filter: drop-shadow(0 0 16px rgba(255,122,26,.35)); }
  .stove .bar { fill: none; stroke: url(#pcChrome); stroke-width: 1.5; stroke-linecap: round; }
  .flames { transform-origin: 74px 184px; transform: scale(var(--fs)); transition: transform 1.2s ease; }
  .f { transform-origin: 74px 184px; }
  .f1 { fill: #ff5a00; animation: flick 1.6s ease-in-out infinite; }
  .f2 { fill: #ffa21a; animation: flick 1.1s ease-in-out infinite reverse; }
  .f3 { fill: #ffe27a; animation: flick .8s ease-in-out infinite; }
  @keyframes flick { 0%,100% { transform: scale(1,1) skewX(0); } 30% { transform: scale(.94,1.08) skewX(2deg); } 60% { transform: scale(1.05,.93) skewX(-2deg); } }
  .firebox { animation: fbox 2.4s ease-in-out infinite; }
  @keyframes fbox { 0%,100% { opacity: 1; } 50% { opacity: .8; } }
  .spill { opacity: var(--gl); animation: spill 3s ease-in-out infinite; }
  @keyframes spill { 0%,100% { opacity: var(--gl); } 50% { opacity: calc(var(--gl) * .7); } }
  .embers ellipse { fill: #5a1e08; opacity: .7; }
  .smoke path { fill: none; stroke: var(--secondary-text-color); stroke-width: 1.6; stroke-linecap: round; opacity: 0; animation: rise 3.2s ease-out infinite; }
  .s2 { animation-delay: 1s !important; } .s3 { animation-delay: 2s !important; }
  @keyframes rise { 0% { opacity: 0; transform: translateY(6px); } 30% { opacity: .4; } 100% { opacity: 0; transform: translateY(-10px); } }
  .lcd { margin-top: 2px; font-family: ui-monospace, Menlo, monospace; font-size: 11px; padding: 2px 7px; border-radius: 4px;
    background: #0e2a22; color: #6ff0b5; border: 1px solid #2a5c4a; letter-spacing: .5px; }
  .gauge { text-align: center; position: relative; }
  .cur { color: var(--secondary-text-color); font-size: 13px; line-height: 1.35; }
  .cur b { color: var(--primary-text-color); font-size: 17px; }
  .gauge svg { width: 100%; max-width: 230px; margin-top: -2px; cursor: pointer; }
  .track { fill: none; stroke: var(--divider-color, rgba(127,127,127,.25)); stroke-width: 14; stroke-linecap: round; }
  .fill { fill: none; stroke-width: 14; stroke-linecap: round; opacity: .85; transition: all .4s; }
  .handle { fill: var(--card-background-color, #fff); stroke-width: 6; }
  .roomdot { fill: var(--primary-text-color); stroke: var(--card-background-color, #fff); stroke-width: 2; }
  .verb { text-anchor: middle; font-size: 13px; font-weight: 600; fill: var(--primary-text-color); }
  .spbig { text-anchor: middle; font-size: 50px; font-weight: 400; fill: var(--primary-text-color); }
  .unit, .dec { font-size: 16px; fill: var(--primary-text-color); }
  .pm { display: flex; justify-content: center; gap: 18px; margin-top: -38px; position: relative; }
  .round { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--divider-color, rgba(127,127,127,.35));
    font-size: 22px; line-height: 1; display: grid; place-items: center; background: var(--card-background-color); }
  .round:active { transform: scale(.94); }
  .round.sm { width: 32px; height: 32px; font-size: 14px; }
  .info { text-align: center; color: var(--secondary-text-color); font-size: 13px; margin: 10px 0 2px; }
  .actions { display: grid; grid-template-columns: 1fr 1.25fr; gap: 10px; margin: 12px 0 14px; }
  .big { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-radius: var(--pc-radius); font-weight: 600; font-size: 15px;
    background: var(--secondary-background-color); text-align: left; }
  .big ha-icon { --mdc-icon-size: 22px; }
  .big.on { background: var(--pc-accent-soft); color: var(--pc-accent); }
  .big.confirm { outline: 2px solid var(--pc-accent); }
  .flamebox { background: var(--secondary-background-color); border-radius: var(--pc-radius); padding: 8px 10px; }
  .lbl { font-size: 12px; color: var(--secondary-text-color); display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
  .lbl ha-icon { --mdc-icon-size: 16px; }
  .segs { display: flex; gap: 4px; }
  .seg { flex: 1; padding: 7px 0; border-radius: 10px; font-weight: 600; font-size: 13px; background: var(--card-background-color); }
  .seg.sel { background: var(--pc-accent); color: #fff; }
  .seg.pending { animation: pcpend 1s ease-in-out infinite; }
  @keyframes pcpend { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
  .section { border-top: 1px solid var(--divider-color, rgba(127,127,127,.2)); margin: 0 -18px; padding: 14px 18px; }
  .shead { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; }
  .stitle { font-size: 17px; font-weight: 600; margin-bottom: 8px; }
  .shead .stitle { margin: 0; }
  .pill { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; font-weight: 600; font-size: 13px;
    background: var(--secondary-background-color); color: var(--secondary-text-color); }
  .pill.ok { background: rgba(48,164,108,.15); color: #30a46c; }
  .pill ha-icon { --mdc-icon-size: 18px; }
  .modes { margin-bottom: 12px; }
  .modes .seg { background: var(--secondary-background-color); padding: 9px 0; }
  .modes .seg.sel { background: var(--pc-accent-soft); color: var(--pc-accent); }
  .dim { opacity: .45; }
  .day { background: var(--secondary-background-color); border-radius: var(--pc-radius); padding: 12px; }
  .dayhead { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px; font-size: 12px; color: var(--secondary-text-color); margin-bottom: 8px; }
  .timeline { position: relative; height: 14px; border-radius: 7px; background: var(--card-background-color); overflow: hidden; }
  .slot { position: absolute; top: 0; bottom: 0; background: rgba(255,122,26,.45); border-radius: 4px; }
  .slot.act { background: var(--pc-accent); }
  .nowmark { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--primary-text-color); }
  .ticks { display: flex; justify-content: space-between; font-size: 10px; color: var(--secondary-text-color); margin: 3px 0 10px; }
  .pls-wrap { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
  .pl { background: var(--card-background-color); border-radius: 12px; padding: 8px 10px; border: 1px solid transparent; }
  .pl.act { border-color: var(--pc-accent); background: var(--pc-accent-soft); }
  .pl.done { opacity: .55; }
  .plt { font-weight: 600; font-size: 14px; }
  .pls { font-size: 12px; color: var(--secondary-text-color); margin-top: 2px; }
  .dashed { width: 100%; margin-top: 12px; padding: 11px; border-radius: 12px; border: 1.5px dashed var(--pc-accent); color: var(--pc-accent);
    font-weight: 600; display: flex; justify-content: center; align-items: center; gap: 8px; }
  .dashed.sm { padding: 8px; margin-top: 8px; }
  .ed { background: var(--secondary-background-color); border-top: none; }
  .daysel { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 12px; }
  .dchip { width: 36px; height: 36px; border-radius: 50%; font-weight: 600; background: var(--card-background-color); }
  .dchip.sel { background: var(--pc-accent); color: #fff; }
  .dchip.wide { width: auto; padding: 0 14px; border-radius: 18px; }
  .slots { display: flex; flex-direction: column; gap: 8px; }
  .srow { display: flex; align-items: center; gap: 8px; }
  .srow input { flex: 1; min-width: 0; font: inherit; padding: 8px; border-radius: 10px; border: 1px solid var(--divider-color, #ccc);
    background: var(--card-background-color); color: var(--primary-text-color); color-scheme: light dark; }
  .err { color: #e5484d; font-size: 13px; margin-top: 8px; }
  .edbtns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .btn { padding: 9px 16px; border-radius: 10px; font-weight: 600; background: var(--card-background-color); }
  .btn.primary { background: var(--pc-accent); color: #fff; }
  .btn[disabled] { opacity: .6; }
  .big.offline { opacity: .55; cursor: not-allowed; border-style: dashed; }
  .chart { width: 100%; height: auto; cursor: pointer; }
  .grid { stroke: var(--divider-color, rgba(127,127,127,.2)); stroke-dasharray: 3 4; }
  .axis { font-size: 12px; fill: var(--secondary-text-color); }
  .band { fill: rgba(255,122,26,.13); }
  .lroom { fill: none; stroke: var(--pc-accent); stroke-width: 2.2; stroke-linejoin: round; }
  .lsp { fill: none; stroke: #4c9aff; stroke-width: 2; stroke-dasharray: 5 4; }
  .legend { display: flex; gap: 8px 14px; flex-wrap: wrap; justify-content: center; font-size: 12px; color: var(--secondary-text-color); margin-top: 4px; align-items: center; }
  .lg { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-right: -8px; }
  .lg.room { background: var(--pc-accent); } .lg.sp { background: #4c9aff; } .lg.band { height: 10px; background: rgba(255,122,26,.3); }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
  .tile { background: var(--secondary-background-color); border-radius: 14px; padding: 10px 6px; text-align: center; }
  .tile[data-action] { cursor: pointer; }
  .tile ha-icon { color: var(--pc-accent); }
  .tl { font-size: 12px; color: var(--secondary-text-color); margin-top: 4px; }
  .tv { font-weight: 700; font-size: 16px; margin-top: 2px; }
  .tech-toggle { width: 100%; display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; padding: 2px 0; }
  .tech-toggle > span:first-child { flex: 1; text-align: left; display: flex; align-items: center; gap: 6px; }
  .tech-toggle ha-icon { color: var(--secondary-text-color); }
  .dot { width: 9px; height: 9px; border-radius: 50%; }
  .dot.ok { background: #30a46c; } .dot.ko { background: #e5484d; }
  .rows { margin-top: 8px; }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; font-size: 14px; border-bottom: 1px solid var(--divider-color, rgba(127,127,127,.15)); }
  .row:last-child { border-bottom: none; }
  .row[data-action] { cursor: pointer; }
  .row span { color: var(--secondary-text-color); }
  .row b { font-weight: 600; text-align: right; }
  @media (max-width: 420px) {
    .hero { grid-template-columns: 0.8fr 1.2fr; }
    .big { padding: 12px; font-size: 14px; }
    .actions { grid-template-columns: 1fr; }
  }
  /* ---- écrans larges : colonnes ---- */
  @container (min-width: 860px) {
    ha-card { padding: 0; display: grid; grid-template-columns: 1fr 1fr; align-items: start;
      grid-template-areas: "top prog" "top editor" "suivi tech"; grid-template-rows: auto 1fr auto; }
    #top { grid-area: top; padding: 20px 22px 6px; }
    #prog { grid-area: prog; } #editor { grid-area: editor; } #suivi { grid-area: suivi; } #tech { grid-area: tech; }
    .section { margin: 0; padding: 18px 22px; border-top: none; }
    .ed { margin: 0; }
    #prog, #editor, #tech { border-left: 1px solid var(--divider-color, rgba(127,127,127,.2)); align-self: stretch; }
    #suivi, #tech { border-top: 1px solid var(--divider-color, rgba(127,127,127,.2)); align-self: stretch; }
    .actions { margin-bottom: 18px; }
  }
  @container (min-width: 1150px) {
    ha-card { grid-template-columns: 1.05fr 1fr 1fr; grid-template-areas: "top prog suivi" "top editor tech"; grid-template-rows: auto 1fr; }
    #suivi { border-top: none; border-left: 1px solid var(--divider-color, rgba(127,127,127,.2)); }
    #tech { border-top: 1px solid var(--divider-color, rgba(127,127,127,.2)); }
    #editor:empty { display: none; }
  }
`;

if (!customElements.get("poele-card")) {
  customElements.define("poele-card", PoeleCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: "poele-card", name: "Carte Poêle", description: "Poêle à granulés Micronova (ESPHome)", preview: false });
  console.info(`%c POELE-CARD %c v${PC_VERSION} `, "background:#ff7a1a;color:#fff;font-weight:700", "");
}
