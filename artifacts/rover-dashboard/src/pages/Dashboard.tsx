import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  IconPlant2, IconCpu, IconAntenna, IconRipple, IconTemperature,
  IconDroplets, IconCloudRain, IconDropletFilled, IconFlask,
  IconBrain, IconAdjustmentsHorizontal, IconPlant, IconMoodSmile,
  IconMoodEmpty, IconMoodSad, IconChartLine, IconCalendarEvent,
  IconListCheck, IconChartBar, IconRefresh, IconPlayerPlay,
  IconPlayerStop, IconReload, IconSunHigh, IconCloudStorm,
  IconSun, IconLeaf, IconWind, IconThermometer, IconDropletHalf,
  IconArrowsShuffle, IconTestPipe, IconClock, IconHome2,
} from "@tabler/icons-react";

// ── types ──
interface CropProfile {
  min: number; max: number; severeMoisture: number; severeTemp: number;
  idealTemp: number; humidityMin: number; humidityMax: number;
  pumpBoost: number; fertBoost: number; npkMin: number; npkMax: number;
  name: string; dailyWaterMl: number; fertIntervalH: number; overWaterRisk: number;
}
interface AIResult {
  wProb: number; fProb: number; wDur: number; fDur: number;
  decision: string; reason: string; conf: number; decMode: string;
  isWater: boolean; isFert: boolean; deficit: number; npkDeficit: number;
  drought: boolean; overwater: boolean; rainOv: boolean; battLow: boolean;
  excess: number; moistureDelta: number; npkDelta: number; hour: number;
}
interface LogEntry { time: string; msg: string; dot: string; }
interface GHState {
  light: string; lightSt: string; lightStCls: string;
  co2: string; co2St: string; co2StCls: string;
  vpd: string; vpdSt: string; vpdStCls: string;
  canopy: string; canopySt: string; canopyStCls: string;
  moisture: string; moistureSt: string; moistureStCls: string;
  airflow: string; airflowSt: string; airflowStCls: string;
  ec: string; ecSt: string; ecStCls: string;
  dli: string; dliSt: string; dliStCls: string;
}

// ── crop profiles ──
const CROPS: Record<string, CropProfile> = {
  tomato:    { min:40,max:60,severeMoisture:18,severeTemp:36,idealTemp:26,humidityMin:55,humidityMax:75,pumpBoost:12,fertBoost:8, npkMin:50,npkMax:80,name:"Tomato",    dailyWaterMl:800, fertIntervalH:48,overWaterRisk:0.7 },
  capsicum:  { min:45,max:65,severeMoisture:22,severeTemp:34,idealTemp:24,humidityMin:60,humidityMax:80,pumpBoost:10,fertBoost:7, npkMin:55,npkMax:80,name:"Capsicum",  dailyWaterMl:650, fertIntervalH:60,overWaterRisk:0.8 },
  cucumber:  { min:55,max:75,severeMoisture:30,severeTemp:35,idealTemp:27,humidityMin:70,humidityMax:90,pumpBoost:16,fertBoost:10,npkMin:60,npkMax:85,name:"Cucumber",  dailyWaterMl:1100,fertIntervalH:36,overWaterRisk:0.6 },
  lettuce:   { min:60,max:80,severeMoisture:40,severeTemp:30,idealTemp:20,humidityMin:65,humidityMax:85,pumpBoost:8, fertBoost:5, npkMin:45,npkMax:70,name:"Lettuce",   dailyWaterMl:500, fertIntervalH:72,overWaterRisk:0.9 },
  strawberry:{ min:50,max:70,severeMoisture:28,severeTemp:32,idealTemp:22,humidityMin:65,humidityMax:80,pumpBoost:14,fertBoost:9, npkMin:55,npkMax:80,name:"Strawberry",dailyWaterMl:700, fertIntervalH:48,overWaterRisk:0.75},
};

const INIT_HIST_M = [58,55,52,49,47,45,43,41,39,37,36,38,41,44,47,49,47,45,43,42];
const INIT_HIST_T = [24,25,25,26,26,27,27,28,28,29,30,29,29,28,28,28,28,29,28,28];
const INIT_HIST_N = [48,47,46,46,45,45,45,44,44,44,44,45,45,45,46,46,45,45,45,45];

function buildChartData(hm: number[], ht: number[], hn: number[]) {
  return hm.map((m, i) => ({ label: i === 19 ? "now" : `${i - 19}m`, m, t: ht[i], n: hn[i] }));
}

const STATUS_BADGE_STANDBY: React.CSSProperties = {
  marginLeft: "auto", fontSize: 10, padding: "2px 9px", borderRadius: 99,
  background: "#232D3A", color: "#6E7A8A", border: ".5px solid #313C4A",
};
const STATUS_BADGE_WATER_ON: React.CSSProperties = {
  marginLeft: "auto", fontSize: 10, padding: "2px 9px", borderRadius: 99,
  background: "#123325", color: "#7BFFAF", border: ".5px solid #2D9E67",
};
const STATUS_BADGE_FERT_ON: React.CSSProperties = {
  marginLeft: "auto", fontSize: 10, padding: "2px 9px", borderRadius: 99,
  background: "#1C1A36", color: "#C4BCFF", border: ".5px solid #7F77DD",
};

// ── AI engine ──
function runAI(m: number, t: number, h: number, r: number, bRaw: number, npk: number,
               crop: string, waterOn: boolean, waterTank: number, fertTank: number,
               dispMode: string, histM: number[], histN: number[], ghSimTime: number): AIResult {
  const cd = CROPS[crop];
  const b = bRaw / 10;
  const deficit = Math.max(0, cd.min - m);
  const excess = Math.max(0, m - cd.max);
  const rainOv = r >= 80;
  const rainLight = r >= 50 && r < 80;
  const battLow = b < 3.3;
  const battCritical = b < 3.1;
  const tankEmpty = waterTank < 2;
  const fertTankEmpty = fertTank < 2;

  const recentM = histM.slice(-5);
  const moistureDelta = recentM.length > 1 ? (recentM[recentM.length-1] - recentM[0]) / (recentM.length-1) : 0;
  const dryingFast = moistureDelta < -1.5;
  const recentN = histN.slice(-5);
  const npkDelta = recentN.length > 1 ? (recentN[recentN.length-1] - recentN[0]) / (recentN.length-1) : 0;
  const depletingFast = npkDelta < -0.8;
  const hour = (6 + ghSimTime / 60) % 24;
  const isDawn = hour >= 5.5 && hour < 8;
  const isNight = hour >= 21 || hour < 5;
  const isPeakHeat = hour >= 12 && hour < 15;

  let wProb = Math.min(99, Math.max(1,
    28 + deficit*2.8 + (t - cd.idealTemp)*1.4 - h*0.22 - r*0.12
    + (dryingFast ? 15 : 0) - excess*3 + (isPeakHeat ? 8 : 0) - (isNight ? 18 : 0) + (isDawn ? 10 : 0)
  ));
  if (rainOv)    wProb = Math.max(1, wProb - 70);
  if (rainLight) wProb = Math.max(1, wProb - 25);
  if (battLow)   wProb = Math.min(wProb, 12);
  if (tankEmpty) wProb = 0;
  if (excess > 5) wProb = Math.min(wProb, 8);

  const npkDeficit = Math.max(0, cd.npkMin - npk);
  let fProb = Math.min(99, Math.max(1,
    15 + npkDeficit*1.8 + (t - cd.idealTemp)*0.6 + (depletingFast ? 12 : 0)
    - (rainOv ? 60 : 0) - (rainLight ? 20 : 0) + (waterOn ? 5 : 0)
  ));
  if (battLow || rainOv) fProb = Math.min(fProb, 8);
  if (fertTankEmpty) fProb = 0;
  if (npk > cd.npkMax) fProb = Math.min(fProb, 6);

  const drought = m < cd.severeMoisture && t > cd.severeTemp && h < cd.humidityMin;
  if (drought && !rainOv && !battLow) wProb = Math.min(99, wProb + 30);
  const overwater = m > cd.max + 8;
  if (overwater) wProb = Math.min(3, wProb);

  let wDur = 0, fDur = 0;
  if (!rainOv && !battCritical && !tankEmpty) {
    wDur = Math.max(4, Math.round(deficit*1.3 + (t-cd.idealTemp)*0.7 + Math.max(0,(cd.humidityMin-h)*0.18) + (drought ? cd.pumpBoost : 0)));
    if (h > cd.humidityMax) wDur = Math.max(0, wDur - 4);
    if (isPeakHeat) wDur += 3;
    if (waterTank < 20) wDur = Math.min(wDur, 8);
    wDur = Math.min(wDur, 35);
  }
  if (!rainOv && !battLow && !fertTankEmpty && fProb > 45) {
    fDur = Math.max(3, Math.round(npkDeficit*0.4 + cd.fertBoost*0.5 + (depletingFast ? 4 : 0)));
    if (fertTank < 20) fDur = Math.min(fDur, 6);
    fDur = Math.min(fDur, 20);
  }
  if (dispMode === "water") fDur = 0;
  if (dispMode === "fert")  wDur = 0;

  const stability = 100 - Math.abs(moistureDelta)*10 - Math.abs(npkDelta)*5;
  const conf = Math.round(Math.min(97, Math.max(55, 60 + Math.abs(wProb-50)*0.4 + (stability < 70 ? -10 : 5) + (drought ? 10 : 0))));

  const isWater = wProb > 55 && dispMode !== "fert" && !tankEmpty;
  const isFert  = fProb > 45 && dispMode !== "water" && !fertTankEmpty;
  let decision = "", reason = "", decMode = "";

  if (battCritical) {
    decision = "CRITICAL LOW BATTERY"; reason = `Voltage ${b.toFixed(1)}V — all pumps disabled`; decMode = "danger";
  } else if (tankEmpty && fertTankEmpty) {
    decision = "Both tanks empty"; reason = "Refill water + fertiliser tanks immediately"; decMode = "danger";
  } else if (tankEmpty) {
    decision = "Water tank empty"; reason = "Irrigation disabled — refill water tank"; decMode = "danger";
  } else if (drought && !rainOv) {
    decision = "⚡ DROUGHT EMERGENCY"; reason = `${cd.name}: critical drought · m=${m}% t=${t}°C h=${h}% — emergency irrigation`; decMode = "danger";
  } else if (rainOv) {
    decision = "Skip — rain override"; reason = `Rain ${r}% — both pumps paused · fertiliser locked`; decMode = "skip";
  } else if (battLow) {
    decision = "Skip — low battery"; reason = `Voltage ${b.toFixed(1)}V below 3.3V · safe mode`; decMode = "danger";
  } else if (overwater) {
    decision = "Overwater protection"; reason = `Moisture ${m}% exceeds ${cd.max+8}% — irrigation locked`; decMode = "skip";
  } else if (isWater && isFert) {
    decision = "Irrigate + Fertilise"; reason = `${cd.name}: deficit ${deficit}% · NPK ${npk} below ${cd.npkMin} · both recommended`; decMode = "irr";
  } else if (isWater) {
    decision = "Irrigate now"; reason = `Deficit ${deficit}% · NPK ${npk} adequate · water only`; decMode = "irr";
  } else if (isFert) {
    decision = "Fertilise now"; reason = `NPK ${npk} below ${cd.npkMin} · moisture OK · fertiliser`; decMode = "irr";
  } else {
    decision = "Wait — monitoring"; reason = `m=${m}% in range · NPK ${npk} ok · stable`; decMode = "wait";
  }

  return { wProb, fProb, wDur, fDur, decision, reason, conf, decMode, isWater, isFert,
           deficit, npkDeficit, drought, overwater, rainOv, battLow, excess, moistureDelta, npkDelta, hour };
}

function computeSchedulePredictions(m: number, t: number, npk: number, r: number, ai: AIResult, crop: string) {
  const cd = CROPS[crop];
  const dryRate = Math.max(0.4, -ai.moistureDelta + (t - cd.idealTemp) * 0.12);
  const npkRate = Math.max(0.1, -ai.npkDelta + 0.08);
  const preds = [];
  let pm = m, pn = npk;
  for (let i = 1; i <= 6; i++) {
    pm = Math.max(0, pm - dryRate * 60);
    pn = Math.max(0, pn - npkRate * 60);
    const needW = pm < cd.min;
    const needF = pn < cd.npkMin;
    const estWaterMl = needW ? Math.round(Math.max(0, cd.min - pm) * cd.dailyWaterMl / 100 * 0.5) : 0;
    const estFertMl  = needF ? Math.round(cd.fertBoost * 3) : 0;
    preds.push({ hour: i, moisture: Math.round(pm), npk: Math.round(pn), needW, needF, estWaterMl, estFertMl });
  }
  return preds;
}

function computeGH(m: number, t: number, h: number, npk: number, ghSimTime: number, waterOn: boolean): GHState {
  const hour = (6 + ghSimTime / 60) % 24;
  const lightBase = Math.max(0, 800 * Math.sin((hour - 6) * Math.PI / 13));
  const ppfd = Math.round(lightBase * (h < 80 ? 1 : 0.85));
  const svp = 0.61078 * Math.exp(17.27 * t / (t + 237.3));
  const vpd = Math.round((svp * (1 - h / 100)) * 100) / 100;
  const vpdOk = vpd > 0.4 && vpd < 1.6;
  const co2 = Math.round(820 + 80 * Math.sin((hour - 6) * Math.PI / 6));
  const canopy = Math.round((t - 2.5 - (m / 30)) * 10) / 10;
  const wet = h > 80 || m > 75;
  const af = (0.3 + Math.random() * 0.3).toFixed(1);
  const ec = Math.round((0.8 + npk * 0.025) * 10) / 10;
  const dli = Math.round(ppfd * 3600 * Math.max(0, Math.min(1, lightBase / 800)) * 0.001 * 10) / 10;
  return {
    light: `${ppfd} μmol`, lightSt: ppfd > 400 ? "Optimal" : ppfd > 150 ? "Low" : "Dark", lightStCls: ppfd > 400 ? "ok" : ppfd > 150 ? "warn" : "bad",
    co2: `${co2} ppm`, co2St: co2 > 700 ? "Good" : co2 > 500 ? "Low" : "Poor", co2StCls: co2 > 700 ? "ok" : co2 > 500 ? "warn" : "bad",
    vpd: `${vpd.toFixed(2)} kPa`, vpdSt: vpdOk ? "Optimal" : vpd < 0.4 ? "Too low" : "High", vpdStCls: vpdOk ? "ok" : "warn",
    canopy: `${canopy}°C`, canopySt: canopy < t - 2 ? "Normal" : "Warm", canopyStCls: canopy < 35 ? "ok" : "warn",
    moisture: wet ? "Wet" : "Dry", moistureSt: wet ? "Watch" : "Safe", moistureStCls: wet ? "warn" : "ok",
    airflow: `${af} m/s`, airflowSt: +af > 0.2 ? "Good" : "Weak", airflowStCls: +af > 0.2 ? "ok" : "warn",
    ec: `${ec}`, ecSt: ec > 1 && ec < 3.5 ? "Optimal" : ec <= 1 ? "Low" : "High", ecStCls: ec > 1 && ec < 3.5 ? "ok" : "warn",
    dli: `${dli}`, dliSt: "Good", dliStCls: "ok",
  };
}

// ── sub-components ──
const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{
    background: "rgba(28,23,18,.92)", backdropFilter: "blur(12px)",
    border: "1px solid rgba(255,220,180,.05)", borderRadius: 22,
    boxShadow: "0 4px 24px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,200,120,.04)",
    padding: "1rem 1.125rem", ...style,
  }}>{children}</div>
);

const CardHd = ({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) => (
  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "#A09080", marginBottom: ".75rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>{left}</div>
    {right}
  </div>
);

const Chip = ({ children, color }: { children: React.ReactNode; color: "green" | "blue" | "amber" | "purple" | "red" }) => {
  const palette = {
    green:  { bg: "#142B1E", color: "#7DFFC2", border: "#2A7A50" },
    blue:   { bg: "#1A2510", color: "#B8E87A", border: "#527826" },
    amber:  { bg: "#2E1E0A", color: "#FFCF7D", border: "#9E6219" },
    purple: { bg: "#2A1408", color: "#FFB07A", border: "#9E4D1A" },
    red:    { bg: "#2E100E", color: "#FF9898", border: "#922020" },
  }[color];
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 99, fontSize: 11, border: `.5px solid ${palette.border}`, background: palette.bg, color: palette.color }}>
      {children}
    </div>
  );
};

const MCard = ({ accent, label, icon, value, valueColor, sub, barPct, barColor }: {
  accent: string; label: string; icon: React.ReactNode; value: string; valueColor: string; sub: string; barPct: number; barColor: string;
}) => (
  <div style={{ background: "rgba(28,23,18,.92)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,220,180,.05)", borderRadius: 22, boxShadow: "0 4px 24px rgba(0,0,0,.4)", padding: "1rem 1.125rem", position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, borderRadius: "4px 0 0 4px", background: accent }} />
    <div style={{ paddingLeft: 10 }}>
      <div style={{ fontSize: 11, color: "#A09080", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>{icon}{label}</div>
      <div style={{ fontSize: 26, fontWeight: 500, lineHeight: 1, marginBottom: 3, color: valueColor }}>{value}</div>
      <div style={{ fontSize: 11, color: "#8A7D72" }}>{sub}</div>
      <div style={{ height: 3, background: "#2E2720", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
        <div style={{ height: 3, borderRadius: 2, background: barColor, width: `${Math.min(100, barPct)}%`, transition: "width .5s ease" }} />
      </div>
    </div>
  </div>
);

const InlineStat = ({ label, value, valueStyle }: { label: string; value: string; valueStyle?: React.CSSProperties }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: ".5px solid rgba(255,200,120,.07)", fontSize: 13, color: "#A09080" }}>
    <span>{label}</span><span style={{ fontWeight: 600, color: "#F2EDE6", ...valueStyle }}>{value}</span>
  </div>
);

const MiniBar = ({ name, pct, color, val, valStyle }: { name: string; pct: number; color: string; val: string; valStyle?: React.CSSProperties }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
    <span style={{ fontSize: 12, color: "#A09080", width: 100, flexShrink: 0 }}>{name}</span>
    <div style={{ flex: 1, background: "#2A2318", borderRadius: 3, height: 7, overflow: "hidden" }}>
      <div style={{ height: 7, borderRadius: 3, background: color, width: `${Math.min(100, pct)}%`, transition: "width .5s" }} />
    </div>
    <span style={{ fontSize: 12, fontWeight: 500, width: 34, textAlign: "right", flexShrink: 0, ...valStyle }}>{val}</span>
  </div>
);

const NutrientGauge = ({ label, value, barPct, barColor, target, valueStyle }: {
  label: string; value: string; barPct: number; barColor: string; target: string; valueStyle?: React.CSSProperties;
}) => (
  <div style={{ flex: 1, background: "#1C1712", border: "1px solid #3A3028", borderRadius: 14, padding: ".75rem", textAlign: "center" }}>
    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", color: "#8A7D72", marginBottom: 5 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 500, ...valueStyle }}>{value}</div>
    <div style={{ background: "#2A2318", borderRadius: 3, height: 5, marginTop: 5, overflow: "hidden" }}>
      <div style={{ height: 5, borderRadius: 3, background: barColor, width: `${Math.min(100, barPct)}%`, transition: "width .5s" }} />
    </div>
    <div style={{ fontSize: 10, color: "#6E7A8A", marginTop: 4 }}>{target}</div>
  </div>
);

const GHItem = ({ icon, iconBg, iconColor, label, val, valColor, st, stCls }: {
  icon: React.ReactNode; iconBg: string; iconColor: string; label: string; val: string; valColor: string; st: string; stCls: "ok" | "warn" | "bad";
}) => {
  const cls = { ok: { color: "#7DFFC2", bg: "rgba(46,158,106,.15)" }, warn: { color: "#FFCF7D", bg: "rgba(196,145,58,.15)" }, bad: { color: "#FF9898", bg: "rgba(200,60,60,.15)" } }[stCls];
  return (
    <div style={{ background: "#1C1712", border: "1px solid rgba(255,200,120,.07)", borderRadius: 10, padding: "7px 10px", display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: iconColor }}>{icon}</div>
      <div>
        <div style={{ fontSize: 10, color: "#8A7D72", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1, color: valColor }}>{val}</div>
        <span style={{ fontSize: 9, marginTop: 1, borderRadius: 99, display: "inline-block", padding: "1px 5px", color: cls.color, background: cls.bg }}>{st}</span>
      </div>
    </div>
  );
};

// ── MAIN COMPONENT ──
export default function Dashboard() {
  // sensor state
  const [moisture, setMoisture] = useState(42);
  const [temp, setTemp] = useState(28);
  const [humidity, setHumidity] = useState(65);
  const [rain, setRain] = useState(12);
  const [battRaw, setBattRaw] = useState(38);
  const [npk, setNpk] = useState(45);

  // crop + mode
  const [crop, setCropState] = useState("tomato");
  const [dispMode, setDispMode] = useState<"water" | "fert" | "both">("water");

  // pump state
  const [waterOn, setWaterOn] = useState(false);
  const [fertOn, setFertOn] = useState(false);
  const [waterTank, setWaterTank] = useState(78);
  const [fertTank, setFertTank] = useState(62);
  const [waterUsed, setWaterUsed] = useState(420);
  const [fertUsed, setFertUsed] = useState(72);

  // live mode
  const [liveOn, setLiveOn] = useState(false);
  const ghSimTimeRef = useRef(0);

  // history
  const histMRef = useRef([...INIT_HIST_M]);
  const histTRef = useRef([...INIT_HIST_T]);
  const histNRef = useRef([...INIT_HIST_N]);
  const [chartData, setChartData] = useState(() => buildChartData(INIT_HIST_M, INIT_HIST_T, INIT_HIST_N));

  // log
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: "09:41:02", msg: "System online — water + fertiliser pumps ready", dot: "#1D9E75" },
    { time: "09:41:05", msg: "Read: moisture 42%, temp 28°C, NPK 45", dot: "#378ADD" },
    { time: "09:41:06", msg: "ML: IRRIGATE + FERTILISE · 89% conf · water 14s · fert 6s", dot: "#639922" },
    { time: "09:41:20", msg: "Fertiliser dose complete — 18 ml dispensed", dot: "#7F77DD" },
    { time: "09:41:34", msg: "Water pump OFF — moisture target reached", dot: "#BA7517" },
  ]);

  // sensor value refs for use inside setIntervals (avoid stale closures)
  const moistureRef = useRef(42);
  const tempRef     = useRef(28);
  const humidityRef = useRef(65);
  const rainRef     = useRef(12);
  const battRawRef  = useRef(38);
  const npkRef      = useRef(45);
  const waterOnRef  = useRef(false);
  const fertOnRef   = useRef(false);
  const waterTankRef = useRef(78);
  const fertTankRef  = useRef(62);
  const cropRef      = useRef("tomato");
  const dispModeRef  = useRef<"water" | "fert" | "both">("water");

  // throttle refs
  const logThrottleRef = useRef<Record<string, number>>({});
  const waterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waterAutoRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fertTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const fertAutoRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const aiCycleRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const waterCooldownRef = useRef(false);
  const fertCooldownRef  = useRef(false);
  const pendingFertRef   = useRef<{ dur: number } | null>(null);

  const addLog = useCallback((msg: string, dot: string) => {
    const now = new Date();
    const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
    setLogs(prev => [{ time, msg, dot }, ...prev].slice(0, 80));
  }, []);

  const addLogThrottled = useCallback((msg: string, dot: string, key: string, cooldownMs = 30000) => {
    const now = Date.now();
    if (logThrottleRef.current[key] && now - logThrottleRef.current[key] < cooldownMs) return;
    logThrottleRef.current[key] = now;
    addLog(msg, dot);
  }, [addLog]);

  // ── sync refs with state (for use inside setIntervals) ──
  moistureRef.current  = moisture;
  tempRef.current      = temp;
  humidityRef.current  = humidity;
  rainRef.current      = rain;
  battRawRef.current   = battRaw;
  npkRef.current       = npk;
  waterOnRef.current   = waterOn;
  fertOnRef.current    = fertOn;
  waterTankRef.current = waterTank;
  fertTankRef.current  = fertTank;
  cropRef.current      = crop;
  dispModeRef.current  = dispMode;

  // ── derived AI ──
  const ai = runAI(moisture, temp, humidity, rain, battRaw, npk, crop, waterOn, waterTank, fertTank, dispMode, histMRef.current, histNRef.current, ghSimTimeRef.current);
  const gh = computeGH(moisture, temp, humidity, npk, ghSimTimeRef.current, waterOn);
  const schedule = computeSchedulePredictions(moisture, temp, npk, rain, ai, crop);
  const cd = CROPS[crop];

  // health score
  const health = Math.round(Math.min(100, Math.max(0,
    .35*(moisture>=cd.min&&moisture<=cd.max?100:Math.max(0,100-Math.abs(moisture-cd.min)*2))+
    .25*(100-Math.abs(temp-cd.idealTemp)*2)+
    .25*(humidity>=cd.humidityMin&&humidity<=cd.humidityMax?100:60)+
    .15*(npk>=cd.npkMin?100:50)
  )));
  const savings = Math.min(99, Math.round(22 + ai.deficit * 0.12));
  const battPct = Math.round(((battRaw - 30) / 12) * 100);
  const stress = ai.drought ? "Severe" : (moisture < cd.min || temp > cd.idealTemp+5 || npk < cd.npkMin-10) ? "Mild" : "Normal";

  const npkN = Math.round(npk * 0.8), npkP = Math.round(npk * 0.55 + 10), npkK = npk;
  const ph = Math.min(8, Math.max(4.5, 6.4 + (npk - 45) * 0.01));
  const fertRec = npk < cd.npkMin ? "Recommend: Low dose NPK 5-3-4" : npk < cd.npkMax ? "NPK balanced — monitor weekly" : "NPK high — skip next dose";
  const dryRate = Math.max(0.3, -ai.moistureDelta + 0.4);
  const minutesToMin = dryRate > 0 ? Math.round((moisture - cd.min) / dryRate) : 120;
  const nextS = Math.max(0, minutesToMin * 60);
  const nextLabel = nextS > 3600 ? `${Math.floor(nextS/3600)}h ${Math.floor((nextS%3600)/60)}m` : nextS > 60 ? `${Math.floor(nextS/60)}m ${nextS%60}s` : `${nextS}s`;

  // ── pump helpers ──
  const stopWaterPump = useCallback((reason: string) => {
    setWaterOn(false);
    if (waterTimerRef.current) { clearInterval(waterTimerRef.current); waterTimerRef.current = null; }
    if (waterAutoRef.current)  { clearTimeout(waterAutoRef.current);  waterAutoRef.current = null; }
    addLog(`Water pump OFF — ${reason}`, "#639922");
    waterCooldownRef.current = true;
    setTimeout(() => { waterCooldownRef.current = false; }, 60000);
  }, [addLog]);

  const stopFertPump = useCallback((reason: string) => {
    setFertOn(false);
    if (fertTimerRef.current) { clearInterval(fertTimerRef.current); fertTimerRef.current = null; }
    if (fertAutoRef.current)  { clearTimeout(fertAutoRef.current);   fertAutoRef.current = null; }
    addLog(`Fertiliser pump OFF — ${reason}`, "#B8A7FF");
    fertCooldownRef.current = true;
    setTimeout(() => { fertCooldownRef.current = false; }, 120000);
  }, [addLog]);

  const startFertPump = useCallback((durSec: number, reason: string) => {
    setFertOn(true);
    addLog(`${reason} — ${durSec}s · ${Math.round(durSec*3)}ml`, "#7F77DD");
    fertTimerRef.current = setInterval(() => {
      setFertTank(prev => { if (prev <= 2) { stopFertPump("tank empty"); addLog("⚠ Fertiliser tank empty", "#FFC56D"); return prev; } return Math.max(0, prev - 0.3); });
      setFertUsed(prev => Math.round(prev + 1.5));
      setNpk(prev => Math.min(100, prev + 0.3));
    }, 500);
    if (durSec > 0) fertAutoRef.current = setTimeout(() => stopFertPump("dose complete"), durSec * 1000);
  }, [addLog, stopFertPump]);

  const startWaterPump = useCallback((durSec: number, reason: string) => {
    setWaterOn(true);
    addLog(`${reason} — ${durSec}s · ${Math.round(durSec*5)}ml`, "#1D9E75");
    waterTimerRef.current = setInterval(() => {
      setWaterTank(prev => { if (prev <= 2) { stopWaterPump("tank empty"); addLog("⚠ Water tank empty", "#FFC56D"); return prev; } return Math.max(0, prev - 0.4); });
      setWaterUsed(prev => Math.round(prev + 2));
      setMoisture(prev => Math.min(100, prev + 0.25));
    }, 500);
    if (durSec > 0) waterAutoRef.current = setTimeout(() => {
      stopWaterPump("target reached");
      if (pendingFertRef.current && fertTank > 5) {
        const pd = pendingFertRef.current; pendingFertRef.current = null;
        setTimeout(() => startFertPump(pd.dur, "AI post-water fertilise"), 1500);
      }
    }, durSec * 1000);
  }, [addLog, stopWaterPump, startFertPump, fertTank]);

  const toggleWater = () => {
    if (waterOn) stopWaterPump("manual stop");
    else startWaterPump(0, "Manual irrigation");
  };
  const toggleFert = () => {
    if (fertOn) stopFertPump("manual stop");
    else startFertPump(0, "Manual fertilise");
  };

  const refillTank = (which: "water" | "fert") => {
    if (which === "water") { setWaterTank(100); addLog("Water tank refilled to 100%", "#1D9E75"); }
    else { setFertTank(100); addLog("Fertiliser tank refilled to 100%", "#7F77DD"); }
  };

  // ── live mode ──
  const toggleLive = () => {
    if (liveOn) {
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
      if (aiCycleRef.current)   clearInterval(aiCycleRef.current);
      liveTimerRef.current = null; aiCycleRef.current = null;
      setLiveOn(false);
      addLog("Live simulation stopped", "#A09080");
    } else {
      setLiveOn(true);
      addLog("Live simulation started — AI autonomous mode", "#1D9E75");

      // AI autonomous cycle — reads from refs to avoid stale closures
      aiCycleRef.current = setInterval(() => {
        const m = moistureRef.current, t = tempRef.current, h = humidityRef.current;
        const r = rainRef.current,     b = battRawRef.current, n = npkRef.current;
        const wo = waterOnRef.current, fo = fertOnRef.current;
        const wt = waterTankRef.current, ft = fertTankRef.current;
        const cr = cropRef.current, dm = dispModeRef.current;
        const aiNow = runAI(m, t, h, r, b, n, cr, wo, wt, ft, dm, histMRef.current, histNRef.current, ghSimTimeRef.current);
        if (aiNow.isWater && !wo && !waterCooldownRef.current && wt > 5 && aiNow.wDur > 0 && dm !== "fert") {
          startWaterPump(aiNow.wDur, "AI auto-irrigate");
        }
        if (aiNow.isFert && !fo && !fertCooldownRef.current && ft > 5 && aiNow.fDur > 0 && !wo && dm !== "water") {
          startFertPump(aiNow.fDur, "AI auto-fertilise");
        }
      }, 8000);

      // Physics simulation — reads from refs, sets state with computed values directly
      liveTimerRef.current = setInterval(() => {
        ghSimTimeRef.current += 2.2;
        const cm = moistureRef.current, ct = tempRef.current, ch = humidityRef.current;
        const cr = rainRef.current,     cb = battRawRef.current, cn = npkRef.current;
        const wo = waterOnRef.current,  fo = fertOnRef.current;
        const cropProfile = CROPS[cropRef.current];
        const hour = (6 + ghSimTimeRef.current / 60) % 24;
        const targetT = 22 + 16 * Math.sin((hour - 6) * Math.PI / 12);
        const dt = (targetT - ct) * 0.04 + (Math.random() - 0.5) * 0.8;
        const dh = -dt * 0.6 + (cr > 50 ? 2.5 : 0) + (Math.random() - 0.5) * 1.2 + (wo ? 1.5 : 0);
        const evap = (ct / 45) * 0.6 + 0.25;
        const uptake = cropProfile.min > cm ? 0.05 : 0.3;
        const rainGain = cr > 70 ? 1.5 : cr > 40 ? 0.4 : 0;
        const dm = -evap - uptake + rainGain + (wo ? 3.5 : 0) + (Math.random() - 0.5) * 0.7;
        const dn = -0.12 - (cm > cropProfile.min ? 0.08 : 0) + (fo ? 1.8 : 0) + (Math.random() - 0.5) * 0.3;
        const dr = (Math.random() - 0.5) * 3;
        const nm = Math.round(Math.min(95, Math.max(3, cm + dm)));
        const nt = Math.round(Math.min(45, Math.max(10, ct + dt)));
        const nh = Math.round(Math.min(100, Math.max(15, ch + dh)));
        const nr = Math.round(Math.min(100, Math.max(0, cr + dr)));
        const nn = Math.round(Math.min(100, Math.max(0, cn + dn)));
        setMoisture(nm); setTemp(nt); setHumidity(nh); setRain(nr); setNpk(nn);
        histMRef.current = [...histMRef.current.slice(1), nm];
        histTRef.current = [...histTRef.current.slice(1), nt];
        histNRef.current = [...histNRef.current.slice(1), nn];
        setChartData(buildChartData(histMRef.current, histTRef.current, histNRef.current));
        // throttled anomaly checks
        if (nm > 90) addLogThrottled(`⚠ Anomaly: moisture very high (${nm}%) — check sensor`, "#FF9898", "anom_m_hi");
        if (nt > 42) addLogThrottled(`⚠ Anomaly: extreme temperature (${nt}°C) — ventilate`, "#FF9898", "anom_t_hi");
        if (nh < 15) addLogThrottled(`⚠ Anomaly: very low humidity (${nh}%) — plant stress`, "#FFC56D", "anom_h_lo");
        if (cb / 10 < 3.1) addLogThrottled(`🔴 CRITICAL: battery ${(cb/10).toFixed(1)}V — charge immediately`, "#FF5A5A", "anom_batt");
        if (waterTankRef.current < 15 && waterTankRef.current > 0) addLogThrottled(`⚠ Water tank low — ${Math.round(waterTankRef.current)}%`, "#FFC56D", "wtanklow");
        if (fertTankRef.current < 15 && fertTankRef.current > 0)   addLogThrottled(`⚠ Fertiliser tank low — ${Math.round(fertTankRef.current)}%`, "#FFC56D", "ftanklow");
      }, 2200);
    }
  };

  const simHeatStress = () => {
    setMoisture(12); setTemp(39); setHumidity(22); setRain(2); setBattRaw(39); setNpk(20);
    addLog("🔥 Drought scenario — critical moisture & NPK", "#D85A30");
  };
  const simHighHumidity = () => {
    setMoisture(88); setTemp(21); setHumidity(93); setRain(95); setBattRaw(37); setNpk(65);
    addLog("🌧 Monsoon — rain override, fert locked", "#378ADD");
  };

  const setCrop = (c: string) => { setCropState(c); addLog(`Crop changed to ${CROPS[c].name}`, "#C8B8FF"); };

  // decision block styles
  const decBg: Record<string, string> = { irr: "#0E2A1C", wait: "#192818", skip: "#2A1E08", danger: "#2A100E" };
  const decBorder: Record<string, string> = { irr: "#2E9E6A", wait: "#5CB87A", skip: "#C49030", danger: "#E05050" };
  const decColor: Record<string, string> = { irr: "#fff", wait: "#fff", skip: "#FFD87D", danger: "#FF8E8E" };

  const stressColors: Record<string, string> = { Normal: "#7BFFAF", Mild: "#FFC56D", Severe: "#FF7A8A" };

  return (
    <div style={{ padding: "20px", minHeight: "100vh" }}>

      {/* ── TOPBAR ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", paddingBottom: "1rem", borderBottom: "1px solid rgba(255,255,255,.07)", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 14, background: "#163222", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(107,227,155,.18)" }}>
            <IconPlant2 size={22} color="#5A9A2A" />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "#fff" }}>Irrigation & Fertiliser AI</div>
            <div style={{ fontSize: 11, color: "#8FA3B8", marginTop: 2 }}>RV College of Engineering · Autonomous water + nutrient dispensing system</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Chip color="blue"><IconCpu size={12} /> Arduino UNO</Chip>
          <Chip color="amber"><IconAntenna size={12} /> HC-05 BT</Chip>
          <Chip color="green"><div className="dp-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#7DFFC2" }} /> Water pump ready</Chip>
          <Chip color="amber"><div className="dp-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#FFD09A", animationDelay: ".6s" }} /> Fertiliser pump ready</Chip>
        </div>
      </div>

      {/* ── METRIC CARDS ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 10 }}>
        <MCard accent="#2E9E6A" label="Soil moisture" icon={<IconRipple size={13} color="#2E9E6A" />} value={`${moisture}%`} valueColor="#7DFFC2" sub="Optimal 40–70%" barPct={moisture} barColor="#2E9E6A" />
        <MCard accent="#BA7517" label="Temperature" icon={<IconTemperature size={13} color="#BA7517" />} value={`${temp}°C`} valueColor="#FFC56D" sub="Ambient air" barPct={Math.round((temp/45)*100)} barColor="#BA7517" />
        <MCard accent="#5A9E5A" label="Humidity" icon={<IconDroplets size={13} color="#5A9E5A" />} value={`${humidity}%`} valueColor="#AAFFAA" sub="Relative humidity" barPct={humidity} barColor="#5A9E5A" />
        <MCard accent="#7A9E2A" label="Rain forecast" icon={<IconCloudRain size={13} color="#7A9E2A" />} value={`${rain}%`} valueColor="#C8E87A" sub="Short-term forecast" barPct={rain} barColor="#7A9E2A" />
      </div>

      {/* ── DISPENSE CONTROLS ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        {/* WATER */}
        <div className={waterOn ? "active-water" : ""} style={{ borderRadius: 22, padding: "1rem 1.125rem", border: `1.5px solid #2E9E6A`, background: "rgba(18,36,26,.88)", position: "relative", overflow: "hidden", transition: "box-shadow .3s" }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, display: "flex", alignItems: "center", gap: 7, color: "#7DFFC2" }}>
            <IconDropletFilled size={18} />Water dispensing
            <span style={waterOn ? STATUS_BADGE_WATER_ON : STATUS_BADGE_STANDBY}>{waterOn ? "Active" : "Standby"}</span>
          </div>
          {[["Pump duration", `${ai.wDur}s`, "#7DFFC2"], ["Volume estimate", `${Math.round(ai.wDur*5)} ml`, "#AAFFAA"], ["Water tank level", `${Math.round(waterTank)}%`, "#7DFFC2"]].map(([l,v,c]) => (
            <div key={l} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:".5px solid rgba(255,200,120,.07)",fontSize:12 }}>
              <span style={{ color: "#A09080" }}>{l}</span><span style={{ fontWeight:600,color:c as string }}>{v}</span>
            </div>
          ))}
          <div style={{ display:"flex",alignItems:"flex-end",gap:8,marginTop:8 }}>
            <div style={{ flex:1,background:"#2A2318",borderRadius:6,height:12,overflow:"hidden" }}>
              <div style={{ height:12,borderRadius:6,background:"#2E9E6A",width:`${waterTank}%`,transition:"width .6s ease" }} />
            </div>
          </div>
          {[["Today used", `${waterUsed} ml`, "#A09080"], ["AI decision", ai.wProb > 55 ? "Irrigate" : "Hold", ai.wProb > 55 ? "#7BFFAF" : "#FFC56D"]].map(([l,v,c]) => (
            <div key={l} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:".5px solid rgba(255,200,120,.07)",fontSize:12,marginTop:l==="Today used"?8:0 }}>
              <span style={{ color:"#A09080" }}>{l}</span><span style={{ fontWeight:600,color:c as string }}>{v as string}</span>
            </div>
          ))}
          <div style={{ display:"flex",gap:7,flexWrap:"wrap",marginTop:10 }}>
            <button onClick={toggleWater} style={{ display:"inline-flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:99,fontSize:12,fontWeight:500,cursor:"pointer",background:"#0E2A1C",borderColor:"#2E9E6A",color:"#7DFFC2",border:"1px solid #2E9E6A" }}>
              {waterOn ? <IconPlayerStop size={13} /> : <IconPlayerPlay size={13} />} {waterOn ? "Stop water pump" : "Start water pump"}
            </button>
            <button onClick={() => refillTank("water")} style={{ display:"inline-flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:99,fontSize:12,fontWeight:500,cursor:"pointer",background:"#2A2318",border:"1px solid #3A3028",color:"#8A7D72" }}>
              <IconReload size={13} /> Refill
            </button>
          </div>
        </div>

        {/* FERTILISER */}
        <div className={fertOn ? "active-fert" : ""} style={{ borderRadius: 22, padding: "1rem 1.125rem", border: `1.5px solid #C4773A`, background: "rgba(40,22,10,.88)", position: "relative", overflow: "hidden", transition: "box-shadow .3s" }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, display: "flex", alignItems: "center", gap: 7, color: "#FFD09A" }}>
            <IconFlask size={18} />Fertiliser dispensing
            <span style={fertOn ? STATUS_BADGE_FERT_ON : STATUS_BADGE_STANDBY}>{fertOn ? "Active" : "Standby"}</span>
          </div>
          {[["Dose duration", `${ai.fDur}s`, "#FFD09A"], ["Volume estimate", `${Math.round(ai.fDur*3)} ml`, "#FFBC80"], ["Fertiliser tank", `${Math.round(fertTank)}%`, "#FFD09A"]].map(([l,v,c]) => (
            <div key={l} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:".5px solid rgba(255,200,120,.07)",fontSize:12 }}>
              <span style={{ color:"#A09080" }}>{l}</span><span style={{ fontWeight:600,color:c as string }}>{v}</span>
            </div>
          ))}
          <div style={{ display:"flex",alignItems:"flex-end",gap:8,marginTop:8 }}>
            <div style={{ flex:1,background:"#2A2318",borderRadius:6,height:12,overflow:"hidden" }}>
              <div style={{ height:12,borderRadius:6,background:"#C4773A",width:`${fertTank}%`,transition:"width .6s ease" }} />
            </div>
          </div>
          {[["Today dispensed", `${fertUsed} ml`, "#A09080"], ["NPK schedule", ai.wProb > 55 && ai.fProb > 45 ? "With water" : ai.fProb > 45 ? "NPK deficit" : "Routine", "#FFD09A"]].map(([l,v,c]) => (
            <div key={l} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:".5px solid rgba(255,200,120,.07)",fontSize:12,marginTop:l==="Today dispensed"?8:0 }}>
              <span style={{ color:"#A09080" }}>{l}</span><span style={{ fontWeight:600,color:c as string }}>{v as string}</span>
            </div>
          ))}
          <div style={{ display:"flex",gap:7,flexWrap:"wrap",marginTop:10 }}>
            <button onClick={toggleFert} style={{ display:"inline-flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:99,fontSize:12,fontWeight:500,cursor:"pointer",background:"#2A160A",border:"1px solid #C4773A",color:"#FFD09A" }}>
              {fertOn ? <IconPlayerStop size={13} /> : <IconPlayerPlay size={13} />} {fertOn ? "Stop fertiliser pump" : "Start fertiliser pump"}
            </button>
            <button onClick={() => refillTank("fert")} style={{ display:"inline-flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:99,fontSize:12,fontWeight:500,cursor:"pointer",background:"#2A2318",border:"1px solid #3A3028",color:"#8A7D72" }}>
              <IconReload size={13} /> Refill
            </button>
          </div>
        </div>
      </div>

      {/* ── MIDDLE ROW ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr) minmax(0,.9fr)", gap: 10, marginBottom: 10 }}>

        {/* AI DECISION ENGINE */}
        <Card>
          <CardHd left={<><IconBrain size={13} />AI decision engine</>} right={
            <span style={{ fontSize:10,padding:"2px 9px",borderRadius:99,background:"#0E2A1C",color:"#7DFFC2",border:".5px solid #2A7A50" }}>{ai.conf}% conf</span>
          } />
          <div style={{ borderRadius:14,padding:".875rem 1rem",border:`1.5px solid ${decBorder[ai.decMode]}`,marginBottom:".75rem",background:decBg[ai.decMode] }}>
            <div style={{ fontSize:16,fontWeight:500,color:decColor[ai.decMode] }}>{ai.decision}</div>
            <div style={{ fontSize:11,marginTop:3,opacity:.75,color:decColor[ai.decMode] }}>{ai.reason}</div>
          </div>
          {/* mode toggle */}
          <div style={{ display:"flex",background:"#1C1712",border:"1px solid #3A3028",borderRadius:99,padding:3,gap:2,marginBottom:10 }}>
            {(["water","fert","both"] as const).map(m => (
              <button key={m} onClick={() => setDispMode(m)} style={{ flex:1,padding:"5px 10px",borderRadius:99,fontSize:11,cursor:"pointer",border:"none",fontFamily:"inherit",background:dispMode===m?(m==="fert"?"#2A160A":"#0E2A1C"):"none",color:dispMode===m?(m==="fert"?"#FFD09A":"#7DFFC2"):"#8A7D72",fontWeight:dispMode===m?500:400 }}>
                {m==="water"?"Water only":m==="fert"?"Fertiliser only":"Both"}
              </button>
            ))}
          </div>
          <InlineStat label="Water pump duration" value={`${ai.wDur}s`} valueStyle={{ color: "#7DFFC2" }} />
          <InlineStat label="Fertiliser dose" value={`${ai.fDur}s`} valueStyle={{ color: "#FFD09A" }} />
          <InlineStat label="Irrigation probability" value={`${Math.round(ai.wProb)}%`} />
          <div style={{ background:"#2A2318",borderRadius:4,height:8,overflow:"hidden",margin:".25rem 0" }}>
            <div style={{ height:8,borderRadius:4,background:"linear-gradient(90deg,#2E9E6A,#C4773A)",width:`${ai.wProb}%`,transition:"width .5s" }} />
          </div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",fontSize:13,color:"#A09080",borderBottom:"none" }}>
            <span>Fertilise probability</span><span style={{ fontWeight:600,color:"#FFD09A" }}>{Math.round(ai.fProb)}%</span>
          </div>
          <div style={{ background:"#2A2318",borderRadius:4,height:8,overflow:"hidden",margin:".25rem 0 .75rem" }}>
            <div style={{ height:8,borderRadius:4,background:"linear-gradient(90deg,#C4773A,#FFD09A)",width:`${ai.fProb}%`,transition:"width .5s" }} />
          </div>
          <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
            <Chip color="green"><IconLeaf size={12} /> Soil health {health}%</Chip>
            <Chip color="blue"><IconDroplets size={12} /> Water saved {savings}%</Chip>
            <Chip color="amber"><IconFlask size={12} /> Nutrients {npk >= cd.npkMin ? "Good" : "Low"}</Chip>
          </div>
        </Card>

        {/* SENSOR SIMULATION */}
        <Card>
          <CardHd left={<><IconAdjustmentsHorizontal size={13} />Sensor simulation</>} />
          <div style={{ display:"flex",gap:6,flexWrap:"wrap",marginBottom:10 }}>
            {Object.keys(CROPS).map(c => (
              <button key={c} onClick={() => setCrop(c)} style={{ padding:"4px 10px",borderRadius:99,border:".5px solid",borderColor:crop===c?"#2A7A50":"#3A3028",fontSize:11,cursor:"pointer",background:crop===c?"#0E2A1C":"#1C1712",color:crop===c?"#7DFFC2":"#D4C9BC",fontWeight:crop===c?500:400,fontFamily:"inherit" }}>
                {CROPS[c].name}
              </button>
            ))}
          </div>
          {[
            { label:"Moisture (%)", val:moisture, set:setMoisture, min:0, max:100, disp:`${moisture}%` },
            { label:"Temperature (°C)", val:temp, set:setTemp, min:10, max:45, disp:`${temp}°C` },
            { label:"Humidity (%)", val:humidity, set:setHumidity, min:10, max:100, disp:`${humidity}%` },
            { label:"Rain prob (%)", val:rain, set:setRain, min:0, max:100, disp:`${rain}%` },
            { label:"Battery (V)", val:battRaw, set:setBattRaw, min:30, max:42, disp:`${(battRaw/10).toFixed(1)}V` },
            { label:"Soil NPK index", val:npk, set:setNpk, min:0, max:100, disp:`${npk}` },
          ].map(({ label, val, set, min, max, disp }) => (
            <div key={label} style={{ display:"flex",alignItems:"center",gap:8,marginBottom:9 }}>
              <span style={{ fontSize:12,color:"#A09080",width:115,flexShrink:0 }}>{label}</span>
              <input type="range" min={min} max={max} value={val} onChange={e => set(+e.target.value)} style={{ flex:1 }} />
              <span style={{ fontSize:12,fontWeight:500,width:46,textAlign:"right",flexShrink:0 }}>{disp}</span>
            </div>
          ))}
        </Card>

        {/* PLANT STATUS + GREENHOUSE */}
        <Card>
          <CardHd left={<><IconPlant size={13} />Plant status & environment</>} />
          <div style={{ textAlign:"center",padding:".5rem 0" }}>
            <div>
              {stress === "Normal" ? <IconMoodSmile size={28} color="#7DFFC2" /> :
               stress === "Mild"   ? <IconMoodEmpty size={28} color="#FFC56D" /> :
                                     <IconMoodSad   size={28} color="#FF7A8A" />}
            </div>
            <div style={{ fontSize:20,fontWeight:500,marginTop:4,color:stressColors[stress] }}>{stress}</div>
            <div style={{ fontSize:11,color:"#8A7D72",marginTop:2 }}>Plant stress level</div>
          </div>
          <div style={{ borderTop:".5px solid rgba(255,200,120,.07)",paddingTop:".75rem",marginTop:".5rem" }}>
            <MiniBar name="Soil health"   pct={health}  color="#5A9A2A" val={`${health}%`} />
            <MiniBar name="Water savings" pct={savings} color="#2E9E6A" val={`${savings}%`} />
            <MiniBar name="Nutrient level" pct={npk}   color="#C4773A" val={`${npk}`} valStyle={{ color: "#FFD09A" }} />
            <MiniBar name="Battery" pct={battPct} color={battPct>50?"#BA7517":battPct>25?"#EF9F27":"#E24B4A"} val={`${(battRaw/10).toFixed(1)}V`} />
          </div>
          <div style={{ borderTop:".5px solid rgba(255,200,120,.07)",paddingTop:".75rem",marginTop:".75rem" }}>
            <div style={{ fontSize:10,textTransform:"uppercase",letterSpacing:".06em",color:"#8A7D72",marginBottom:7,display:"flex",alignItems:"center",gap:5 }}>
              <IconHome2 size={12} /> Greenhouse conditions
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6 }}>
              <GHItem icon={<IconSun size={14} />} iconBg="rgba(255,190,80,.1)" iconColor="#FFD060" label="Light (PPFD)" val={gh.light} valColor="#FFD060" st={gh.lightSt} stCls={gh.lightStCls as "ok"|"warn"|"bad"} />
              <GHItem icon={<IconLeaf size={14} />} iconBg="rgba(120,200,120,.1)" iconColor="#80E090" label="CO₂ Level" val={gh.co2} valColor="#80E090" st={gh.co2St} stCls={gh.co2StCls as "ok"|"warn"|"bad"} />
              <GHItem icon={<IconWind size={14} />} iconBg="rgba(100,180,255,.1)" iconColor="#88C8FF" label="VPD" val={gh.vpd} valColor="#88C8FF" st={gh.vpdSt} stCls={gh.vpdStCls as "ok"|"warn"|"bad"} />
              <GHItem icon={<IconThermometer size={14} />} iconBg="rgba(255,140,80,.1)" iconColor="#FFA060" label="Canopy Temp" val={gh.canopy} valColor="#FFA060" st={gh.canopySt} stCls={gh.canopyStCls as "ok"|"warn"|"bad"} />
              <GHItem icon={<IconDropletHalf size={14} />} iconBg="rgba(80,200,200,.1)" iconColor="#60D8D8" label="Moisture Status" val={gh.moisture} valColor="#60D8D8" st={gh.moistureSt} stCls={gh.moistureStCls as "ok"|"warn"|"bad"} />
              <GHItem icon={<IconArrowsShuffle size={14} />} iconBg="rgba(200,180,255,.1)" iconColor="#C8B8FF" label="Air Circulation" val={gh.airflow} valColor="#C8B8FF" st={gh.airflowSt} stCls={gh.airflowStCls as "ok"|"warn"|"bad"} />
              <GHItem icon={<IconTestPipe size={14} />} iconBg="rgba(255,210,100,.1)" iconColor="#FFD060" label="EC (mS/cm)" val={gh.ec} valColor="#FFD060" st={gh.ecSt} stCls={gh.ecStCls as "ok"|"warn"|"bad"} />
              <GHItem icon={<IconClock size={14} />} iconBg="rgba(255,120,120,.1)" iconColor="#FF9898" label="DLI (mol/m²)" val={gh.dli} valColor="#FF9898" st={gh.dliSt} stCls={gh.dliStCls as "ok"|"warn"|"bad"} />
            </div>
          </div>
          <div style={{ display:"flex",gap:6,marginTop:".875rem",flexWrap:"wrap" }}>
            <button onClick={simHeatStress} style={{ display:"inline-flex",alignItems:"center",gap:5,padding:"6px 14px",border:"1px solid #C45030",borderRadius:14,background:"#2E1208",cursor:"pointer",fontSize:12,color:"#FFB090",fontFamily:"inherit" }}>
              <IconSunHigh size={12} /> Heat Stress
            </button>
            <button onClick={simHighHumidity} style={{ display:"inline-flex",alignItems:"center",gap:5,padding:"6px 14px",border:"1px solid #2A7A50",borderRadius:14,background:"#0E2A1C",cursor:"pointer",fontSize:12,color:"#7DFFC2",fontFamily:"inherit" }}>
              <IconCloudStorm size={12} /> High Humidity
            </button>
            <button onClick={toggleLive} style={{ display:"inline-flex",alignItems:"center",gap:5,padding:"6px 14px",border:"1px solid #C49030",borderRadius:14,background:"#2A1E08",cursor:"pointer",fontSize:12,color:"#FFD07D",fontFamily:"inherit" }}>
              {liveOn ? <IconPlayerStop size={12} /> : <IconRefresh size={12} />} {liveOn ? "Stop" : "Live"}
            </button>
          </div>
        </Card>
      </div>

      {/* ── NPK GAUGES ── */}
      <div style={{ marginBottom: 10 }}>
        <Card>
          <CardHd left={<><IconFlask size={13} />Nutrient profile (NPK) — AI fertiliser recommendation</>} right={<span style={{ fontSize:11,color:"#6E7A8A" }}>{fertRec}</span>} />
          <div style={{ display:"flex",gap:8 }}>
            <NutrientGauge label="Nitrogen (N)"    value={`${npkN}`} barPct={npkN}  barColor="#2E9E6A" target="Target: 60–80" valueStyle={{ color:"#AAFFAA" }} />
            <NutrientGauge label="Phosphorus (P)"  value={`${npkP}`} barPct={npkP}  barColor="#5A9E5A" target="Target: 40–70" valueStyle={{ color:"#AAFFAA" }} />
            <NutrientGauge label="Potassium (K)"   value={`${npkK}`} barPct={npkK}  barColor="#C4773A" target="Target: 50–75" valueStyle={{ color:"#FFD09A" }} />
            <NutrientGauge label="Overall NPK"     value={`${npk}`}  barPct={npk}   barColor="#A87A1A" target="Index 0–100"   valueStyle={{ color:"#FFD09A" }} />
            <NutrientGauge label="Soil pH"         value={ph.toFixed(1)} barPct={Math.max(30,Math.min(90,((ph-4.5)/3.5)*100))} barColor="#C45A30" target="Optimal: 6.0–7.0" valueStyle={{ color:"#FFBC80" }} />
            <div style={{ flex:1,background:"#1C1712",border:"1px solid #3A3028",borderRadius:14,padding:".75rem",textAlign:"center" }}>
              <div style={{ fontSize:10,textTransform:"uppercase",letterSpacing:".05em",color:"#8A7D72",marginBottom:5 }}>Next dose</div>
              <div style={{ fontSize:14,fontWeight:500,color:"#FFD09A" }}>{nextLabel}</div>
              <div style={{ fontSize:10,color:"#6E7A8A",marginTop:9 }}>Scheduled</div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── CHART + SCHEDULE + LOG ── */}
      <div style={{ display:"grid",gridTemplateColumns:"minmax(0,1.3fr) minmax(0,.7fr)",gap:10,marginBottom:10 }}>
        <Card>
          <CardHd left={<><IconChartLine size={13} />Sensor trend — 20 readings</>} right={
            <div style={{ display:"flex",gap:10,fontSize:11,color:"#6E7A8A" }}>
              <span style={{ display:"flex",alignItems:"center",gap:4 }}><span style={{ width:12,height:3,display:"inline-block",background:"#2E9E6A",borderRadius:2 }}></span>Moisture</span>
              <span style={{ display:"flex",alignItems:"center",gap:4 }}><span style={{ width:12,height:3,display:"inline-block",background:"#BA7517",borderRadius:2 }}></span>Temp</span>
              <span style={{ display:"flex",alignItems:"center",gap:4 }}><span style={{ width:12,height:3,display:"inline-block",background:"#7F77DD",borderRadius:2 }}></span>NPK</span>
            </div>
          } />
          <div style={{ height: 185 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top:4,right:4,bottom:0,left:-20 }}>
                <XAxis dataKey="label" tick={{ fontSize:10,fill:"#A09080" }} interval="preserveStartEnd" />
                <YAxis domain={[0,100]} tick={{ fontSize:10,fill:"#A09080" }} />
                <Tooltip contentStyle={{ background:"#1C1712",border:"1px solid #3A3028",borderRadius:8,fontSize:11 }} labelStyle={{ color:"#A09080" }} />
                <Line type="monotone" dataKey="m" stroke="#1D9E75" strokeWidth={2} dot={false} name="Moisture" />
                <Line type="monotone" dataKey="t" stroke="#BA7517" strokeWidth={1.5} strokeDasharray="5 3" dot={false} name="Temp" />
                <Line type="monotone" dataKey="n" stroke="#7F77DD" strokeWidth={1.5} dot={false} name="NPK" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
          {/* SCHEDULE */}
          <Card>
            <CardHd left={<><IconCalendarEvent size={13} />Dispense schedule</>} />
            {schedule.map((p, i) => {
              const tNow = new Date();
              const tLabel = new Date(tNow.getTime() + p.hour * 3600000);
              const hh = String(tLabel.getHours()).padStart(2,"0");
              const mm = String(tLabel.getMinutes()).padStart(2,"0");
              const badge = p.needW && p.needF ? { label:"Water + Fert", bg:"#2A1E0A",color:"#FFE09A",border:"#9E7A1A" }
                : p.needW ? { label:"Water only", bg:"#0E2A1C",color:"#7DFFC2",border:"#2E9E6A" }
                : p.needF ? { label:"Fert only",  bg:"#2A160A",color:"#FFD09A",border:"#C4773A" }
                : { label:"Monitor",   bg:"#1C1712",color:"#6E7A8A",border:"#3A3028" };
              const dur = p.needW && p.needF ? `${Math.round(p.estWaterMl/5)}s / ${Math.round(p.estFertMl/3)}s`
                : p.needW ? `${Math.round(p.estWaterMl/5)}s`
                : p.needF ? `${Math.round(p.estFertMl/3)}s` : "—";
              return (
                <div key={i} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 0",borderBottom:i<5?".5px solid rgba(255,200,120,.07)":"none",fontSize:12 }}>
                  <span style={{ color:"#A09080",minWidth:50 }}>{hh}:{mm}</span>
                  <span style={{ padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:500,background:badge.bg,color:badge.color,border:`.5px solid ${badge.border}` }}>{badge.label}</span>
                  <span style={{ fontSize:11,color:"#6E7A8A",marginLeft:"auto",paddingLeft:8 }}>{dur}</span>
                </div>
              );
            })}
          </Card>

          {/* LOG */}
          <Card>
            <CardHd left={<><IconListCheck size={13} />Event log</>} />
            <div style={{ maxHeight:160,overflowY:"auto" }}>
              {logs.map((l, i) => (
                <div key={i} style={{ display:"flex",gap:9,alignItems:"flex-start",padding:"5px 0",borderBottom:i<logs.length-1?".5px solid rgba(255,200,120,.06)":"none",fontSize:12 }}>
                  <span style={{ color:"#8A7D72",fontSize:11,minWidth:54,flexShrink:0,paddingTop:1 }}>{l.time}</span>
                  <div style={{ width:6,height:6,borderRadius:"50%",flexShrink:0,marginTop:4,background:l.dot }} />
                  <span>{l.msg}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* ── ML MODEL METRICS ── */}
      <Card style={{ marginBottom: 10 }}>
        <CardHd left={<><IconChartBar size={13} />ML model performance</>} />
        <div style={{ display:"grid",gridTemplateColumns:"repeat(6,minmax(0,1fr))",gap:8 }}>
          {[
            { label:"LR accuracy", val:"87.2%", color:"#7DFFC2" },
            { label:"RF R²",        val:"0.891", color:"#AAFFAA" },
            { label:"Stress acc.",  val:"91.3%", color:"#FFD09A" },
            { label:"RMSE",         val:"±4.2s", color:"#FFCF7D" },
            { label:"Fert model",   val:"84.1%", color:"#FFBC80" },
            { label:"Water saved",  val:`${savings}%`, color:"#C8E87A" },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ background:"#1C1712",border:"1px solid #3A3028",borderRadius:14,padding:".625rem .75rem",textAlign:"center" }}>
              <div style={{ fontSize:10,color:"#8A7D72",textTransform:"uppercase",letterSpacing:".05em",marginBottom:3 }}>{label}</div>
              <div style={{ fontSize:18,fontWeight:500,color }}>{val}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── FOOTER ── */}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",paddingTop:".875rem",borderTop:"1px solid rgba(255,200,120,.07)",flexWrap:"wrap",gap:8 }}>
        <span style={{ fontSize:11,color:"#8A7D72" }}>Arduino UNO · DHT11 · Moisture sensor · Relay x2 (water + fertiliser) · HC-05 · Flask · scikit-learn</span>
        <div style={{ display:"flex",gap:6 }}>
          {[
            { label:"Arduino code ↗", style:{ background:"#1C1712",border:"1px solid #3A3028",color:"#D4C9BC" } },
            { label:"Add NPK sensor ↗", style:{ background:"#2A160A",border:"1px solid #C4773A",color:"#FFD09A" } },
            { label:"Improve ML ↗", style:{ background:"#0E2A1C",border:"1px solid #2A7A50",color:"#7DFFC2" } },
          ].map(({ label, style }) => (
            <button key={label} style={{ display:"inline-flex",alignItems:"center",gap:5,padding:"6px 14px",borderRadius:14,cursor:"pointer",fontSize:12,...style,fontFamily:"inherit" }}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
