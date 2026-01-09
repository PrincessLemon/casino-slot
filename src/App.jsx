// src/App.jsx
import { useEffect, useRef, useState } from "react";
import "./App.css";

const SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "🍀", "7️⃣", "🍇", "💎", "🍉", "🥥", "🍓", "👑"];
const MAX_BET = 10;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeReel() {
  return shuffle(SYMBOLS);
}

function Reel({ symbols, pos, spinning, highlightRows }) {
  const len = symbols.length;
  const top = symbols[(pos - 1 + len) % len];
  const mid = symbols[pos % len];
  const bot = symbols[(pos + 1) % len];

  return (
    <div className={`reel ${spinning ? "spinning" : ""}`}>
      <div className={`cell ${highlightRows.has("top") ? "winCell" : ""}`}>{top}</div>
      <div className={`cell mid ${highlightRows.has("mid") ? "winCell" : ""}`}>{mid}</div>
      <div className={`cell ${highlightRows.has("bot") ? "winCell" : ""}`}>{bot}</div>
    </div>
  );
}

export default function App() {
  // Reels are state (render) + ref (correct evaluation inside timers)
  const [reels, setReels] = useState(() => [makeReel(), makeReel(), makeReel()]);
  const reelsRef = useRef(reels);

  useEffect(() => {
    reelsRef.current = reels;
  }, [reels]);

  const [pos, setPos] = useState([0, 0, 0]);
  const [spinning, setSpinning] = useState(false);

  const [credits, setCredits] = useState(100);
  const [bet, setBet] = useState(1);

  const [extraLines, setExtraLines] = useState(false);

  const [message, setMessage] = useState("Press SPIN to play.");
  const [lastWins, setLastWins] = useState([]); // [{ payout, lineName, symbol, matchCount }]

  // Audio
  const spinSfxRef = useRef(null);
  const winSfxRef = useRef(null);
  const musicRef = useRef(null);

  const [musicOn, setMusicOn] = useState(false);
  const [musicVol, setMusicVol] = useState(0.35);
  const [sfxVol, setSfxVol] = useState(0.9);

  const intervalsRef = useRef([null, null, null]);
  const timeoutsRef = useRef([]);

  // Derived costs
  const lineCount = extraLines ? 3 : 1;
  const spinCost = bet * lineCount;
  const betCap = Math.min(MAX_BET, Math.floor(credits / lineCount));

  // Create audio objects once (GitHub Pages-safe paths using BASE_URL)
  useEffect(() => {
    const BASE = import.meta.env.BASE_URL; // e.g. "/casino-slot/"

    spinSfxRef.current = new Audio(`${BASE}audio/spinbutton.wav`);
    winSfxRef.current = new Audio(`${BASE}audio/win.wav`);

    const music = new Audio(`${BASE}audio/background.mp3`);
    music.loop = true;
    musicRef.current = music;

    return () => {
      try {
        music.pause();
      } catch {}
    };
  }, []);

  // Keep volumes in sync
  useEffect(() => {
    if (musicRef.current) musicRef.current.volume = musicVol;
  }, [musicVol]);

  useEffect(() => {
    if (spinSfxRef.current) spinSfxRef.current.volume = sfxVol;
    if (winSfxRef.current) winSfxRef.current.volume = sfxVol;
  }, [sfxVol]);

  // Keep bet valid if credits OR line mode changes
  useEffect(() => {
    const cap = Math.min(MAX_BET, Math.floor(credits / (extraLines ? 3 : 1)));
    setBet((b) => clamp(b, 1, Math.max(1, cap)));
  }, [credits, extraLines]);

  function stopAllTimers() {
    intervalsRef.current.forEach((id) => id && clearInterval(id));
    intervalsRef.current = [null, null, null];

    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current = [];
  }

  function safePlay(audio) {
    if (!audio) return;
    try {
      audio.currentTime = 0;
      audio.play();
    } catch {}
  }

  async function toggleMusic() {
    const next = !musicOn;
    setMusicOn(next);

    const music = musicRef.current;
    if (!music) return;

    try {
      if (next) {
        music.volume = musicVol;
        await music.play();
      } else {
        music.pause();
      }
    } catch {
      if (!next) {
        try {
          music.pause();
        } catch {}
      }
    }
  }

  function getLines(p, reelsSnap) {
    const len = reelsSnap[0].length;
    const idx = (i) => (i + len) % len;

    const top = [idx(p[0] - 1), idx(p[1] - 1), idx(p[2] - 1)];
    const mid = [idx(p[0]), idx(p[1]), idx(p[2])];
    const bot = [idx(p[0] + 1), idx(p[1] + 1), idx(p[2] + 1)];

    const lines = [{ name: "mid", label: "Center", indexes: mid }];
    if (extraLines) {
      lines.unshift({ name: "top", label: "Top", indexes: top });
      lines.push({ name: "bot", label: "Bottom", indexes: bot });
    }
    return lines;
  }

  // Pay ALL winning lines
  function evaluateWins(p, reelsSnap) {
    const lines = getLines(p, reelsSnap);
    const wins = [];

    for (const line of lines) {
      const s0 = reelsSnap[0][line.indexes[0]];
      const s1 = reelsSnap[1][line.indexes[1]];
      const s2 = reelsSnap[2][line.indexes[2]];

      let matchCount = 0;
      let symbol = null;

      if (s0 === s1 && s1 === s2) {
        matchCount = 3;
        symbol = s0;
      } else if (s0 === s1) {
        matchCount = 2;
        symbol = s0;
      } else if (s1 === s2) {
        matchCount = 2;
        symbol = s1;
      } else if (s0 === s2) {
        matchCount = 2;
        symbol = s0;
      }

      if (matchCount >= 2) {
        const payout = matchCount === 3 ? bet * 5 : bet * 2;
        wins.push({ payout, lineName: line.name, symbol, matchCount });
      }
    }

    return wins;
  }

  function spin() {
    if (spinning) return;

    setLastWins([]);
    setMessage("");

    if (credits < spinCost) {
      setMessage("Not enough credits for that spin.");
      return;
    }

    // Reshuffle reels for THIS spin and lock them via ref so results match UI
    const spinReels = [makeReel(), makeReel(), makeReel()];
    reelsRef.current = spinReels;
    setReels(spinReels);

    // Random start positions for nicer feel
    setPos([
      Math.floor(Math.random() * spinReels[0].length),
      Math.floor(Math.random() * spinReels[1].length),
      Math.floor(Math.random() * spinReels[2].length),
    ]);

    setSpinning(true);
    setCredits((c) => c - spinCost);
    safePlay(spinSfxRef.current);

    const tickMs = 70;

    for (let r = 0; r < 3; r++) {
      intervalsRef.current[r] = setInterval(() => {
        setPos((prev) => {
          const next = [...prev];
          next[r] = Math.floor(Math.random() * spinReels[r].length);
          return next;
        });
      }, tickMs);
    }

    const stopTimes = [900, 1250, 1600];
    stopTimes.forEach((ms, r) => {
      const t = setTimeout(() => {
        if (intervalsRef.current[r]) {
          clearInterval(intervalsRef.current[r]);
          intervalsRef.current[r] = null;
        }

        const finalIndex = Math.floor(Math.random() * spinReels[r].length);
        setPos((prev) => {
          const next = [...prev];
          next[r] = finalIndex;
          return next;
        });

        if (r === 2) {
          const done = setTimeout(() => {
            setSpinning(false);

            setPos((finalPos) => {
              const reelsSnap = reelsRef.current;
              const wins = evaluateWins(finalPos, reelsSnap);

              if (wins.length > 0) {
                setLastWins(wins);

                const total = wins.reduce((sum, w) => sum + w.payout, 0);
                setCredits((c) => c + total);

                const prettyLine = (name) => (name === "mid" ? "Center" : name === "top" ? "Top" : "Bottom");
                const details = wins
                  .map((w) => `${prettyLine(w.lineName)}: ${w.symbol} x${w.matchCount} (+${w.payout})`)
                  .join(" • ");

                setMessage(`Win on ${wins.length} line(s)! +${total} — ${details}`);
                safePlay(winSfxRef.current);
              } else {
                setMessage("No win — try again!");
              }

              return finalPos;
            });
          }, 80);

          timeoutsRef.current.push(done);
        }
      }, ms);

      timeoutsRef.current.push(t);
    });
  }

  function reset() {
    stopAllTimers();
    setSpinning(false);
    setPos([0, 0, 0]);
    setCredits(100);
    setBet(1);
    setExtraLines(false);
    setLastWins([]);
    setMessage("Press SPIN to play.");

    const fresh = [makeReel(), makeReel(), makeReel()];
    reelsRef.current = fresh;
    setReels(fresh);

    if (musicOn) {
      try {
        musicRef.current?.pause();
      } catch {}
      setMusicOn(false);
    }
  }

  const highlightRows = new Set(lastWins.map((w) => w.lineName));
  const canSpin = !spinning && credits >= spinCost;

  const showResetBet = bet !== 1;
  const showMaxBet = betCap >= 1 && bet !== Math.max(1, betCap);

  return (
    <div className="page">
      <div className={`cabinet ${lastWins.length > 0 ? "cabinetWin" : ""}`}>
        <header className="topbar">
          <div className="brand">
            <div className="badge">🌙</div>
            <div>
              <h1>Lofi Slot</h1>
              <p className="sub">Cozy reels • chill vibes</p>
            </div>
          </div>

          <div className="stats">
            <div className="pill">
              <span className="pillLabel">Credits</span>
              <span className="pillValue">{credits}</span>
            </div>
            <div className="pill">
              <span className="pillLabel">Bet</span>
              <span className="pillValue">{bet}</span>
            </div>
            <div className="pill">
              <span className="pillLabel">Cost</span>
              <span className="pillValue">{spinCost}</span>
            </div>
          </div>
        </header>

        <div className="messageBar" role="status" aria-live="polite">
          {message}
        </div>

        <main className="layout">
          <section className="slotPanel">
            <div className="frame">
              <div className="reels">
                <Reel symbols={reels[0]} pos={pos[0]} spinning={spinning} highlightRows={highlightRows} />
                <Reel symbols={reels[1]} pos={pos[1]} spinning={spinning} highlightRows={highlightRows} />
                <Reel symbols={reels[2]} pos={pos[2]} spinning={spinning} highlightRows={highlightRows} />
              </div>
            </div>

            <div className="bottomControls">
              <div className="betControls">
                <button
                  className="btn ghost"
                  onClick={() => setBet((b) => clamp(b - 1, 1, Math.max(1, betCap)))}
                  disabled={spinning}
                  title="Decrease bet"
                >
                  −
                </button>

                <button
                  className="btn ghost"
                  onClick={() => setBet((b) => clamp(b + 1, 1, Math.max(1, betCap)))}
                  disabled={spinning}
                  title={`Increase bet (max ${Math.max(1, betCap)})`}
                >
                  +
                </button>

                {showResetBet && (
                  <button className="btn ghost" onClick={() => setBet(1)} disabled={spinning} title="Reset bet to 1">
                    Reset Bet
                  </button>
                )}

                {showMaxBet && (
                  <button
                    className="btn ghost"
                    onClick={() => setBet(Math.max(1, betCap))}
                    disabled={spinning}
                    title={`Set bet to max (up to ${MAX_BET} or your credits)`}
                  >
                    Max Bet
                  </button>
                )}

                <label className="toggle" title="Check top and bottom lines too (costs more)">
                  <input
                    type="checkbox"
                    checked={extraLines}
                    onChange={(e) => setExtraLines(e.target.checked)}
                    disabled={spinning}
                  />
                  <span>Extra win lines</span>
                </label>
              </div>

              <div className="audioPanel">
                <button className="btn ghost" onClick={toggleMusic}>
                  {musicOn ? "⏸️ Music" : "▶️ Music"}
                </button>

                <div className="slider">
                  <span className="sliderLabel">Music</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={musicVol}
                    onChange={(e) => setMusicVol(Number(e.target.value))}
                  />
                </div>

                <div className="slider">
                  <span className="sliderLabel">SFX</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={sfxVol}
                    onChange={(e) => setSfxVol(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          </section>

          <aside className="spinPanel">
            <div className="spinBox">
              <button className="btn spinBig" onClick={spin} disabled={!canSpin}>
                {spinning ? "…" : "SPIN"}
              </button>

              <button className="btn danger" onClick={reset} disabled={spinning}>
                Reset
              </button>

              <div className="payTable">
                <div className="payTitle">Payouts</div>
                <div className="payRow">
                  <span>2 of a kind</span>
                  <span>Bet × 2</span>
                </div>
                <div className="payRow">
                  <span>3 of a kind</span>
                  <span>Bet × 5</span>
                </div>
              </div>

              <div className="hint">If music won’t start, click music button once (browser autoplay rules).</div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
