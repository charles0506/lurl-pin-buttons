// ==UserScript==
// @name         LURL PIN Buttons
// @namespace    https://github.com/charles0506/lurl-pin-buttons
// @version      1.1.0
// @description  在 LURL/MyPPT/load.tw 密碼頁放一排「點一下就填入+送出」的按鈕：輸入你記得的 4 個數字（存在本機），自動展開全部排列組合讓你逐一點選。一次一組，由你手動點，不自動連打。
// @match        *://lurl.cc/*
// @match        *://myppt.cc/*
// @match        *://load.tw/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/charles0506/lurl-pin-buttons/main/lurl-pin-buttons.user.js
// @downloadURL  https://raw.githubusercontent.com/charles0506/lurl-pin-buttons/main/lurl-pin-buttons.user.js
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  const APP_ID = "lurl-pin-buttons";
  const DIGITS_KEY = `${APP_ID}:digits`; // 你記得的數字存本機，不寫進原始碼
  const PRIMARY_KEY = `${APP_ID}:primary`; // 最可能那組，排最前面
  const TRIED_KEY = `${APP_ID}:tried`; // 猜過的（劃掉用），依頁面分別記錄
  const LAST_KEY = `${APP_ID}:last`; // 最後點的那組（依頁面），成功偵測用
  const WINS_KEY = `${APP_ID}:wins`; // 成功紀錄：網址 ↔ 密碼（存本機）
  const WIN_TTL = 10 * 60 * 1000; // 點完 10 分鐘內離開密碼頁才算這組成功

  function pageKey() {
    return location.hostname + location.pathname;
  }

  // 最後點選的密碼（依頁面）。送出後頁面可能換掉，用這個回推哪組成功。
  function getLastMap() {
    const m = GM_getValue(LAST_KEY, {});
    return m && typeof m === "object" ? m : {};
  }
  function setLast(pw) {
    const m = getLastMap();
    m[pageKey()] = { pw, ts: Date.now() };
    GM_setValue(LAST_KEY, m);
  }
  function getLast() {
    return getLastMap()[pageKey()] || null;
  }
  function clearLast() {
    const m = getLastMap();
    delete m[pageKey()];
    GM_setValue(LAST_KEY, m);
  }

  // 成功紀錄：網址↔密碼，最新在前，同網址只留最新一筆。
  function getWins() {
    const a = GM_getValue(WINS_KEY, []);
    return Array.isArray(a) ? a : [];
  }
  function addWin(pw) {
    const url = location.href;
    const wins = getWins().filter((w) => w.url !== url);
    wins.unshift({ url, pw, at: Date.now() });
    GM_setValue(WINS_KEY, wins.slice(0, 200));
  }
  function getWinForPage() {
    const key = pageKey();
    return getWins().find((w) => {
      try {
        const u = new URL(w.url);
        return u.hostname + u.pathname === key;
      } catch (e) {
        return false;
      }
    }) || null;
  }

  // 成功偵測：剛點過某組、現在這頁已經沒密碼欄位 = 進去了 → 記成該網址成功密碼。
  function detectSuccess() {
    const last = getLast();
    if (!last) return;
    if (Date.now() - last.ts > WIN_TTL) { clearLast(); return; }
    if (findPasswordInput()) return; // 還在密碼頁（密碼錯會 reload 回來）→ 尚未成功
    addWin(last.pw);
    clearLast();
    toast(`✅ 密碼 ${last.pw} 正確，已記錄`);
  }
  function getTriedMap() {
    const m = GM_getValue(TRIED_KEY, {});
    return m && typeof m === "object" ? m : {};
  }
  function getTried() {
    return new Set(getTriedMap()[pageKey()] || []);
  }
  function markTried(pw) {
    const m = getTriedMap();
    const k = pageKey();
    const s = new Set(m[k] || []);
    s.add(pw);
    m[k] = [...s];
    GM_setValue(TRIED_KEY, m);
  }
  function clearTried() {
    const m = getTriedMap();
    delete m[pageKey()];
    GM_setValue(TRIED_KEY, m);
  }

  // 從本機讀設定。預設為空 —— 第一次用先輸入你記得的 4 個數字。
  function getDigits() {
    return String(GM_getValue(DIGITS_KEY, "")).replace(/\D/g, "");
  }
  function setDigits(v) {
    GM_setValue(DIGITS_KEY, String(v).replace(/\D/g, ""));
  }
  function getPrimary() {
    return String(GM_getValue(PRIMARY_KEY, "")).replace(/\D/g, "");
  }
  function setPrimary(v) {
    GM_setValue(PRIMARY_KEY, String(v).replace(/\D/g, ""));
  }

  function permutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    arr.forEach((d, i) => {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      permutations(rest).forEach((p) => out.push([d].concat(p)));
    });
    return out;
  }

  // 由本機存的數字現算全排列；最可能那組排最前面。
  function allCombos() {
    const digits = getDigits().split("");
    if (digits.length < 2) return [];
    const perms = permutations(digits).map((p) => p.join(""));
    const primary = getPrimary();
    const uniq = [...new Set([primary, ...perms].filter(Boolean))];
    return uniq;
  }

  // ---- 以下填值/送出邏輯沿用現有 inline helper，排除 history_pass 歷史鈕 ----

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden";
  }

  function findPasswordInput() {
    for (const selector of [
      "input#password",
      "input#viewPwInput",
      "input[name='password']",
      "input#pw",
      "input[type='password']",
    ]) {
      const input = document.querySelector(selector);
      if (input && isVisible(input) && !input.disabled && !input.readOnly) return input;
    }
    return null;
  }

  function setInputValue(input, value) {
    input.focus();
    input.click();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findSubmitButton(input) {
    const form = input.closest("form");
    const scope = form || document;
    const inHelper = (el) => el.closest && el.closest(`#${APP_ID}`);
    const usable = (el) => el && isVisible(el) && !el.disabled && !inHelper(el);
    const all = [...scope.querySelectorAll("button, input[type='submit'], input[type='button']")];
    // 排除送出自己歷史密碼、忽略輸入值的「歷史鈕」。
    const isHistory = (el) =>
      /history_pass/.test(el.getAttribute("onclick") || "") ||
      (el.classList && el.classList.contains("pw-chip")) ||
      (el.closest && el.closest("#viewPwQuick"));
    const label = (el) => `${el.textContent || ""} ${el.value || ""}`.trim();
    const byText = all.find(
      (el) => usable(el) && !isHistory(el) && /解密|解鎖|送出|送 出|確認|登入|提交|submit|enter/i.test(label(el))
    );
    if (byText) return byText;
    const bySubmit = all.find((el) => usable(el) && !isHistory(el) && el.type === "submit");
    if (bySubmit) return bySubmit;
    return all.find((el) => usable(el) && !isHistory(el)) || null;
  }

  function fillAndSubmit(pw) {
    const input = findPasswordInput();
    if (!input) {
      setStatus("找不到密碼欄位", true);
      return;
    }
    setInputValue(input, pw);
    const btn = findSubmitButton(input);
    if (btn) {
      btn.click();
      setStatus(`已填 ${pw} 並送出`);
    } else {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      setStatus(`已填 ${pw}（沒找到送出鈕，按 Enter 試試）`);
    }
  }

  // ---- UI ----

  let statusEl;
  function setStatus(msg, isErr) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isErr ? "#ff6b6b" : "#9fe";
  }

  // 獨立提示（面板可能已不在，例如成功進頁後）。
  function toast(msg) {
    const t = document.createElement("div");
    t.className = "lpb-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; }, 4000);
    setTimeout(() => t.remove(), 5000);
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function makeBtn(pw, primary) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = pw;
    b.className = primary ? "lpb-btn lpb-primary" : "lpb-btn";
    if (getTried().has(pw)) b.classList.add("lpb-tried");
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      markTried(pw); // 先劃掉再送出（送出可能 reload）
      setLast(pw); // 記下最後點的，成功進頁後回推哪組對
      b.classList.add("lpb-tried");
      fillAndSubmit(pw);
    });
    return b;
  }

  function build() {
    if (document.getElementById(APP_ID)) return;
    if (!findPasswordInput()) return; // 沒有密碼欄位的頁面不顯示

    const box = document.createElement("div");
    box.id = APP_ID;

    const title = document.createElement("div");
    title.className = "lpb-title";
    title.textContent = "密碼一點填";
    box.appendChild(title);

    // 本頁若已有成功紀錄，置頂提示並提供一鍵再填。
    const known = getWinForPage();
    if (known) {
      const hit = document.createElement("div");
      hit.className = "lpb-known";
      hit.textContent = `本頁成功密碼：${known.pw}（點填入）`;
      hit.title = `記錄於 ${fmtTime(known.at)}`;
      hit.addEventListener("click", () => fillAndSubmit(known.pw));
      box.appendChild(hit);
    }

    // 設定列：輸入你記得的數字（存本機），+ 最可能那組。空白時只顯示這列。
    const setup = document.createElement("div");
    setup.className = "lpb-setup";
    const digitsIn = document.createElement("input");
    digitsIn.type = "text";
    digitsIn.inputMode = "numeric";
    digitsIn.placeholder = "記得的數字 例 0789";
    digitsIn.value = getDigits();
    const primaryIn = document.createElement("input");
    primaryIn.type = "text";
    primaryIn.inputMode = "numeric";
    primaryIn.placeholder = "最可能那組(選填)";
    primaryIn.value = getPrimary();
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "lpb-save";
    saveBtn.textContent = "存";
    saveBtn.addEventListener("click", () => {
      setDigits(digitsIn.value);
      setPrimary(primaryIn.value);
      box.remove();
      build(); // 重建，帶出新組合
    });
    setup.appendChild(digitsIn);
    setup.appendChild(primaryIn);
    setup.appendChild(saveBtn);
    box.appendChild(setup);

    const combos = allCombos();
    const primary = getPrimary();

    if (combos.length) {
      if (primary) box.appendChild(makeBtn(primary, true));

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "lpb-toggle";
      const label = `全部 ${combos.length} 組`;
      toggle.textContent = `${label} ▴`;
      box.appendChild(toggle);

      const grid = document.createElement("div");
      grid.className = "lpb-grid";
      grid.style.display = "grid"; // 預設展開
      combos.forEach((pw) => grid.appendChild(makeBtn(pw, false)));
      box.appendChild(grid);

      toggle.addEventListener("click", () => {
        const open = grid.style.display === "none";
        grid.style.display = open ? "grid" : "none";
        toggle.textContent = open ? `${label} ▴` : `${label} ▾`;
      });

      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "lpb-clear";
      clear.textContent = "清除劃掉";
      clear.addEventListener("click", () => {
        clearTried();
        box.remove();
        build();
      });
      box.appendChild(clear);
    }

    statusEl = document.createElement("div");
    statusEl.className = "lpb-status";
    statusEl.textContent = combos.length ? "點一組 = 填入+送出；猜過的會劃掉" : "先輸入你記得的數字再按「存」";
    box.appendChild(statusEl);

    // 成功紀錄清單（網址↔密碼，全站共用，存本機）。
    const wins = getWins();
    if (wins.length) {
      const logToggle = document.createElement("button");
      logToggle.type = "button";
      logToggle.className = "lpb-toggle";
      logToggle.textContent = `成功紀錄 (${wins.length}) ▾`;
      box.appendChild(logToggle);

      const log = document.createElement("div");
      log.className = "lpb-log";
      log.style.display = "none";
      wins.slice(0, 50).forEach((w) => {
        const row = document.createElement("div");
        row.className = "lpb-logrow";
        const pw = document.createElement("b");
        pw.textContent = w.pw;
        const a = document.createElement("a");
        a.href = w.url;
        a.textContent = w.url;
        a.title = fmtTime(w.at);
        a.target = "_blank";
        a.rel = "noreferrer";
        row.appendChild(pw);
        row.appendChild(a);
        log.appendChild(row);
      });
      box.appendChild(log);
      logToggle.addEventListener("click", () => {
        const open = log.style.display === "none";
        log.style.display = open ? "block" : "none";
        logToggle.textContent = open ? `成功紀錄 (${wins.length}) ▴` : `成功紀錄 (${wins.length}) ▾`;
      });
    }

    document.body.appendChild(box);
  }

  GM_addStyle(`
    #${APP_ID} {
      position: fixed; top: 12px; right: 12px; z-index: 2147483647;
      background: #1d1f24; color: #eee; padding: 12px; border-radius: 12px;
      font: 14px/1.4 system-ui, "Noto Sans TC", sans-serif;
      box-shadow: 0 6px 24px rgba(0,0,0,.4); width: 220px;
    }
    #${APP_ID} .lpb-title { font-weight: 700; margin-bottom: 8px; }
    #${APP_ID} .lpb-setup { display: grid; grid-template-columns: 1fr auto; gap: 6px; margin-bottom: 8px; }
    #${APP_ID} .lpb-setup input {
      grid-column: 1 / 2; padding: 6px 8px; border-radius: 6px; border: 1px solid #556;
      background: #11131a; color: #eee; font-size: 14px; width: 100%; box-sizing: border-box;
    }
    #${APP_ID} .lpb-save {
      grid-column: 2 / 3; grid-row: 1 / 3; padding: 0 12px; border-radius: 6px;
      border: 1px solid #3fae7f; background: #2e7d5b; color: #fff; cursor: pointer; font-size: 14px;
    }
    #${APP_ID} .lpb-btn {
      font-size: 18px; letter-spacing: 3px; font-variant-numeric: tabular-nums;
      padding: 8px 10px; border-radius: 8px; border: 1px solid #556;
      background: #2b2f38; color: #eee; cursor: pointer; width: 100%;
    }
    #${APP_ID} .lpb-btn:hover { background: #3a414e; }
    #${APP_ID} .lpb-primary { background: #2e7d5b; border-color: #3fae7f; margin-bottom: 8px; font-size: 22px; }
    #${APP_ID} .lpb-primary:hover { background: #359468; }
    #${APP_ID} .lpb-toggle {
      width: 100%; margin: 8px 0 4px; padding: 6px; border-radius: 8px;
      border: 1px solid #556; background: transparent; color: #aab; cursor: pointer; font-size: 13px;
    }
    #${APP_ID} .lpb-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px;
    }
    #${APP_ID} .lpb-grid .lpb-btn { font-size: 15px; letter-spacing: 2px; padding: 6px 4px; }
    #${APP_ID} .lpb-tried { opacity: .4; text-decoration: line-through; }
    #${APP_ID} .lpb-clear {
      width: 100%; margin-top: 8px; padding: 6px; border-radius: 8px;
      border: 1px solid #556; background: transparent; color: #aab; cursor: pointer; font-size: 13px;
    }
    #${APP_ID} .lpb-status { margin-top: 10px; font-size: 12px; color: #9fe; min-height: 16px; }
    #${APP_ID} .lpb-known {
      margin-bottom: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer;
      background: #163; border: 1px solid #3fae7f; color: #cfe; font-size: 13px;
    }
    #${APP_ID} .lpb-known:hover { background: #1c7a4a; }
    #${APP_ID} .lpb-log { margin-top: 6px; max-height: 180px; overflow: auto; }
    #${APP_ID} .lpb-logrow { font-size: 12px; padding: 4px 0; border-top: 1px solid #333; display: flex; gap: 6px; }
    #${APP_ID} .lpb-logrow b { color: #9fe; flex: none; font-variant-numeric: tabular-nums; }
    #${APP_ID} .lpb-logrow a { color: #9bf; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lpb-toast {
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
      background: #2e7d5b; color: #fff; padding: 10px 18px; border-radius: 10px;
      font: 15px/1.4 system-ui, "Noto Sans TC", sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.4);
      transition: opacity 1s;
    }
  `);

  // 先判斷是不是剛成功進頁（此頁可能已無密碼欄位，面板不會建）。
  // 給頁面一點時間渲染，避免密碼欄位還沒出現就誤判成功。
  setTimeout(detectSuccess, 1200);

  build();
  // 密碼頁可能延後渲染，觀察 DOM 再補建。
  const mo = new MutationObserver(() => build());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
