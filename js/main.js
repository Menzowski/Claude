/* App bootstrap: wires DOM events to Game + Store + UI. */
(function () {
  const $ = UI.$;

  let chosenSetter = 0;
  let chosenCategory = null;
  let timerInterval = null;
  let lastResult = null; // { correct }

  // ---------- SETUP ----------
  function initSetup() {
    UI.renderSetup();
    UI.setChosenSetter(chosenSetter);
  }

  function savePlayers() {
    window.Store.setPlayers($("#player1").value.trim(), $("#player2").value.trim());
  }

  $("#player1").addEventListener("change", () => {
    savePlayers();
    UI.renderSetup();
    UI.setChosenSetter(chosenSetter);
  });
  $("#player2").addEventListener("change", () => {
    savePlayers();
    UI.renderSetup();
    UI.setChosenSetter(chosenSetter);
  });

  $("#reset-scores").addEventListener("click", () => {
    if (confirm("Reset both scores to 0?")) {
      window.Store.resetScores();
      UI.renderSetup();
    }
  });

  $("#setter-chooser").addEventListener("click", (e) => {
    const btn = e.target.closest(".choice");
    if (!btn) return;
    chosenSetter = Number(btn.dataset.setter);
    UI.setChosenSetter(chosenSetter);
  });

  $("#start-round").addEventListener("click", () => {
    savePlayers();
    const players = window.Store.getPlayers();
    Game.newRound({ setterIndex: chosenSetter, players: players });
    chosenCategory = null;
    UI.setSetterName(players[chosenSetter]);
    UI.renderCategoryGrid(onPickCategory);
    // reset setter input visibility
    document.querySelectorAll(".category-tile").forEach((t) => t.classList.remove("selected"));
    $("#secret-input").value = "";
    $("#custom-label").value = "";
    $("#prompt-hints").innerHTML = "";
    UI.show("setter");
  });

  // ---------- SETTER ----------
  function onPickCategory(catId) {
    chosenCategory = catId;
    UI.selectCategoryTile(catId);
  }

  $("#setter-back").addEventListener("click", () => UI.show("setup"));

  $("#hide-and-pass").addEventListener("click", () => {
    if (!chosenCategory) {
      alert("Pick a category first.");
      return;
    }
    const secret = $("#secret-input").value.trim();
    if (!secret) {
      alert("Type your secret answer first.");
      return;
    }
    const cat = window.CATEGORIES[chosenCategory];
    let customLabel = "";
    let range = null;

    if (cat.hasCustomLabel) {
      customLabel = $("#custom-label").value.trim();
      if (!customLabel) {
        alert("Give your custom category a name.");
        return;
      }
    }
    if (cat.hasRange) {
      const min = Number($("#range-min").value);
      const max = Number($("#range-max").value);
      if (min >= max) {
        alert("Max must be greater than Min.");
        return;
      }
      const n = Number(secret);
      if (n < min || n > max) {
        alert("Your secret number should be within the " + min + "–" + max + " range.");
        return;
      }
      range = { min: min, max: max };
    }

    Game.setSecret({ category: chosenCategory, secret, customLabel, range });
    const round = Game.get();
    UI.setHandoffText(round.players[round.guesserIndex]);
    UI.show("handoff");
  });

  // ---------- HANDOFF ----------
  $("#im-ready").addEventListener("click", () => {
    const round = Game.get();
    Game.startGuessing();
    UI.renderGuesserStart(round);
    startTimer();
    // show/hide hint button label per category (always available)
    UI.show("guesser");
  });

  // ---------- GUESSER ----------
  function startTimer() {
    stopTimer();
    UI.setTimer(0);
    timerInterval = setInterval(() => UI.setTimer(Game.elapsedSeconds()), 1000);
  }
  function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  $("#add-question").addEventListener("click", () => {
    UI.setQuestionCount(Game.addQuestion());
  });

  document.querySelector(".answer-buttons").addEventListener("click", (e) => {
    const btn = e.target.closest(".ans");
    if (!btn) return;
    const log = Game.logAnswer(btn.dataset.answer);
    UI.setQuestionCount(Game.get().questions);
    UI.renderLog(log);
  });

  $("#hint-btn").addEventListener("click", () => {
    const guess = $("#guess-input").value.trim();
    UI.setHint(Game.getHint(guess));
  });

  $("#submit-guess").addEventListener("click", submitGuess);
  $("#guess-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitGuess();
  });

  function submitGuess() {
    const guess = $("#guess-input").value.trim();
    if (!guess) {
      alert("Type your guess first.");
      return;
    }
    const correct = Game.judge(guess);
    if (!correct) {
      // Wrong guess: let them keep playing, but offer to give up via confirm
      const giveUp = confirm("“" + guess + "” is not it.\n\nOK = keep playing\nCancel = give up and reveal the answer");
      if (giveUp) {
        return; // keep playing
      }
      finishRound(false);
      return;
    }
    finishRound(true);
  }

  function finishRound(correct) {
    stopTimer();
    const round = Game.get();
    if (correct) {
      window.Store.addWin(round.guesserIndex);
    }
    lastResult = { correct };
    UI.renderResult({
      correct: correct,
      answer: round.category === "custom"
        ? round.secret + "  (" + round.customLabel + ")"
        : round.secret,
      questions: round.questions,
      seconds: Game.elapsedSeconds(),
    });
    UI.show("result");
  }

  // ---------- RESULT ----------
  $("#next-round").addEventListener("click", () => {
    // swap roles: previous guesser becomes setter
    const round = Game.get();
    chosenSetter = round.guesserIndex;
    $("#start-round").click();
  });

  $("#result-home").addEventListener("click", () => {
    initSetup();
    UI.show("setup");
  });

  // ---------- PWA service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---------- boot ----------
  initSetup();
  UI.show("setup");
})();
