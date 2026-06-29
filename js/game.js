/* Round state machine. Holds the current round's data and the logic for
   hints, answer logging, and judging a guess. UI reads/writes via these. */
window.Game = (function () {
  let round = null;

  function newRound({ setterIndex, players }) {
    round = {
      setterIndex: setterIndex,
      guesserIndex: setterIndex === 0 ? 1 : 0,
      players: players,
      category: null, // category id
      customLabel: "",
      secret: "",
      range: { min: 0, max: 100 },
      questions: 0,
      log: [], // { answer }
      revealedLetters: 0,
      startTime: null,
      endTime: null,
    };
    return round;
  }

  function get() {
    return round;
  }

  function setSecret({ category, secret, customLabel, range }) {
    round.category = category;
    round.secret = secret;
    round.customLabel = customLabel || "";
    if (range) round.range = range;
  }

  function startGuessing() {
    round.startTime = Date.now();
  }

  function addQuestion() {
    round.questions += 1;
    return round.questions;
  }

  function logAnswer(answer) {
    round.questions = Math.max(round.questions, round.log.length + 1);
    round.log.push({ answer: answer });
    return round.log;
  }

  // Returns a hint string appropriate to the category.
  function getHint(guessValue) {
    const cat = round.category;
    if (cat === "number") {
      const secret = Number(round.secret);
      const guess = Number(guessValue);
      if (!guessValue && guessValue !== 0) {
        return "Type a number in the guess box first, then ask for a hint.";
      }
      if (guess === secret) return "That's exactly it!";
      return guess < secret ? "⬆️ Higher than that." : "⬇️ Lower than that.";
    }
    // word / animal / custom — reveal one more letter
    round.revealedLetters += 1;
    const s = String(round.secret);
    const n = Math.min(round.revealedLetters, s.length);
    let shown = "";
    for (let i = 0; i < s.length; i++) {
      if (s[i] === " ") shown += "  ";
      else shown += i < n ? s[i] : "_";
      shown += "";
    }
    return "🔤 " + shown.split("").join(" ");
  }

  function judge(guessValue) {
    const cat = window.CATEGORIES[round.category];
    const correct = cat.matches(guessValue, round.secret);
    if (correct && !round.endTime) {
      round.endTime = Date.now();
    }
    return correct;
  }

  function elapsedSeconds() {
    if (!round.startTime) return 0;
    const end = round.endTime || Date.now();
    return Math.floor((end - round.startTime) / 1000);
  }

  return {
    newRound,
    get,
    setSecret,
    startGuessing,
    addQuestion,
    logAnswer,
    getHint,
    judge,
    elapsedSeconds,
  };
})();
