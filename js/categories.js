/* Category definitions and preset prompt lists.
   Each category controls how the Setter enters a secret and how hints work. */
window.CATEGORIES = {
  number: {
    id: "number",
    label: "Number / Age",
    emoji: "🔢",
    secretLabel: "Secret number",
    inputType: "number",
    hasRange: true,
    // Preset ideas shown to the setter for inspiration
    prompts: ["An age", "A house number", "A year", "Shoe size", "A temperature"],
    // Compare numerically
    matches: (guess, secret) => Number(guess) === Number(secret),
  },
  animal: {
    id: "animal",
    label: "Animal",
    emoji: "🦊",
    secretLabel: "Secret animal",
    inputType: "text",
    hasRange: false,
    prompts: ["Penguin", "Octopus", "Red panda", "Kangaroo", "Axolotl", "Hedgehog"],
    matches: textMatch,
  },
  word: {
    id: "word",
    label: "Word / Person / Place",
    emoji: "🌍",
    secretLabel: "Secret word, person or place",
    inputType: "text",
    hasRange: false,
    prompts: ["Eiffel Tower", "Beyoncé", "Pizza", "Mount Everest", "Cleopatra", "Tokyo"],
    matches: textMatch,
  },
  custom: {
    id: "custom",
    label: "Custom",
    emoji: "✨",
    secretLabel: "Secret answer",
    inputType: "text",
    hasRange: false,
    hasCustomLabel: true,
    prompts: [],
    matches: textMatch,
  },
};

// Case-insensitive, whitespace-trimmed text comparison
function textMatch(guess, secret) {
  const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");
  return norm(guess) === norm(secret);
}
