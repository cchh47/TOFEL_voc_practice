const STORAGE_KEY = "wy_toefl_srs_v1";

let allWords = [];
let queue = [];
let currentIndex = 0;
let progress = {
  cards: {}, // word -> { easiness, interval, repetitions, nextReview, lastRating, reviewCount }
  stats: {
    learnedCount: 0,
    reviewedToday: 0,
    lastReviewDate: null,
  },
};

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && data.cards) {
      progress = data;
    }
  } catch (e) {
    console.warn("Failed to load progress", e);
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function resetDailyStatsIfNeeded() {
  const t = todayStr();
  if (progress.stats.lastReviewDate !== t) {
    progress.stats.lastReviewDate = t;
    progress.stats.reviewedToday = 0;
  }
}

async function loadWords() {
  const res = await fetch("./words.json");
  if (!res.ok) {
    throw new Error("找不到 words.json，请先运行解析脚本");
  }
  allWords = await res.json();
}

function getCardState(word) {
  if (!progress.cards[word]) {
    progress.cards[word] = {
      easiness: 2.5,
      interval: 0,
      repetitions: 0,
      nextReview: Date.now(),
      lastRating: null,
      reviewCount: 0,
    };
  }
  return progress.cards[word];
}

function buildQueue(mode, sessionSize) {
  const now = Date.now();

  const due = [];
  const newWords = [];

  for (const w of allWords) {
    const state = getCardState(w.word);
    if (state.repetitions === 0) {
      newWords.push(w);
    } else if (state.nextReview <= now) {
      due.push(w);
    }
  }

  // 高词频优先：按 frequency desc，再 stage，再字母
  const byFreq = (a, b) => {
    const fa = a.frequency ?? -1;
    const fb = b.frequency ?? -1;
    if (fb !== fa) return fb - fa;
    if (a.stage !== b.stage) return (a.stage || "").localeCompare(b.stage || "");
    return a.word.localeCompare(b.word);
  };

  due.sort(byFreq);
  newWords.sort(byFreq);

  let result = [];
  if (mode === "review") {
    result = due.slice(0, sessionSize);
  } else if (mode === "learn") {
    result = newWords.slice(0, sessionSize);
  } else {
    // mixed: 半数 due，半数 new
    const half = Math.floor(sessionSize / 2);
    result = due.slice(0, half).concat(newWords.slice(0, sessionSize - half));
  }

  if (result.length === 0) {
    result = newWords.slice(0, Math.max(10, sessionSize));
  }

  queue = result;
  currentIndex = 0;
}

function renderQueue() {
  const ul = document.getElementById("queueList");
  ul.innerHTML = "";
  queue.forEach((w, idx) => {
    const li = document.createElement("li");
    if (idx === currentIndex) li.classList.add("active");
    const left = document.createElement("div");
    left.textContent = w.word;
    const right = document.createElement("div");
    right.className = "queue-meta";
    const sf = w.frequency != null ? `f:${w.frequency}` : "f:-";
    right.textContent = `${w.stage || "-"} · ${sf}`;
    li.appendChild(left);
    li.appendChild(right);
    ul.appendChild(li);
  });
}

function renderStats() {
  const learnedCount = Object.values(progress.cards).filter(
    (c) => c.repetitions > 0
  ).length;
  progress.stats.learnedCount = learnedCount;

  const now = Date.now();
  const dueCount = allWords.filter(
    (w) => getCardState(w.word).nextReview <= now && getCardState(w.word).repetitions > 0
  ).length;

  const total = allWords.length || 1;
  const mastery =
    (Object.values(progress.cards).filter((c) => c.easiness >= 2.5 && c.interval >= 3)
      .length /
      total) *
    100;

  document.getElementById("learnedCount").textContent = learnedCount;
  document.getElementById("reviewedToday").textContent =
    progress.stats.reviewedToday || 0;
  document.getElementById("dueCount").textContent = dueCount;
  document.getElementById("masteryPercent").textContent =
    Math.round(mastery) + "%";

  renderDashboard();
}

function stripChinese(html) {
  // 简单：保留含 [近义]、[短语] 的行
  const lines = html.split("\n");
  return lines
    .filter((l) => l.includes("近义") || l.includes("短语") || l.includes("synonym"))
    .join("\n");
}

function generateExamples(wordObj) {
  const w = wordObj.word;
  const stage = wordObj.stage || "stage2";

  // 根据阶段简单区分生活 / 学术 / 抽象场景
  const scenes =
    stage === "stage1"
      ? [
          {
            en: `On the way to the airport, she suddenly realized she had to ${w} her old plan and start again.`,
            zh: `在去机场的路上，她突然意识到必须放弃原来的计划，重新开始。`,
            hint: "生活场景：临时改变计划",
          },
          {
            en: `During daily conversations, people rarely use this word, but once you know it, you can ${w} it naturally in speaking.`,
            zh: `在日常对话中人们很少用这个词，但一旦掌握，你也可以在口语中自然地用出来。`,
            hint: "日常口语：刻意输出新词",
          },
        ]
      : stage === "stage2"
      ? [
          {
            en: `In a TOEFL listening passage, a professor might ${w} a key point to show how important it is in real research.`,
            zh: `在托福听力材料中，教授可能会用这个词来强调某个关键点在真实研究中的重要性。`,
            hint: "课堂场景：教授讲解概念",
          },
          {
            en: `When you write an academic paragraph, you can ${w} this idea to make your argument more precise.`,
            zh: `写学术段落时，你可以用这个词来表达这个观点，使论证更精确。`,
            hint: "写作场景：学术段落",
          },
        ]
      : [
          {
            en: `In a formal report, the manager chose to ${w} a complex problem in just one clear sentence.`,
            zh: `在一份正式报告中，经理选择用一句清晰的话来概括这个复杂问题。`,
            hint: "职场场景：正式报告",
          },
          {
            en: `High‑level reading passages often ${w} abstract ideas that are hard to translate into simple Chinese.`,
            zh: `高级阅读文章经常用这个词来表达一些很难直接翻译成简单中文的抽象概念。`,
            hint: "阅读场景：抽象概念",
          },
        ];

  return scenes;
}

function renderCurrentCard() {
  if (!queue.length) return;
  const wordObj = queue[currentIndex];
  const state = getCardState(wordObj.word);

  document.getElementById("wordText").textContent = wordObj.word;
  document.getElementById("phonetic").textContent = "";

  const qaBlock = document.getElementById("qaBlock");
  const showSyn = document.getElementById("showSynonymsToggle").checked;

  let html = wordObj.qa_html || "";
  if (!showSyn) {
    html = html.replace(/\[近义][^<]*/g, "").replace(/\[短语][^<]*/g, "");
  }

  qaBlock.innerHTML = html;

  const modeShowCn = qaBlock.classList.contains("hidden-cn");
  if (modeShowCn) {
    qaBlock.classList.add("hidden-cn");
  }

  // examples
  const examplesBlock = document.getElementById("examplesBlock");
  const showExamples = document.getElementById("showExamplesToggle")?.checked;
  if (examplesBlock) {
    if (showExamples) {
      const examples = generateExamples(wordObj);
      let htmlEx = "<h3>Scene Examples</h3>";
      examples.forEach((ex) => {
        htmlEx += `<div class="example-item">
          <div class="example-en">${ex.en.replace(
            new RegExp(`\\b${wordObj.word}\\b`, "gi"),
            `<strong>${wordObj.word}</strong>`
          )}</div>
          <div class="example-zh">${ex.zh}</div>
          <div class="example-hint">· ${ex.hint}</div>
        </div>`;
      });
      examplesBlock.innerHTML = htmlEx;
      examplesBlock.style.display = "block";
    } else {
      examplesBlock.innerHTML = "";
      examplesBlock.style.display = "none";
    }
  }

  // stage & freq
  const stageBadge = document.getElementById("stageBadge");
  const stageLabel = wordObj.stage || "stage?";
  stageBadge.textContent =
    stageLabel === "stage1"
      ? "高频一阶"
      : stageLabel === "stage2"
      ? "中频二阶"
      : stageLabel === "stage3"
      ? "低频三阶"
      : stageLabel;

  const freqBadge = document.getElementById("freqBadge");
  freqBadge.textContent =
    wordObj.frequency != null ? `词频 ${wordObj.frequency}` : "词频 -";

  // meta info
  const meta = document.getElementById("metaInfo");
  const next = new Date(state.nextReview);
  meta.innerHTML = `
    <div>重复次数：<strong>${state.repetitions}</strong></div>
    <div>当前间隔：<strong>${state.interval.toFixed(1)}</strong> 天</div>
    <div>易记度(EF)：<strong>${state.easiness.toFixed(2)}</strong></div>
    <div>下次复习：<strong>${next.toLocaleString()}</strong></div>
  `;

  renderQueue();
}

function computeDashboardData() {
  const total = allWords.length || 1;

  const stageBuckets = {
    stage1: { label: "一阶", new: 0, learning: 0, solid: 0 },
    stage2: { label: "二阶", new: 0, learning: 0, solid: 0 },
    stage3: { label: "三阶", new: 0, learning: 0, solid: 0 },
    other: { label: "其他", new: 0, learning: 0, solid: 0 },
  };

  const ratingBuckets = {
    0: 0,
    1: 0,
    2: 0,
    3: 0,
  };

  for (const w of allWords) {
    const state = getCardState(w.word);
    const stageKey = w.stage || "other";
    const bucket = stageBuckets[stageKey] || stageBuckets.other;

    if (state.repetitions === 0) {
      bucket.new += 1;
    } else if (state.interval >= 3 && state.easiness >= 2.5) {
      bucket.solid += 1;
    } else {
      bucket.learning += 1;
    }

    if (state.lastRating != null && ratingBuckets.hasOwnProperty(state.lastRating)) {
      ratingBuckets[state.lastRating] += 1;
    }
  }

  return { total, stageBuckets, ratingBuckets };
}

function renderDashboard() {
  const { total, stageBuckets, ratingBuckets } = computeDashboardData();

  const maxStageCount = Math.max(
    1,
    ...Object.values(stageBuckets).map(
      (b) => b.new + b.learning + b.solid
    )
  );

  const stageBars = document.getElementById("stageBars");
  const ratingBars = document.getElementById("ratingBars");
  if (!stageBars || !ratingBars) return;

  stageBars.innerHTML = "";
  Object.entries(stageBuckets).forEach(([key, b]) => {
    const row = document.createElement("div");
    row.className = "bar-row";

    const label = document.createElement("div");
    label.className = "bar-label";
    label.textContent = b.label;

    const track = document.createElement("div");
    track.className = "bar-track";

    const sum = b.new + b.learning + b.solid || 1;
    const widthScale = (sum / maxStageCount) * 100;

    let offset = 0;
    const pushSeg = (count, cls) => {
      if (!count) return;
      const seg = document.createElement("div");
      seg.className = `bar-segment ${cls}`;
      const w = (count / sum) * widthScale;
      seg.style.left = offset + "%";
      seg.style.width = w + "%";
      offset += w;
      track.appendChild(seg);
    };

    pushSeg(b.new, "new");
    pushSeg(b.learning, "learning");
    pushSeg(b.solid, "solid");

    const value = document.createElement("div");
    value.className = "bar-value";
    value.textContent = sum;

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(value);
    stageBars.appendChild(row);
  });

  const ratingLabels = {
    0: "陌生",
    1: "吃力",
    2: "记住",
    3: "熟练",
  };

  const maxRatingCount = Math.max(1, ...Object.values(ratingBuckets));
  ratingBars.innerHTML = "";

  Object.keys(ratingBuckets)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((rk) => {
      const count = ratingBuckets[rk];
      const row = document.createElement("div");
      row.className = "bar-row";

      const label = document.createElement("div");
      label.className = "bar-label";
      label.textContent = `${ratingLabels[rk]}(${rk})`;

      const track = document.createElement("div");
      track.className = "bar-track";

      const seg = document.createElement("div");
      seg.className = "bar-segment";
      const ratio = count / maxRatingCount;
      seg.style.left = "0%";
      seg.style.width = `${ratio * 100}%`;

      if (rk === "0") seg.classList.add("new", "again");
      if (rk === "1") seg.classList.add("learning", "hard");
      if (rk === "2") seg.classList.add("solid", "good");
      if (rk === "3") seg.classList.add("solid", "easy");

      track.appendChild(seg);

      const value = document.createElement("div");
      value.className = "bar-value";
      value.textContent = count;

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      ratingBars.appendChild(row);
    });
}

// 简化版 SM-2 遗忘曲线调度
function schedule(wordObj, rating) {
  const state = getCardState(wordObj.word);

  // rating: 0 again, 1 hard, 2 good, 3 easy
  const quality = rating === 3 ? 5 : rating === 2 ? 4 : rating === 1 ? 3 : 1;

  if (quality < 3) {
    state.repetitions = 0;
    state.interval = 0;
  } else {
    state.repetitions += 1;
    if (state.repetitions === 1) {
      state.interval = 1 / 24; // first: 1 hour
    } else if (state.repetitions === 2) {
      state.interval = 1; // second: 1 day
    } else {
      state.interval = state.interval * state.easiness;
    }
  }

  state.easiness =
    state.easiness +
    (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (state.easiness < 1.3) state.easiness = 1.3;

  const now = Date.now();
  let intervalMs = state.interval * 24 * 60 * 60 * 1000;

  // 再结合词频：高频词（频率大）适度缩短间隔
  if (wordObj.frequency != null) {
    const f = wordObj.frequency;
    const factor = f >= 50 ? 0.5 : f >= 20 ? 0.7 : f >= 5 ? 0.9 : 1.0;
    intervalMs *= factor;
  }

  // 完全陌生：强制短间隔
  if (rating === 0) {
    intervalMs = 1 * 60 * 1000; // 1 分钟
  } else if (rating === 1 && intervalMs < 10 * 60 * 1000) {
    intervalMs = 10 * 60 * 1000;
  }

  state.nextReview = now + intervalMs;
  state.lastRating = rating;
  state.reviewCount += 1;

  const today = todayStr();
  if (progress.stats.lastReviewDate !== today) {
    resetDailyStatsIfNeeded();
  }
  progress.stats.reviewedToday += 1;
}

function nextCard() {
  if (!queue.length) return;
  currentIndex += 1;
  if (currentIndex >= queue.length) {
    const mode = document.getElementById("modeSelect").value;
    const sessionSize = Number(
      document.getElementById("sessionSizeInput").value || 20
    );
    buildQueue(mode, sessionSize);
  }
  renderStats();
  saveProgress();
  renderCurrentCard();
}

function setupInteractions() {
  document.querySelectorAll(".rating-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!queue.length) return;
      const rating = Number(btn.dataset.rating);
      const wordObj = queue[currentIndex];
      schedule(wordObj, rating);
      nextCard();
    });
  });

  document.getElementById("toggleLangBtn").addEventListener("click", () => {
    const block = document.getElementById("qaBlock");
    block.classList.toggle("hidden-cn");
  });

  document
    .getElementById("showSynonymsToggle")
    .addEventListener("change", renderCurrentCard);

  document
    .getElementById("showExamplesToggle")
    .addEventListener("change", renderCurrentCard);

  document.getElementById("modeSelect").addEventListener("change", () => {
    const mode = document.getElementById("modeSelect").value;
    const sessionSize = Number(
      document.getElementById("sessionSizeInput").value || 20
    );
    buildQueue(mode, sessionSize);
    renderStats();
    saveProgress();
    renderCurrentCard();
  });

  document
    .getElementById("sessionSizeInput")
    .addEventListener("change", () => {
      const mode = document.getElementById("modeSelect").value;
      const sessionSize = Number(
        document.getElementById("sessionSizeInput").value || 20
      );
      buildQueue(mode, sessionSize);
      renderStats();
      saveProgress();
      renderCurrentCard();
    });

  document
    .getElementById("resetProgressBtn")
    .addEventListener("click", () => {
      if (!confirm("确定要清空所有学习进度吗？此操作不可恢复。")) return;
      localStorage.removeItem(STORAGE_KEY);
      progress = {
        cards: {},
        stats: { learnedCount: 0, reviewedToday: 0, lastReviewDate: null },
      };
      buildQueue(
        document.getElementById("modeSelect").value,
        Number(document.getElementById("sessionSizeInput").value || 20)
      );
      renderStats();
      renderCurrentCard();
    });
}

async function main() {
  loadProgress();
  resetDailyStatsIfNeeded();
  renderStats();

  try {
    await loadWords();
  } catch (e) {
    alert(
      "无法加载 words.json，请先在项目根目录运行：\n\npython parse_wang_yumei_vocab.py"
    );
    console.error(e);
    return;
  }

  const mode = document.getElementById("modeSelect").value;
  const sessionSize = Number(
    document.getElementById("sessionSizeInput").value || 20
  );
  buildQueue(mode, sessionSize);
  renderStats();
  setupInteractions();
  renderCurrentCard();
}

window.addEventListener("DOMContentLoaded", main);

