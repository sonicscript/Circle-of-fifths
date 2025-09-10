import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

/* ============================================================
   Circle of Fifths — Vercel-safe build (TS fixes)
   - Removes unused vars (bSharp, prefersReducedMotion)
   - Safer AudioContext init for TypeScript
   - All previous features preserved
   ============================================================ */

// ---------- Geometry ---------------------------------------------------------
const TAU = Math.PI * 2;
const CENTER = 220;
const OUTER_R = 200;
const INNER_R = 120;

// ---------- Circle data ------------------------------------------------------
type Pos = { major: string; minor: string; acc: number }; // acc>0 sharps; acc<0 flats

const POSITIONS: readonly Pos[] = [
  { major: "C",         minor: "a",        acc:  0 },
  { major: "G",         minor: "e",        acc:  1 },
  { major: "D",         minor: "b",        acc:  2 },
  { major: "A",         minor: "f#",       acc:  3 },
  { major: "E",         minor: "c#",       acc:  4 },
  { major: "B",         minor: "g#",       acc:  5 },
  { major: "F# / Gb",   minor: "d# / eb",  acc:  6 },  // enharmonic spoke
  { major: "Db / C#",   minor: "bb / a#",  acc: -5 },  // enharmonic spoke
  { major: "Ab",        minor: "f",        acc: -4 },
  { major: "Eb",        minor: "c",        acc: -3 },
  { major: "Bb",        minor: "g",        acc: -2 },
  { major: "F",         minor: "d",        acc: -1 },
] as const;

// ---------- Accidentals / letter pitch-classes ------------------------------
const ORDER_SHARPS = ["F","C","G","D","A","E","B"];
const ORDER_FLATS  = ["B","E","A","D","G","C","F"];
const NAT_PC: Record<string, number> = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };

// Major key signature counts (positive = sharps, negative = flats)
const MAJOR_SIG_COUNTS: Record<string, number> = {
  C: 0, G: +1, D: +2, A: +3, E: +4, B: +5, "F#": +6, "C#": +7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};

// Relative major for minor names (lowercase)
const MINOR_REL_MAJOR: Record<string, string> = {
  a:"C", e:"G", b:"D", "f#":"A", "c#":"E", "g#":"B", "d#":"F#", "a#":"C#",
  d:"F", g:"Bb", c:"Eb", f:"Ab", bb:"Db", eb:"Gb", ab:"Cb",
};

// ---------- String helpers ---------------------------------------------------
function asciiNote(n: string) {
  return n.replace(/♯/g, "#").replace(/𝄪/g, "##").replace(/♭/g, "b").replace(/𝄫/g, "bb");
}
function normalizeToken(n: string) {
  if (!n) return "C";
  let t = asciiNote(n);
  t = t.split("/")[0].trim();
  const L = t[0]?.toUpperCase() ?? "C";
  const rest = t.slice(1).replace(/[^#b]/g, "");
  return L + rest;
}
function normalizeMinorToken(n: string) {
  let t = asciiNote(n).split("/")[0].trim();
  const L = t[0]?.toLowerCase() ?? "a";
  const rest = t.slice(1).replace(/[^#b]/g, "");
  return L + rest;
}
function pretty(n: string) {
  return n.replace(/##/g,"𝄪").replace(/bb/g,"𝄫").replace(/#/g,"♯").replace(/b/g,"♭");
}

// ---------- Enharmonic preference -------------------------------------------
type EnhPref = "auto" | "sharps" | "flats";

/** Robustly choose sharp/flat token by accidental, not by slash position. */
function resolveEnharmonic(raw: string, posAcc: number, pref: EnhPref) {
  if (!raw.includes("/")) return raw;
  const [aRaw, bRaw] = raw.split("/").map(s => s.trim());
  const a = asciiNote(aRaw), b = asciiNote(bRaw);
  const aSharp = a.includes("#");
  const sharpName = aSharp ? aRaw : bRaw;
  const flatName  = aSharp ? bRaw : aRaw;

  if (pref === "sharps") return sharpName;
  if (pref === "flats")  return flatName;
  return posAcc >= 0 ? sharpName : flatName; // auto by circle side
}

// ---------- Signatures & scale building -------------------------------------
type Sig = { type: "#" | "b"; count: number; set: Set<string> };

function signatureForMajorName(majorName: string): Sig {
  const key = normalizeToken(majorName);
  const count = MAJOR_SIG_COUNTS[key];
  const type: "#" | "b" = count >= 0 ? "#" : "b";
  const letters = (type === "#" ? ORDER_SHARPS : ORDER_FLATS).slice(0, Math.abs(count));
  return { type, count: Math.abs(count), set: new Set(letters) };
}
function applySignature(letter: string, sig: Sig) {
  if (sig.count === 0) return letter;
  if (sig.type === "#" && sig.set.has(letter)) return letter + "#";
  if (sig.type === "b" && sig.set.has(letter)) return letter + "b";
  return letter;
}
function raiseHalfStep(spelled: string) {
  const L = spelled[0];
  const acc = spelled.slice(1);
  if (acc.includes("b")) return L + acc.replace("b", ""); // remove one flat
  return L + acc + "#";                                    // add one sharp
}

function relativeMajorFromMinor(minorName: string, pref: EnhPref) {
  const nm = normalizeMinorToken(minorName);
  if (nm === "a#" || nm === "bb") return pref === "flats" ? "Db" : "C#";
  if (nm === "d#" || nm === "eb") return pref === "flats" ? "Gb" : "F#";
  if (nm === "g#" || nm === "ab") return pref === "flats" ? "Cb" : "B";
  return MINOR_REL_MAJOR[nm] ?? "C";
}

/** Build scale by key name + mode using formal key signatures.
 *  Minor (harmonic): relative-major signature + raised 7th.
 */
function buildScaleFromKeyName(tonicRaw: string, mode: "major"|"minor", enhPref: EnhPref) {
  const LETTERS = ["C","D","E","F","G","A","B"];
  if (mode === "major") {
    const tonic = normalizeToken(tonicRaw);
    const sig = signatureForMajorName(tonic);
    const start = LETTERS.indexOf(tonic[0]);
    const letters = Array.from({length:7},(_,i)=>LETTERS[(start+i)%7]);
    const scale = letters.map(L => applySignature(L, sig));
    scale[0] = tonic; // ensure tonic accidental matches name
    return scale;
  } else {
    const tonic = normalizeMinorToken(tonicRaw);         // e.g., "d#"
    const tonicLetter = tonic[0].toUpperCase();          // "D"
    const relMaj = relativeMajorFromMinor(tonicRaw, enhPref);
    const sig = signatureForMajorName(relMaj);
    const start = LETTERS.indexOf(tonicLetter);
    const letters = Array.from({length:7},(_,i)=>LETTERS[(start+i)%7]);
    const scale = letters.map(L => applySignature(L, sig));
    scale[0] = tonicLetter + tonic.slice(1);             // keep minor tonic’s accidental
    scale[6] = raiseHalfStep(scale[6]);                  // harmonic minor leading tone
    return scale;
  }
}

// ---------- Chords -----------------------------------------------------------
function diatonicTriads(scale: string[], mode: "major"|"minor") {
  const rn = mode === "minor" ? ["i","ii°","III+","iv","V","VI","vii°"] : ["I","ii","iii","IV","V","vi","vii°"];
  return scale.map((r,i)=>({ rn: rn[i], tones: [r, scale[(i+2)%7], scale[(i+4)%7]] }));
}
function diatonicSevenths(scale: string[], mode: "major"|"minor") {
  const pc = (i:number)=>scale[i%7];
  return mode === "major"
    ? [
        { rn: "Imaj7",  tones: [pc(0),pc(2),pc(4),pc(6)] },
        { rn: "ii7",    tones: [pc(1),pc(3),pc(5),pc(0)] },
        { rn: "iii7",   tones: [pc(2),pc(4),pc(6),pc(1)] },
        { rn: "IVmaj7", tones: [pc(3),pc(5),pc(0),pc(2)] },
        { rn: "V7",     tones: [pc(4),pc(6),pc(1),pc(3)] },
        { rn: "vi7",    tones: [pc(5),pc(0),pc(2),pc(4)] },
        { rn: "viiø7",  tones: [pc(6),pc(1),pc(3),pc(5)] },
      ]
    : [
        { rn: "i mMaj7", tones: [pc(0),pc(2),pc(4),pc(6)] },
        { rn: "iiø7",    tones: [pc(1),pc(3),pc(5),pc(0)] },
        { rn: "III+maj7",tones: [pc(2),pc(4),pc(6),pc(1)] },
        { rn: "iv7",     tones: [pc(3),pc(5),pc(0),pc(2)] },
        { rn: "V7",      tones: [pc(4),pc(6),pc(1),pc(3)] },
        { rn: "VImaj7",  tones: [pc(5),pc(0),pc(2),pc(4)] },
        { rn: "vii°7",   tones: [pc(6),pc(1),pc(3),pc(5)] },
      ];
}

// ---------- Audio ------------------------------------------------------------
function useAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);

  const ensure = () => {
    if (!ctxRef.current) {
      // Use a permissive 'any' to satisfy TS across browsers (AudioContext / webkitAudioContext)
      const Ctor: any = (window as any).AudioContext ?? (window as any).webkitAudioContext;
      const ctx: any = new Ctor();
      const g: any = ctx.createGain();
      g.gain.value = volume;
      g.connect(ctx.destination);
      ctxRef.current = ctx as AudioContext;
      gainRef.current = g as GainNode;
    }
  };
  const resumeIfNeeded = async () => {
    ensure();
    const ctx = ctxRef.current!;
    if (ctx.state === "suspended") { try { await ctx.resume(); } catch {} }
  };
  useEffect(() => { if (gainRef.current) gainRef.current.gain.value = muted ? 0 : volume; }, [volume, muted]);

  const midiToFreq = (m:number)=> 440*Math.pow(2,(m-69)/12);
  const spelledToMidi = (note:string, oct=4) => {
    const N = asciiNote(normalizeToken(note));
    const L = N[0] as keyof typeof NAT_PC;
    const acc = N.slice(1);
    const sigma = (acc.match(/#/g)?.length ?? 0) - (acc.match(/b/g)?.length ?? 0);
    const pc = (NAT_PC[L] + sigma + 120) % 12;
    return 12*(oct+1) + pc;
  };
  const noteToFreq = (n:string,o=4)=> midiToFreq(spelledToMidi(n,o));

  const playChord = async (freqs:number[], dur=0.8) => {
    await resumeIfNeeded();
    const ctx = ctxRef.current!, bus = gainRef.current!, t = ctx.currentTime;
    freqs.forEach((f,i)=>{
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type="sine"; o.frequency.setValueAtTime(f,t);
      o.connect(g).connect(bus);
      g.gain.setValueAtTime(0.0001,t);
      g.gain.exponentialRampToValueAtTime(i===2?0.22:0.28, t+0.02+i*0.01);
      g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
      o.start(t); o.stop(t+dur+0.02);
    });
  };

  const playFreq = async (f:number, dur=0.45) => {
    await resumeIfNeeded();
    const ctx = ctxRef.current!, bus = gainRef.current!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type="sine"; o.frequency.setValueAtTime(f, ctx.currentTime);
    o.connect(g).connect(bus);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.32,t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.start(t); o.stop(t+dur+0.02);
  };

  return { playChord, playFreq, noteToFreq, volume, setVolume, muted, setMuted };
}

// ---------- Drawing utils ----------------------------------------------------
function arcPath(cx:number, cy:number, r1:number, r2:number, a0:number, a1:number){
  const p0o=[cx+r1*Math.cos(a0), cy+r1*Math.sin(a0)];
  const p1o=[cx+r1*Math.cos(a1), cy+r1*Math.sin(a1)];
  const p0i=[cx+r2*Math.cos(a1), cy+r2*Math.sin(a1)];
  const p1i=[cx+r2*Math.cos(a0), cy+r2*Math.sin(a0)];
  const large = a1-a0 > Math.PI ? 1 : 0;
  return [`M ${p0o[0]} ${p0o[1]}`, `A ${r1} ${r1} 0 ${large} 1 ${p1o[0]} ${p1o[1]}`, `L ${p0i[0]} ${p0i[1]}`, `A ${r2} ${r2} 0 ${large} 0 ${p1i[0]} ${p1i[1]}`, "Z"].join(" ");
}
const sliceFill = (i:number, sel:boolean) => {
  const h = (i*30)%360, s = 85, l = sel ? 86 : 92;
  return `hsl(${h} ${s}% ${l}%)`;
};
const sliceStroke = (i:number)=> `hsl(${(i*30)%360} 40% 66%)`;

// ---------- Small UI atoms ---------------------------------------------------
function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl border text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
        ${active ? "bg-slate-900 text-white border-slate-900" : "bg-white/80 text-slate-900 border-slate-300 hover:bg-white"}`}
    >
      {children}
    </button>
  );
}
function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white/90 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="font-medium truncate" title={value}>{value}</div>
    </div>
  );
}

// ---------- Main component ---------------------------------------------------
export default function CircleOfFifths() {
  const [mode, setMode] = useState<"major" | "minor">("major");
  const [showRel, setShowRel] = useState(true);
  const [useSevenths, setUseSevenths] = useState(true);
  const [enhPref, setEnhPref] = useState<EnhPref>("auto");
  const [idx, setIdx] = useState(0);

  const { playFreq, playChord, noteToFreq, volume, setVolume, muted, setMuted } = useAudio();
  const pos = POSITIONS[idx];

  const labelFor = (raw: string, p: Pos) => pretty(normalizeToken(resolveEnharmonic(raw, p.acc, enhPref)));
  const displayMain = (p: Pos) => labelFor(mode === "major" ? p.major : p.minor, p);
  const displayRel  = (p: Pos) => labelFor(mode === "major" ? p.minor : p.major, p);

  const tonicNameForSpelling = useMemo(() => {
    const raw = mode === "major" ? pos.major : pos.minor;
    return resolveEnharmonic(raw, pos.acc, enhPref);
  }, [pos, mode, enhPref]);

  const spelledScale = useMemo(
    () => buildScaleFromKeyName(tonicNameForSpelling, mode, enhPref),
    [tonicNameForSpelling, mode, enhPref]
  );
  const triads = useMemo(() => diatonicTriads(spelledScale, mode), [spelledScale, mode]);
  const sevenths = useMemo(() => diatonicSevenths(spelledScale, mode), [spelledScale, mode]);
  const chords = useSevenths ? sevenths : triads;

  const selectedPretty = displayMain(pos);
  const relativePretty = displayRel(pos);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIdx(i => (i+1)%12);
      if (e.key === "ArrowLeft")  setIdx(i => (i+11)%12);
      if (e.key.toLowerCase() === "m") setMode(m => m==="major"?"minor":"major");
      if (e.key === "7") setUseSevenths(v => !v);
      if (e.key.toLowerCase() === "h") setEnhPref(p => p==="auto" ? "sharps" : p==="sharps" ? "flats" : "auto");
      if (e.key === " ") {
        const freqs = [spelledScale[0], spelledScale[2], spelledScale[4]].map((n,j)=> noteToFreq(n, j<2?4:5));
        playChord(freqs);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spelledScale, noteToFreq, playChord]);

  return (
    <div className="min-h-screen bg-[radial-gradient(60%_80%_at_70%_10%,rgba(99,102,241,.18),transparent),radial-gradient(50%_60%_at_20%_20%,rgba(236,72,153,.18),transparent)] bg-white text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-md" />
            <strong className="text-sm md:text-base">Circle of Fifths</strong>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <Seg active={mode==="major"} onClick={()=>setMode("major")}>Major</Seg>
            <Seg active={mode==="minor"} onClick={()=>setMode("minor")}>Minor (harmonic)</Seg>
            <label className="ml-2 inline-flex items-center gap-2 text-xs md:text-sm">
              <input type="checkbox" className="rounded border-slate-300" checked={showRel} onChange={(e)=>setShowRel(e.target.checked)} />
              <span>{mode==="major"?"Show relative minors":"Show relative majors"}</span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            {/* Enharmonic preference */}
            <div className="hidden md:flex items-center gap-1 text-xs">
              <span className="opacity-70">Enh</span>
              <Seg active={enhPref==="auto"}   onClick={()=>setEnhPref("auto")}>Auto</Seg>
              <Seg active={enhPref==="sharps"} onClick={()=>setEnhPref("sharps")}>♯</Seg>
              <Seg active={enhPref==="flats"}  onClick={()=>setEnhPref("flats")}>♭</Seg>
            </div>

            <label className="flex items-center gap-2 text-xs md:text-sm" title="Master volume">
              <span className="hidden sm:inline">Vol</span>
              <input aria-label="Master volume" type="range" min={0} max={1} step={0.01} value={muted?0:volume} onChange={(e)=>setVolume(Number(e.target.value))} className="w-24 accent-indigo-600" />
            </label>
            <button onClick={()=>setMuted(m=>!m)} className="px-2 py-1 rounded-lg border text-xs md:text-sm">{muted?"Unmute":"Mute"}</button>
          </div>
        </div>

        {/* Mobile toggles */}
        <div className="sm:hidden px-4 pb-2 flex items-center gap-2 text-xs">
          <span className="opacity-70">Enh</span>
          <Seg active={enhPref==="auto"}   onClick={()=>setEnhPref("auto")}>Auto</Seg>
          <Seg active={enhPref==="sharps"} onClick={()=>setEnhPref("sharps")}>♯</Seg>
          <Seg active={enhPref==="flats"}  onClick={()=>setEnhPref("flats")}>♭</Seg>
        </div>
        <div className="sm:hidden px-4 pb-3 flex items-center gap-2">
          <Seg active={mode==="major"} onClick={()=>setMode("major")}>Major</Seg>
          <Seg active={mode==="minor"} onClick={()=>setMode("minor")}>Minor</Seg>
          <label className="ml-1 inline-flex items-center gap-2 text-xs">
            <input type="checkbox" className="rounded" checked={showRel} onChange={(e)=>setShowRel(e.target.checked)} />
            <span>Rel</span>
          </label>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-4 py-6 grid gap-6 lg:grid-cols-[520px_1fr]">
        {/* Circle */}
        <section aria-label="Circle of Fifths" className="rounded-2xl bg-white/90 p-4 border border-slate-200 shadow-sm">
          <motion.svg
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            width={CENTER*2}
            height={CENTER*2}
            viewBox={`0 0 ${CENTER*2} ${CENTER*2}`}
            role="img"
          >
            {POSITIONS.map((p,i)=>{
              const a0 = -Math.PI/2 + (i*TAU)/12;
              const a1 = -Math.PI/2 + ((i+1)*TAU)/12;
              const path = arcPath(CENTER, CENTER, OUTER_R, INNER_R, a0, a1);
              const mid = (a0+a1)/2;
              const r = (OUTER_R+INNER_R)/2;
              const lx = CENTER + r*Math.cos(mid);
              const ly = CENTER + r*Math.sin(mid);
              const isSel = i===idx;

              const mainLabel = displayMain(p);
              const subLabel  = showRel ? displayRel(p) : "";

              const resolvedTonicRaw = mode==="major"
                ? resolveEnharmonic(p.major, p.acc, enhPref)
                : resolveEnharmonic(p.minor, p.acc, enhPref);

              return (
                <motion.g
                  key={i}
                  role="button"
                  tabIndex={0}
                  aria-label={`Select ${mainLabel}`}
                  className="cursor-pointer focus:outline-none"
                  whileHover={{ scale: 1.012 }}
                  onClick={()=>{
                    setIdx(i);
                    const local = buildScaleFromKeyName(resolvedTonicRaw, mode, enhPref);
                    const freqs = [local[0], local[2], local[4]].map((n,j)=> noteToFreq(n, j<2?4:5));
                    playChord(freqs);
                  }}
                  onKeyDown={(e)=>{
                    if(e.key==="Enter"||e.key===" "){
                      setIdx(i);
                      const local = buildScaleFromKeyName(resolvedTonicRaw, mode, enhPref);
                      const freqs = [local[0], local[2], local[4]].map((n,j)=> noteToFreq(n, j<2?4:5));
                      playChord(freqs);
                    }
                  }}
                  onMouseEnter={()=>{
                    const tonic = normalizeToken(resolvedTonicRaw);
                    // Some browsers need a click first to unlock audio
                    playFreq(noteToFreq(tonic,4));
                  }}
                >
                  <path d={path} fill={sliceFill(i,isSel)} stroke={sliceStroke(i)} strokeWidth={isSel?2:1} />
                  <text x={lx} y={ly-2} textAnchor="middle" fontSize={14} fontWeight={800} className="select-none fill-slate-900">
                    {mainLabel}
                  </text>
                  {subLabel && (
                    <text x={lx} y={ly+16} textAnchor="middle" fontSize={12} className="select-none fill-slate-600">
                      {subLabel}
                    </text>
                  )}
                </motion.g>
              );
            })}

            {/* Center label */}
            <defs>
              <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.35} />
                <stop offset="100%" stopColor="transparent" />
              </radialGradient>
            </defs>
            <circle cx={CENTER} cy={CENTER} r={INNER_R-40} fill="#fff" stroke="#e2e8f0" />
            <circle cx={CENTER} cy={CENTER} r={INNER_R-72} fill="url(#centerGlow)" />
            <text x={CENTER} y={CENTER-8} textAnchor="middle" fontSize={20} fontWeight={800}>
              {selectedPretty}
            </text>
            <text x={CENTER} y={CENTER+16} textAnchor="middle" fontSize={12}>
              {mode==="major" ? "Key" : "Scale (harmonic minor)"}
            </text>
          </motion.svg>
        </section>

        {/* Info + Chords */}
        <section className="grid gap-6">
          {/* Overview */}
          <div className="rounded-2xl bg-white/90 border border-slate-200 p-4 md:p-5">
            <h2 className="text-base md:text-lg font-semibold mb-3">{selectedPretty} overview</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <InfoTile label="Scale" value={spelledScale.map(pretty).join(" ")} />
              <InfoTile label={mode==="major"?"Relative minor":"Relative major"} value={relativePretty} />
              <InfoTile label="Accidentals" value={
                (() => {
                  const tonic = normalizeToken(tonicNameForSpelling);
                  const sig = mode==="major"
                    ? signatureForMajorName(tonic)
                    : signatureForMajorName(relativeMajorFromMinor(tonicNameForSpelling, enhPref));
                  if (sig.count === 0) return "—";
                  const order = sig.type === "#" ? ORDER_SHARPS : ORDER_FLATS;
                  return order.slice(0, sig.count).map(pretty).join(" ");
                })()
              } />
            </div>
          </div>

          {/* Chord palette */}
          <div className="rounded-2xl bg-white/90 border border-slate-200 p-4 md:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base md:text-lg font-semibold">Diatonic {useSevenths ? "7th chords" : "triads"}</h3>
              <label className="inline-flex items-center gap-2 text-sm opacity-90">
                <input type="checkbox" className="rounded border-slate-300" checked={useSevenths} onChange={(e)=>setUseSevenths(e.target.checked)} />
                <span>Use 7th chords</span>
              </label>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {chords.map((c,i)=>(
                <motion.button
                  key={i}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={()=>{
                    const freqs = c.tones.map((n,j)=> (j<2 ? noteToFreq(n,4) : noteToFreq(n,5)));
                    playChord(freqs);
                  }}
                  className="text-left rounded-xl border bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-white p-3 shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <div className="text-[11px] opacity-85">{c.rn}</div>
                  <div className="font-semibold leading-tight">{c.tones.map(pretty).join(" ")}</div>
                </motion.button>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="max-w-6xl mx-auto px-4 pb-8 text-xs opacity-70">
        Tip: ←/→ navigate • M Major/Minor • 7 toggle 7ths • H cycles Enh (Auto → ♯ → ♭) • Space plays tonic.
      </footer>
    </div>
  );
}
