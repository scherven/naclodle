/** naclodle: page wiring. Rules live in game/state.ts, grading in game/text.ts. */

import "./style.css";
import { copy, RULES, type CopyKey, type RulesControl } from "./copy";
import { validatePuzzle, type Puzzle, type PuzzleIndex } from "./puzzle";
import { colourCss, MAX_COLOURS, newColour } from "./game/colours";
import {
  allSolved, canCheck, canCheckPairs, checkAnswers, checkPairs, freshState, hintsUsed, isOver, maxScore, placeRemainingPairs,
  score, shareText, swapTranslations, testItems, unpairedRows, verdictFor,
  type GameState, type Paint, type Side, type Split, type TestItem,
} from "./game/state";
import { closestAccepted, longestCommonSubsequence, normalise, words } from "./game/text";
import { emptyStats, recordResult, summarise, type Stats } from "./game/stats";

const STATS_KEY = "naclodle:stats";

/* ---------------- loading ---------------- */

const root = document.getElementById("app")!;

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function fetchPuzzle(path: string): Promise<Puzzle> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Couldn't load ${path}.`);
  return response.json();
}

async function loadPuzzle(): Promise<Puzzle> {
  // #draft-<seed>: a one-off made with `npm run generate -- draft` (local only, never scheduled)
  const draft = location.hash.match(/^#(draft-[\w-]+)$/);
  if (draft) return checked(await fetchPuzzle(`puzzles/drafts/${draft[1]}.json`));
  // #shelved-<name>: a finished puzzle in shelved/ that isn't scheduled (deployed, so it can be previewed)
  const shelved = location.hash.match(/^#shelved-([\w-]+)$/);
  if (shelved) return checked(await fetchPuzzle(`puzzles/shelved/${shelved[1]}.json`));
  const index: PuzzleIndex = await (await fetch("puzzles/index.json")).json();
  const requestedDate = /^#\d{4}-\d{2}-\d{2}$/.test(location.hash) ? location.hash.slice(1) : todayIso();
  const byDate = index.puzzles.slice().sort((first, second) => first.date.localeCompare(second.date));
  // the puzzle for that date, or the latest one before it
  const entry = [...byDate].reverse().find(candidate => candidate.date <= requestedDate) ?? byDate[0];
  if (!entry) throw new Error("No puzzles scheduled.");
  const puzzle = await fetchPuzzle("puzzles/" + entry.file);
  if (!entry.shuffle) delete puzzle.shuffle; // shuffling is decided by the schedule, not the file
  return checked(puzzle);
}

function checked(puzzle: Puzzle): Puzzle {
  const problems = validatePuzzle(puzzle);
  if (problems.length) throw new Error("Puzzle file is invalid: " + problems.join("; "));
  return puzzle;
}

const storage = {
  read<T>(key: string, fallback: T): T {
    try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; }
  },
  write(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: play without saving */ }
  },
};

const escapeHtml = (text: string) =>
  String(text).replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]!));
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

loadPuzzle().then(startGame).catch(error => {
  root.innerHTML = `<p class="error">${escapeHtml(error.message || String(error))}</p>`;
});

/* ---------------- the game ---------------- */

function startGame(puzzle: Puzzle) {
  const storageKey = "naclodle:" + puzzle.id;
  let state: GameState = Object.assign(freshState(puzzle), storage.read<Partial<GameState>>(storageKey, {}));
  const save = () => storage.write(storageKey, state);
  const update = (next: GameState) => { state = next; save(); };

  const items = testItems(puzzle);
  const languageName = puzzle.language.name;
  const locale = puzzle.language.locale;
  const isShuffled = !!puzzle.shuffle;
  const lowercase = (text: string, side: Side) => text.toLocaleLowerCase(side === "lang" ? locale || "und" : "en");
  const wordKey = (text: string, side: Side) => normalise(text, locale, side === "en");

  document.title = `naclodle ${puzzle.number}`;
  document.body.classList.toggle("shuffled", isShuffled);
  const copyBlock = (key: CopyKey, className = "") => {
    const text = copy(key, languageName);
    return text === null ? "" : `<div class="copy ${className}">${escapeHtml(text)}</div>`;
  };
  const dateLabel = new Date(puzzle.date + "T12:00:00")
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const difficultyDots = "●".repeat(puzzle.difficulty) + "○".repeat(5 - puzzle.difficulty);
  const keysHtml = puzzle.keys.length
    ? `<div class="keys" id="keys"><button type="button" class="shift" id="shiftKey" aria-pressed="false" tabindex="-1" title="Capitals (or hold Shift)">⇧</button>` +
      puzzle.keys.map(key => `<button type="button" data-key="${escapeHtml(key)}" tabindex="-1">${escapeHtml(key)}</button>`).join("") + `</div>`
    : "";

  /* ---------- the "How to play" panel ---------- */
  function rulesControlHtml(control: RulesControl): string {
    const sampleKeys = (puzzle.keys.length ? puzzle.keys : ["ŋ", "ə", "ʔ"]).slice(0, 3);
    switch (control) {
      case "colours": return [1, 2, 3].map(id => `<span class="sw" data-colour="${id}"></span>`).join("");
      case "numberKeys": return `<span class="key-replica mono">1–9</span>`;
      case "addColour": return `<span class="sw-add">+</span>`;
      case "allOne": return `<span class="seg-replica"><span class="on">all</span><span>one</span></span>`;
      case "split": return `<span class="tog-replica">a|b</span>`;
      case "clear": return `<span class="text-replica">clear</span>`;
      case "drag": return `<span class="text-replica">⠿</span>`;
      case "hint": return `<span class="text-replica">hint <span class="cost">−1</span></span>`;
      case "checkPairs": return `<span class="text-replica">check pairs <span class="cost">−1</span></span>`;
      case "letterKeys": return `<span class="key-replica mono">⇧</span>` + sampleKeys.map((key: string) => `<span class="key-replica">${escapeHtml(key)}</span>`).join("");
      case "check": return `<span class="btn-replica">Check</span>`;
      case "right": return `<span class="verdict ok">✓</span>`;
      case "almost": return `<span class="verdict near">≈</span>`;
      case "wrong": return `<span class="verdict bad">✗</span>`;
    }
  }
  function rulesHtml(): string {
    const sections = RULES.sections.map(section =>
      `<div class="rules-block"><div class="ex-h">${escapeHtml(section.heading)}</div><div class="rules-rows">` +
      section.rows.map(row => `<div class="rules-control">${rulesControlHtml(row.control)}</div><div class="rules-text">${escapeHtml(row.text)}</div>`).join("") +
      `</div></div>`).join("");
    return `<div class="rules-head"><h2 id="rulesTitle">${escapeHtml(RULES.title)}</h2>` +
      `<button type="button" class="rules-close" id="rulesClose" aria-label="Close">×</button></div>` +
      `<p class="rules-goal">${escapeHtml(RULES.goal)}</p>${sections}`;
  }

  root.innerHTML = `
    <header>
      <span class="mark">naclodle</span>
      <span class="meta"><span>No. ${String(puzzle.number).padStart(3, "0")}</span><span>${escapeHtml(dateLabel)}</span>
        <span class="dots" title="difficulty ${puzzle.difficulty} of 5">${difficultyDots}</span>
        <button type="button" class="info" id="infoButton" aria-label="How to play" title="How to play" aria-haspopup="dialog">i</button></span>
    </header>
    <div class="lede"><h1>${escapeHtml(languageName)}</h1>${copyBlock("tagline", "small")}${copyBlock("intro")}</div>
    <div class="corpus-wrap">${isShuffled ? copyBlock("pairIntro", "small") : ""}<div class="corpus" id="corpus"></div></div>
    ${copyBlock("note", "small")}
    <div class="tools">
      <div class="hints">
        ${isShuffled ? `<button type="button" id="checkPairsButton">check pairs <span class="cost">−1</span></button>` : ""}
        <button type="button" id="hintButton">hint <span class="cost">−1</span></button>
      </div>
      <div class="swatches" id="swatches" aria-label="Highlighter"></div>
    </div>
    <div class="hint-text" id="hintText" hidden></div>
    <details class="notes"><summary>notes</summary>
      <textarea id="notes" spellcheck="false" aria-label="Notes"></textarea></details>
    ${puzzle.toEnglish.length ? `<section><div class="task-h"><span class="letter">A</span>${copyBlock("taskA")}</div><div class="items" id="itemsToEnglish"></div></section>` : ""}
    ${puzzle.toLang.length ? `<section><div class="task-h"><span class="letter">${puzzle.toEnglish.length ? "B" : "A"}</span>${copyBlock("taskB")}</div>
      ${keysHtml}<div class="items" id="itemsToLanguage"></div></section>` : ""}
    <div class="actions"><button class="btn" id="checkButton">Check</button><span class="pips" id="checkPips" title="checks used"></span></div>
    <div class="done" id="done" hidden>
      <div id="doneMessage"></div>
      <div class="score" id="score"></div>
      <pre class="share" id="share"></pre>
      <div><button class="btn ghost-btn" id="copyShareButton">Copy result</button></div>
      <div class="stats" id="stats"></div>
    </div>
    <section class="explain" id="explain" hidden></section>
    ${copyBlock("footer")}
    <dialog class="rules" id="rules" aria-labelledby="rulesTitle">${rulesHtml()}</dialog>`;

  const rulesDialog = byId<HTMLDialogElement>("rules");
  byId("infoButton").addEventListener("click", () => rulesDialog.showModal());
  byId("rulesClose").addEventListener("click", () => rulesDialog.close());
  // a click on the dimmed backdrop (outside the panel's box) closes it
  rulesDialog.addEventListener("click", event => {
    const bounds = rulesDialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) rulesDialog.close();
  });

  /* ---------- highlighting and split marks ---------- */

  let transientHighlight: Paint | null = null;  // the yellow highlight when no colour is picked
  let activeColour: number | null = null;
  let splitMode = false;
  let drawingAnswerOverlay = false;              // split marks would shift text under an input, so skip them there

  function renderWord(word: string, side: Side, location: string): string {
    const key = wordKey(word, side);
    let lowered = lowercase(word, side);
    if (lowered.length !== word.length) lowered = word.toLowerCase();
    const letterClass: (string | null)[] = Array(word.length).fill(null);
    const applyPaint = (paint: Paint, className: string) => {
      if ("location" in paint) {
        if (paint.location !== location) return;
        if ("start" in paint) for (let letter = paint.start; letter < paint.end && letter < word.length; letter++) letterClass[letter] = className;
        else letterClass.fill(className);
        return;
      }
      if (paint.side !== side) return;
      if (paint.wholeWord) { if (key === paint.query) letterClass.fill(className); return; }
      let searchFrom = 0, found: number;
      while (paint.query && (found = lowered.indexOf(paint.query, searchFrom)) !== -1) {
        for (let letter = found; letter < found + paint.query.length; letter++) letterClass[letter] = className;
        searchFrom = found + paint.query.length;
      }
    };
    state.paints.forEach(paint => applyPaint(paint, "c" + paint.colour));
    if (transientHighlight) applyPaint(transientHighlight, "transient");

    const splitPositions = new Set<number>();
    if (!drawingAnswerOverlay) for (const split of state.splits) {
      const applies = "location" in split ? split.location === location : split.side === side && split.word === key;
      if (applies) splitPositions.add(split.position);
    }

    let html = "", runStart = 0;
    while (runStart < word.length) {
      let runEnd = runStart + 1;
      while (runEnd < word.length && letterClass[runEnd] === letterClass[runStart] && !splitPositions.has(runEnd)) runEnd++;
      const text = escapeHtml(word.slice(runStart, runEnd)), className = letterClass[runStart];
      html += className ? `<mark class="${className === "transient" ? "" : className}">${text}</mark>` : text;
      if (runEnd < word.length && splitPositions.has(runEnd)) html += `<span class="brk"></span>`;
      runStart = runEnd;
    }
    return `<span class="w" data-side="${side}" data-key="${escapeHtml(key)}" data-location="${location}">${html}</span>`;
  }
  // only the word itself is clickable and highlightable, never its punctuation
  function renderToken(token: string, side: Side, location: string) {
    const parts = token.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
    if (!parts || !parts[2]) return escapeHtml(token);
    const [, before, word, after] = parts;
    return escapeHtml(before) + renderWord(word, side, location) + escapeHtml(after);
  }
  function renderSentence(sentence: string, side: Side, locationPrefix: string) {
    let wordIndex = 0;
    return sentence.split(/(\s+)/)
      .map(token => (!token || /^\s+$/.test(token)) ? token : renderToken(token, side, `${locationPrefix}:${wordIndex++}`))
      .join("");
  }
  function renderGlossed(sentence: string, glosses: string[], row: number, locationPrefix: string) {
    return sentence.split(/\s+/).map((token, wordIndex) =>
      `<span class="ig" style="--r:${row};--i:${wordIndex}"><span>${renderToken(token, "lang", `${locationPrefix}:${wordIndex}`)}</span>` +
      `<span class="g">${escapeHtml(glosses[wordIndex] || "")}</span></span>`).join("");
  }

  const paintIdentity = (paint: Paint) => "location" in paint
    ? `${paint.location}|${"start" in paint ? paint.start + "-" + paint.end : "word"}`
    : `${paint.side}|${paint.wholeWord ? "word" : "letters"}|${paint.query}`;
  function togglePaint(paint: Paint) {
    paint.colour = activeColour!;
    const existing = state.paints.findIndex(other => paintIdentity(other) === paintIdentity(paint));
    if (existing >= 0 && state.paints[existing].colour === activeColour) state.paints.splice(existing, 1);
    else if (existing >= 0) state.paints[existing].colour = activeColour!;
    else state.paints.push(paint);
    save(); renderAllText(); renderSwatches();
  }

  function letterOffsetAt(wordElement: HTMLElement, x: number, y: number): number | null {
    let node: Node | null = null, offset = 0;
    const doc = document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null };
    if (doc.caretPositionFromPoint) {
      const caret = doc.caretPositionFromPoint(x, y); if (!caret) return null;
      node = caret.offsetNode; offset = caret.offset;
    } else if (document.caretRangeFromPoint) {
      const caret = document.caretRangeFromPoint(x, y); if (!caret) return null;
      node = caret.startContainer; offset = caret.startOffset;
    }
    if (!node || !wordElement.contains(node)) return null;
    const range = document.createRange();
    range.selectNodeContents(wordElement); range.setEnd(node, offset);
    return range.toString().length;
  }
  function toggleSplit(wordElement: HTMLElement, x: number, y: number) {
    const position = letterOffsetAt(wordElement, x, y), length = (wordElement.textContent || "").length;
    if (position == null || position <= 0 || position >= length) return;
    const split: Split = state.matchAll
      ? { side: wordElement.dataset.side as Side, word: wordElement.dataset.key!, position }
      : { location: wordElement.dataset.location!, position };
    const identity = JSON.stringify(split);
    const existing = state.splits.findIndex(other => JSON.stringify(other) === identity);
    if (existing >= 0) state.splits.splice(existing, 1); else state.splits.push(split);
    save(); renderAllText();
  }

  function renderSwatches() {
    byId("paintStyles").textContent = colourCss(state.colours);
    const hasPaint = activeColour != null ? state.paints.some(paint => paint.colour === activeColour) : state.paints.length > 0;
    byId("swatches").innerHTML =
      state.colours.map(colour => `<button type="button" class="sw${activeColour === colour.id ? " active" : ""}" data-colour="${colour.id}" aria-label="Color ${colour.id}" aria-pressed="${activeColour === colour.id}"></button>`).join("") +
      (state.colours.length < MAX_COLOURS ? `<button type="button" class="sw-add" id="addColour" aria-label="New color" title="New color">+</button>` : "") +
      `<span class="sep"></span>` +
      `<span class="seg" role="group" aria-label="What a click highlights">` +
      `<button type="button" data-match="all" aria-pressed="${state.matchAll}" title="Every match">all</button>` +
      `<button type="button" data-match="one" aria-pressed="${!state.matchAll}" title="Only what you click">one</button></span>` +
      `<button type="button" class="tog" id="splitModeButton" aria-pressed="${splitMode}" title="Click between letters to mark where a word splits">a|b</button>` +
      (hasPaint ? `<button type="button" class="txt" id="clearPaint" title="${activeColour != null ? "Clear this color" : "Clear all colors"}">clear</button>` : "");
    document.body.classList.toggle("painting", activeColour != null);
    document.body.classList.toggle("splitting", splitMode);
  }
  byId("swatches").addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest("button"); if (!button) return;
    if (button.id === "addColour") {
      const colour = newColour(state.colours);
      state.colours.push(colour); activeColour = colour.id; splitMode = false; save();
    } else if (button.dataset.match) {
      state.matchAll = button.dataset.match === "all"; save();
    } else if (button.id === "splitModeButton") {
      splitMode = !splitMode; if (splitMode) activeColour = null;
    } else if (button.id === "clearPaint") {
      state.paints = activeColour != null ? state.paints.filter(paint => paint.colour !== activeColour) : []; save();
    } else if (button.dataset.colour) {
      const colourId = Number(button.dataset.colour);
      activeColour = activeColour === colourId ? null : colourId; transientHighlight = null; splitMode = false;
    }
    renderAllText(); renderSwatches();
  });
  document.addEventListener("keydown", event => {
    const target = event.target as HTMLElement;
    if (event.key === "Escape" && (activeColour != null || splitMode)) { activeColour = null; splitMode = false; renderSwatches(); }
    if (/^[1-9]$/.test(event.key) && !target.closest("input,textarea")) {
      const colour = state.colours[Number(event.key) - 1];
      if (colour) { activeColour = activeColour === colour.id ? null : colour.id; splitMode = false; renderSwatches(); }
    }
  });

  /* ---------- example sentences ---------- */

  function renderCorpus() {
    const gameOver = isOver(puzzle, state);
    byId("corpus").innerHTML = puzzle.corpus.map((line, row) => {
      const englishLine = state.translationOrder[row], locked = state.lockedRows.includes(row);
      let englishClass = "en";
      if (isShuffled) {
        const placedForPlayer = puzzle.shuffle!.anchors.includes(row) || state.revealedRows.includes(row);
        englishClass += locked ? " paired" + (placedForPlayer ? " given" : "") : " movable";
      }
      const grip = isShuffled && !locked
        ? `<button type="button" class="grip" data-row="${row}" aria-label="Drag translation ${row + 1}; arrow keys move it">⠿</button>` : "";
      const languageHtml = gameOver ? renderGlossed(line.lang, line.gloss, row, "L" + row) : renderSentence(line.lang, "lang", "L" + row);
      return `<span class="n">${row + 1}</span>` +
        `<span class="lang">${languageHtml}</span>` +
        `<span class="${englishClass}" data-row="${row}">${grip}${renderSentence(puzzle.corpus[englishLine].en, "en", "E" + englishLine)}</span>`;
    }).join("");
  }
  /** Re-render everything that shows highlightable text. */
  function renderAllText() {
    renderCorpus();
    document.querySelectorAll<HTMLElement>(".prompt").forEach(prompt => {
      prompt.innerHTML = renderSentence(prompt.dataset.text!, prompt.dataset.side as Side, "P" + prompt.dataset.item);
    });
    renderAnswerOverlays();
    if (isOver(puzzle, state)) renderAnswerKey();
  }

  /* ---------- drag and drop (shuffled days) ---------- */

  const corpusElement = byId("corpus");
  let drag: { row: number; ghost: HTMLElement; offsetX: number; offsetY: number; targetRow: number | null } | null = null;
  corpusElement.addEventListener("pointerdown", event => {
    const grip = (event.target as HTMLElement).closest<HTMLElement>(".grip");
    if (!grip || event.button > 0) return;
    event.preventDefault();
    const cell = grip.closest<HTMLElement>(".en")!, bounds = cell.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className = "ghost";
    ghost.textContent = (cell.textContent || "").replace("⠿", "").trim();
    Object.assign(ghost.style, { left: bounds.left + "px", top: bounds.top + "px", maxWidth: Math.max(bounds.width, 200) + "px" });
    document.body.appendChild(ghost);
    drag = { row: Number(grip.dataset.row), ghost, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top, targetRow: null };
    cell.classList.add("dragging"); document.body.classList.add("dragging-any");
    try { grip.setPointerCapture(event.pointerId); } catch { /* synthetic events have no real pointer */ }
  });
  document.addEventListener("pointermove", event => {
    if (!drag) return;
    drag.ghost.style.left = event.clientX - drag.offsetX + "px";
    drag.ghost.style.top = event.clientY - drag.offsetY + "px";
    if (event.clientY < 48) scrollBy(0, -12); else if (event.clientY > innerHeight - 48) scrollBy(0, 12);
    const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".en.movable");
    const targetRow = hovered && Number(hovered.dataset.row) !== drag.row ? Number(hovered.dataset.row) : null;
    if (targetRow !== drag.targetRow) {
      document.querySelectorAll(".en.drop").forEach(element => element.classList.remove("drop"));
      if (targetRow != null) hovered!.classList.add("drop");
      drag.targetRow = targetRow;
    }
  });
  const endDrag = () => {
    if (!drag) return;
    const { row, targetRow, ghost } = drag;
    drag = null;
    ghost.remove(); document.body.classList.remove("dragging-any");
    if (targetRow != null) swapAndShow(row, targetRow); else renderCorpus();
  };
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);
  corpusElement.addEventListener("keydown", event => {
    const grip = (event.target as HTMLElement).closest<HTMLElement>(".grip");
    if (!grip || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const movableRows = unpairedRows(state), row = Number(grip.dataset.row);
    const neighbour = movableRows[movableRows.indexOf(row) + (event.key === "ArrowUp" ? -1 : 1)];
    if (neighbour === undefined) return;
    swapAndShow(row, neighbour);
    document.querySelector<HTMLElement>(`.grip[data-row="${neighbour}"]`)?.focus();
  });
  function swapAndShow(firstRow: number, secondRow: number) {
    update(swapTranslations(state, firstRow, secondRow)); renderCorpus(); renderGameState();
    document.querySelectorAll(`.en[data-row="${firstRow}"], .en[data-row="${secondRow}"]`).forEach(element => element.classList.add("flash"));
  }

  /* ---------- clicks: highlighting, splitting ---------- */

  document.addEventListener("click", event => {
    const target = event.target as HTMLElement;
    if (target.closest(".grip")) return;
    const wordElement = target.closest<HTMLElement>(".w");
    if (String(getSelection() || "").trim()) return;
    if (!wordElement) {
      if (transientHighlight && !target.closest("input,button,textarea,summary")) { transientHighlight = null; renderAllText(); }
      return;
    }
    if (splitMode) { toggleSplit(wordElement, event.clientX, event.clientY); return; }
    const paint: Paint = state.matchAll
      ? { colour: 0, side: wordElement.dataset.side as Side, query: wordElement.dataset.key!, wholeWord: true }
      : { colour: 0, location: wordElement.dataset.location!, wholeWord: true };
    if (activeColour != null) { togglePaint(paint); return; }
    transientHighlight = transientHighlight && paintIdentity(transientHighlight) === paintIdentity(paint) ? null : paint;
    renderAllText();
  });
  document.addEventListener("mouseup", () => {
    if (drag) return;
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const wordElement = range.startContainer.parentElement?.closest<HTMLElement>(".w");
    const selected = String(selection);
    if (!wordElement || !selected.trim() || /\s/.test(selected) || range.endContainer.parentElement?.closest(".w") !== wordElement) return;
    const before = document.createRange();
    before.selectNodeContents(wordElement); before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length, side = wordElement.dataset.side as Side;
    const paint: Paint = state.matchAll
      ? { colour: 0, side, query: lowercase(selected, side), wholeWord: false }
      : { colour: 0, location: wordElement.dataset.location!, start, end: start + selected.length };
    selection.removeAllRanges();
    if (activeColour != null) { togglePaint(paint); return; }
    transientHighlight = paint; renderAllText();
  });

  /* ---------- test items ---------- */

  const itemHtml = (item: TestItem) => `<div class="item" id="item-${item.id}">
      <div class="prompt${item.isEnglish ? " lang" : ""}" data-side="${item.isEnglish ? "lang" : "en"}" data-item="${item.id}" data-text="${escapeHtml(item.prompt)}"></div>
      <div class="field"><div class="ov" id="overlay-${item.id}" aria-hidden="true"></div><input id="answer-${item.id}" data-item="${item.id}"
        autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Answer ${item.id}"></div>
      <span class="verdict" id="verdict-${item.id}"></span>
      <div class="key" id="key-${item.id}" hidden></div></div>`;
  const toEnglishItems = items.filter(item => item.isEnglish), toLanguageItems = items.filter(item => !item.isEnglish);
  if (toEnglishItems.length) byId("itemsToEnglish").innerHTML = toEnglishItems.map(itemHtml).join("");
  if (toLanguageItems.length) byId("itemsToLanguage").innerHTML = toLanguageItems.map(itemHtml).join("");


  const answerSide = (itemId: string): Side => (items.find(item => item.id === itemId)!.isEnglish ? "en" : "lang");
  // colours show through typed answers: a text-transparent copy of the answer sits under the input
  function renderAnswerOverlay(input: HTMLInputElement) {
    const overlay = byId("overlay-" + input.dataset.item);
    drawingAnswerOverlay = true;
    overlay.innerHTML = renderSentence(input.value, answerSide(input.dataset.item!), "Y" + input.dataset.item);
    drawingAnswerOverlay = false;
    overlay.scrollLeft = input.scrollLeft;
  }
  const answerInputs = () => Array.from(document.querySelectorAll<HTMLInputElement>(".item input"));
  const renderAnswerOverlays = () => answerInputs().forEach(renderAnswerOverlay);

  let lastFocusedInput: HTMLInputElement | null = null;
  for (const input of answerInputs()) {
    input.value = state.answers[input.dataset.item!] || "";
    input.addEventListener("focus", () => { lastFocusedInput = input; });
    input.addEventListener("input", () => {
      state.answers[input.dataset.item!] = input.value; save();
      const verdict = byId("verdict-" + input.dataset.item);
      if (!verdict.classList.contains("ok")) { verdict.textContent = ""; verdict.className = "verdict"; }
      renderAnswerOverlay(input); renderGameState();
    });
    input.addEventListener("scroll", () => renderAnswerOverlay(input));
    input.addEventListener("keydown", event => { if (event.key === "Enter") runCheck(); });
  }

  // on-screen letters: ⇧ capitalises the next letter (or hold Shift); capitals use the puzzle's locale (i → İ in Turkish)
  const keyboard = document.getElementById("keys");
  let shiftLatched = false, shiftHeld = false;
  const capitalsOn = () => shiftLatched || shiftHeld;
  const capitalise = (letter: string) => letter.toLocaleUpperCase(locale || "und");
  function renderKeyboard() {
    if (!keyboard) return;
    keyboard.querySelectorAll<HTMLElement>("button[data-key]").forEach(button => {
      button.textContent = capitalsOn() ? capitalise(button.dataset.key!) : button.dataset.key!;
    });
    byId("shiftKey").setAttribute("aria-pressed", String(capitalsOn()));
  }
  const setShiftHeld = (held: boolean) => { if (held !== shiftHeld) { shiftHeld = held; renderKeyboard(); } };
  document.addEventListener("keydown", event => { if (event.key === "Shift") setShiftHeld(true); });
  document.addEventListener("keyup", event => { if (event.key === "Shift") setShiftHeld(false); });
  addEventListener("blur", () => setShiftHeld(false));

  keyboard?.addEventListener("mousedown", event => event.preventDefault()); // keep focus in the answer
  keyboard?.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button"); if (!button) return;
    if (button.id === "shiftKey") { shiftLatched = !shiftLatched; renderKeyboard(); return; }
    const languageInputs = answerInputs().filter(input => answerSide(input.dataset.item!) === "lang" && !input.disabled);
    const input = lastFocusedInput && languageInputs.includes(lastFocusedInput) ? lastFocusedInput : languageInputs[0];
    if (!input) return;
    const character = capitalsOn() || event.shiftKey ? capitalise(button.dataset.key!) : button.dataset.key!;
    const selectionStart = input.selectionStart ?? input.value.length, selectionEnd = input.selectionEnd ?? selectionStart;
    input.value = input.value.slice(0, selectionStart) + character + input.value.slice(selectionEnd);
    input.focus();
    input.setSelectionRange(selectionStart + character.length, selectionStart + character.length);
    input.dispatchEvent(new Event("input"));
    if (shiftLatched) { shiftLatched = false; renderKeyboard(); } // one capital, like a phone keyboard
  });

  /* ---------- game state → page ---------- */

  const VERDICT_MARKS = { ok: "✓", near: "≈", bad: "✗" } as const;
  function showVerdict(itemId: string) {
    const verdict = verdictFor(state, itemId), element = byId("verdict-" + itemId);
    element.textContent = verdict ? VERDICT_MARKS[verdict] : "";
    element.className = "verdict " + (verdict || "");
  }
  function renderAnswerKey() {
    for (const item of items) {
      const verdict = verdictFor(state, item.id), answer = state.answers[item.id] || "";
      const correct = closestAccepted(item, answer, locale, item.isEnglish);
      const side: Side = item.isEnglish ? "en" : "lang";
      let html = "";
      if (verdict !== "ok" && answer.trim()) {
        const givenWords = words(normalise(answer, locale, item.isEnglish));
        const { kept } = longestCommonSubsequence(givenWords, words(normalise(correct, locale, item.isEnglish)));
        html += `<div class="yours">${givenWords.map((word, index) => kept[index] ? escapeHtml(word) : `<s>${escapeHtml(word)}</s>`).join(" ")}</div>`;
      }
      if (verdict !== "ok") html += `<div class="right">${renderSentence(correct, side, "K" + item.id)}</div>`;
      html += `<div class="why">${escapeHtml(item.explanation)}</div>`;
      const key = byId("key-" + item.id);
      key.innerHTML = html; key.hidden = false;
    }
  }
  function renderGameState() {
    const gameOver = isOver(puzzle, state);
    for (const item of items) {
      const verdict = verdictFor(state, item.id);
      const locked = verdict === "ok" || gameOver;
      byId("item-" + item.id).classList.toggle("locked", locked);
      byId<HTMLInputElement>("answer-" + item.id).disabled = locked;
      if (locked) showVerdict(item.id);
    }
    byId("checkPips").textContent = Array.from({ length: puzzle.checks }, (_, index) => (index < state.checkHistory.length ? "●" : "○")).join("");
    byId<HTMLButtonElement>("checkButton").disabled = !canCheck(puzzle, state);
    byId<HTMLButtonElement>("hintButton").disabled = state.hintUsed || gameOver;
    if (isShuffled) byId<HTMLButtonElement>("checkPairsButton").disabled = !canCheckPairs(puzzle, state);
    const hintText = byId("hintText");
    hintText.hidden = !state.hintUsed; hintText.textContent = puzzle.hint;
    byId("done").hidden = !gameOver;
    byId("explain").hidden = !gameOver;
    if (gameOver) {
      const message = copy(allSolved(puzzle, state) ? "solved" : "over", languageName);
      byId("doneMessage").textContent = message ?? "";
      byId("doneMessage").hidden = message === null;
      byId("score").textContent = `${score(puzzle, state)} / ${maxScore(puzzle)}`;
      // the link opens this exact puzzle, so a friend who reads it tomorrow still gets the same one
      const puzzleHash = /^#(draft|shelved)-/.test(location.hash) ? location.hash : "#" + puzzle.date;
      byId("share").textContent = shareText(puzzle, state) + "\n" + location.origin + location.pathname + puzzleHash;
    }
  }

  function runCheck() {
    if (!canCheck(puzzle, state)) return;
    update(checkAnswers(puzzle, state));
    items.forEach(item => showVerdict(item.id));
    renderGameState();
    if (isOver(puzzle, state)) finishGame(true);
  }
  byId("checkButton").addEventListener("click", runCheck);
  byId("hintButton").addEventListener("click", () => { state.hintUsed = true; save(); renderGameState(); });
  if (isShuffled) byId("checkPairsButton").addEventListener("click", () => {
    update(checkPairs(puzzle, state)); renderCorpus(); renderGameState();
  });

  /* ---------- end of game ---------- */

  function renderExplanation() {
    const explanation = puzzle.explain;
    const heading = (key: CopyKey) => { const text = copy(key, languageName); return text ? `<div class="ex-h">${escapeHtml(text)}</div>` : ""; };
    const wordList = explanation.words.map(([form, meaning]) => `<div><dt>${escapeHtml(form)}</dt><dd>${escapeHtml(meaning)}</dd></div>`).join("");
    const grammarList = explanation.grammar.map(([form, role]) => `<dt>${escapeHtml(form)}</dt><dd>${escapeHtml(role)}</dd>`).join("");
    byId("explain").innerHTML =
      `<div class="ex-block">${heading("exWords")}<dl class="lex">${wordList}</dl></div>` +
      `<div class="ex-block">${heading("exGrammar")}<dl class="gram">${grammarList}</dl>` +
      (explanation.notes ? `<p class="harm">${escapeHtml(explanation.notes)}</p>` : "") + `</div>` +
      (explanation.fact ? `<div class="ex-block">${heading("exFact")}<p class="fact">${escapeHtml(explanation.fact)}</p></div>` : "");
  }
  function celebrate() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const origin = byId("checkButton").getBoundingClientRect();
    const glyphs = [...puzzle.keys, "✓", "✓"];
    for (let index = 0; index < 18; index++) {
      const particle = document.createElement("span");
      particle.className = "burst";
      particle.textContent = glyphs[index % glyphs.length];
      particle.style.left = origin.left + origin.width / 2 + "px";
      particle.style.top = origin.top + "px";
      document.body.appendChild(particle);
      const angle = ((-90 + (Math.random() * 140 - 70)) * Math.PI) / 180, travel = 90 + Math.random() * 130;
      const dx = Math.cos(angle) * travel, dy = Math.sin(angle) * travel;
      particle.animate([
        { transform: "translate(-50%,0) scale(.6)", opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.6}px), ${dy * 0.6}px) scale(1)`, opacity: 1, offset: 0.35 },
        { transform: `translate(calc(-50% + ${dx}px), ${dy + 40}px) rotate(${Math.random() * 80 - 40}deg) scale(.9)`, opacity: 0 },
      ], { duration: 1100 + Math.random() * 400, easing: "cubic-bezier(.2,.7,.3,1)", delay: index * 18 }).onfinish = () => particle.remove();
    }
  }
  function finishGame(justFinished: boolean) {
    update(placeRemainingPairs(puzzle, state));
    recordStats();
    renderExplanation(); renderAllText(); renderGameState();
    if (!justFinished) return;
    document.body.classList.add("celebrate");
    if (allSolved(puzzle, state)) celebrate();
    setTimeout(() => document.body.classList.remove("celebrate"), 3000);
  }

  /** Drafts don't count. Recording is idempotent, so reopening a finished game is harmless. */
  function recordStats() {
    const isDraft = /^#(draft|shelved)-/.test(location.hash);
    let stats = storage.read<Stats>(STATS_KEY, emptyStats());
    if (!isDraft) {
      stats = recordResult(stats, puzzle.date, {
        score: score(puzzle, state), max: maxScore(puzzle), solved: allSolved(puzzle, state),
        perfect: allSolved(puzzle, state) && hintsUsed(state) === 0 && !state.revealedRows.length, playedOn: todayIso(),
      });
      storage.write(STATS_KEY, stats);
    }
    const summary = summarise(stats, todayIso());
    const figure = (value: number | string, key: CopyKey) => `<div class="stat"><b>${value}</b><span>${escapeHtml(copy(key, languageName) ?? "")}</span></div>`;
    const tallest = Math.max(1, ...summary.scores);
    byId("stats").innerHTML =
      `<div class="figures">${figure(summary.played, "statPlayed")}` +
      `${figure(summary.played ? Math.round((100 * summary.solved) / summary.played) + "%" : "–", "statSolved")}` +
      `${figure(summary.streak, "statStreak")}${figure(summary.bestStreak, "statBest")}</div>` +
      `<div class="bars" aria-label="scores">${summary.scores.map((count, value) =>
        `<div class="bar${!isDraft && value === score(puzzle, state) ? " now" : ""}"><i style="height:${(100 * count) / tallest}%"></i><span>${value}</span></div>`).join("")}</div>`;
  }

  byId("copyShareButton").addEventListener("click", event => {
    const button = event.currentTarget as HTMLButtonElement;
    navigator.clipboard?.writeText(byId("share").textContent || "")
      .then(() => { button.textContent = "Copied"; setTimeout(() => (button.textContent = "Copy result"), 1500); })
      .catch(() => {
        const range = document.createRange(); range.selectNodeContents(byId("share"));
        const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      });
  });

  const notes = byId<HTMLTextAreaElement>("notes");
  notes.value = state.notes || "";
  notes.addEventListener("input", () => { state.notes = notes.value; save(); });

  /* ---------- start ---------- */
  items.forEach(item => showVerdict(item.id));
  renderSwatches(); renderAllText(); renderGameState();
  if (isOver(puzzle, state)) finishGame(false);
  addEventListener("hashchange", () => location.reload());
}
