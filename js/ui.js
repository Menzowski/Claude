/* Rendering + DOM helpers. Keeps DOM lookups and screen switching in one place. */
window.UI = (function () {
  const $ = (sel) => document.querySelector(sel);
  const screens = ["setup", "setter", "handoff", "guesser", "result"];

  function show(name) {
    screens.forEach((s) => {
      const el = document.getElementById("screen-" + s);
      if (el) el.classList.toggle("hidden", s !== name);
    });
    window.scrollTo(0, 0);
  }

  function fmtTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  // ---- Setup screen ----
  function renderSetup() {
    const players = window.Store.getPlayers();
    const scores = window.Store.getScores();
    $("#player1").value = players[0];
    $("#player2").value = players[1];
    $("#score-name-1").textContent = players[0];
    $("#score-name-2").textContent = players[1];
    $("#score-val-1").textContent = scores[0];
    $("#score-val-2").textContent = scores[1];
    $("#chooser-0").textContent = players[0];
    $("#chooser-1").textContent = players[1];
  }

  function setChosenSetter(idx) {
    $("#chooser-0").classList.toggle("selected", idx === 0);
    $("#chooser-1").classList.toggle("selected", idx === 1);
  }

  // ---- Setter screen ----
  function renderCategoryGrid(onPick) {
    const grid = $("#category-grid");
    grid.innerHTML = "";
    Object.values(window.CATEGORIES).forEach((cat) => {
      const btn = document.createElement("button");
      btn.className = "category-tile";
      btn.dataset.cat = cat.id;
      btn.innerHTML = '<span class="cat-emoji">' + cat.emoji + "</span><span>" + cat.label + "</span>";
      btn.addEventListener("click", () => onPick(cat.id));
      grid.appendChild(btn);
    });
  }

  function selectCategoryTile(catId) {
    document.querySelectorAll(".category-tile").forEach((t) => {
      t.classList.toggle("selected", t.dataset.cat === catId);
    });
    const cat = window.CATEGORIES[catId];

    $("#custom-label-field").classList.toggle("hidden", !cat.hasCustomLabel);
    $("#range-fields").classList.toggle("hidden", !cat.hasRange);
    $("#secret-label").textContent = cat.secretLabel;
    const input = $("#secret-input");
    input.type = cat.inputType === "number" ? "number" : "text";
    input.value = "";

    // preset prompt chips
    const hints = $("#prompt-hints");
    hints.innerHTML = "";
    if (cat.prompts && cat.prompts.length) {
      const lbl = document.createElement("span");
      lbl.className = "hint-lead";
      lbl.textContent = "Ideas: ";
      hints.appendChild(lbl);
      cat.prompts.forEach((p) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "prompt-chip";
        chip.textContent = p;
        chip.addEventListener("click", () => {
          input.value = p;
          input.focus();
        });
        hints.appendChild(chip);
      });
    }
  }

  function setSetterName(name) {
    $("#setter-name").textContent = name;
  }

  // ---- Handoff ----
  function setHandoffText(guesserName) {
    $("#handoff-text").textContent = "Pass the device to " + guesserName;
  }

  // ---- Guesser screen ----
  function renderGuesserStart(round) {
    const cat = window.CATEGORIES[round.category];
    const label = round.category === "custom" ? round.customLabel || "Custom" : cat.label;
    $("#guesser-name").textContent = round.players[round.guesserIndex];
    $("#guesser-category").textContent = round.category === "number"
      ? label + " (" + round.range.min + "–" + round.range.max + ")"
      : label;
    $("#question-count").textContent = "0";
    $("#guess-input").value = "";
    $("#hint-output").textContent = "";
    $("#answer-log").innerHTML = '<li class="muted">No answers yet.</li>';
    $("#hint-btn").classList.remove("hidden");
  }

  function setQuestionCount(n) {
    $("#question-count").textContent = n;
  }

  function renderLog(log) {
    const ol = $("#answer-log");
    if (!log.length) {
      ol.innerHTML = '<li class="muted">No answers yet.</li>';
      return;
    }
    ol.innerHTML = "";
    log.forEach((entry, i) => {
      const li = document.createElement("li");
      li.className = "log-" + entry.answer.toLowerCase().replace(/\s+/g, "");
      li.innerHTML = '<span class="log-q">Q' + (i + 1) + "</span> " + entry.answer;
      ol.appendChild(li);
    });
    ol.scrollTop = ol.scrollHeight;
  }

  function setHint(text) {
    $("#hint-output").textContent = text;
  }

  function setTimer(seconds) {
    $("#timer").textContent = fmtTime(seconds);
  }

  // ---- Result screen ----
  function renderResult({ correct, answer, questions, seconds }) {
    $("#result-emoji").textContent = correct ? "🎉" : "🙈";
    $("#result-title").textContent = correct ? "Correct!" : "Not quite…";
    $("#result-answer").textContent = answer;
    $("#recap-questions").textContent = questions;
    $("#recap-time").textContent = fmtTime(seconds);
  }

  return {
    $,
    show,
    fmtTime,
    renderSetup,
    setChosenSetter,
    renderCategoryGrid,
    selectCategoryTile,
    setSetterName,
    setHandoffText,
    renderGuesserStart,
    setQuestionCount,
    renderLog,
    setHint,
    setTimer,
    renderResult,
  };
})();
