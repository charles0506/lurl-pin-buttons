// ==UserScript==
// @name         LURL PIN Buttons
// @namespace    https://github.com/charles0506/lurl-pin-buttons
// @version      1.0.0
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

  function makeBtn(pw, primary) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = pw;
    b.className = primary ? "lpb-btn lpb-primary" : "lpb-btn";
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
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
      toggle.textContent = `${label} ▾`;
      box.appendChild(toggle);

      const grid = document.createElement("div");
      grid.className = "lpb-grid";
      grid.style.display = "none";
      combos.forEach((pw) => grid.appendChild(makeBtn(pw, false)));
      box.appendChild(grid);

      toggle.addEventListener("click", () => {
        const open = grid.style.display === "none";
        grid.style.display = open ? "grid" : "none";
        toggle.textContent = open ? `${label} ▴` : `${label} ▾`;
      });
    }

    statusEl = document.createElement("div");
    statusEl.className = "lpb-status";
    statusEl.textContent = combos.length ? "點一組 = 填入+送出，一次一組" : "先輸入你記得的數字再按「存」";
    box.appendChild(statusEl);

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
    #${APP_ID} .lpb-status { margin-top: 10px; font-size: 12px; color: #9fe; min-height: 16px; }
  `);

  build();
  // 密碼頁可能延後渲染，觀察 DOM 再補建。
  const mo = new MutationObserver(() => build());
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
