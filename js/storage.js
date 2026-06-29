/* Thin wrapper around localStorage for player names + scoreboard.
   Falls back to an in-memory object if storage is unavailable (private mode). */
window.Store = (function () {
  const KEY = "guessit.v1";
  const fallback = {};
  let mem = null;

  function read() {
    if (mem) return mem;
    try {
      const raw = localStorage.getItem(KEY);
      mem = raw ? JSON.parse(raw) : {};
    } catch (e) {
      mem = fallback;
    }
    // defaults
    if (!mem.players) mem.players = ["Player 1", "Player 2"];
    if (!mem.scores) mem.scores = [0, 0];
    return mem;
  }

  function write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(mem));
    } catch (e) {
      /* ignore — keep in memory only */
    }
  }

  return {
    getPlayers() {
      return read().players.slice();
    },
    setPlayers(p1, p2) {
      const m = read();
      m.players = [p1 || "Player 1", p2 || "Player 2"];
      write();
    },
    getScores() {
      return read().scores.slice();
    },
    addWin(playerIndex) {
      const m = read();
      m.scores[playerIndex] = (m.scores[playerIndex] || 0) + 1;
      write();
    },
    resetScores() {
      const m = read();
      m.scores = [0, 0];
      write();
    },
  };
})();
