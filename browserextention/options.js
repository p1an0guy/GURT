(() => {
  const storedTheme = window.localStorage.getItem("gurt-theme");
  if (storedTheme === "light" || storedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", storedTheme);
  }

  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const els = {
    blockEnabled: document.getElementById("blockEnabled"),
    setName: document.getElementById("setName"),
    sites: document.getElementById("sites"),
    daysGrid: document.getElementById("daysGrid"),
    timeRanges: document.getElementById("timeRanges"),
    limitMinutes: document.getElementById("limitMinutes"),
    limitPeriod: document.getElementById("limitPeriod"),
    pomodoroEnabled: document.getElementById("pomodoroEnabled"),
    pomodoroFocusMinutes: document.getElementById("pomodoroFocusMinutes"),
    pomodoroBreakMinutes: document.getElementById("pomodoroBreakMinutes"),
    allowlist: document.getElementById("allowlist"),
    validationErrors: document.getElementById("validationErrors"),
    saveStatus: document.getElementById("saveStatus"),
    saveBtn: document.getElementById("saveBtn"),
    resetBtn: document.getElementById("resetBtn")
  };

  let currentConfig = null;

  function syncPomodoroInputState() {
    const enabled = Boolean(els.pomodoroEnabled.checked);
    els.pomodoroFocusMinutes.disabled = !enabled;
    els.pomodoroBreakMinutes.disabled = !enabled;
  }

  function setStatus(message, isError = false) {
    els.saveStatus.textContent = message || "";
    els.saveStatus.style.color = isError ? "#ffcad4" : "#afc6e9";
  }

  function renderErrors(errors) {
    if (!Array.isArray(errors) || errors.length === 0) {
      els.validationErrors.classList.add("hidden");
      els.validationErrors.innerHTML = "";
      return;
    }

    const html = errors.map((error) => `<p>${String(error).replace(/</g, "&lt;")}</p>`).join("");
    els.validationErrors.innerHTML = html;
    els.validationErrors.classList.remove("hidden");
  }

  function buildDayGrid() {
    els.daysGrid.innerHTML = "";
    for (let idx = 0; idx < DAY_LABELS.length; idx += 1) {
      const label = document.createElement("label");
      label.className = "day-pill";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.dayIndex = String(idx);

      const text = document.createElement("span");
      text.textContent = DAY_LABELS[idx];

      label.appendChild(checkbox);
      label.appendChild(text);
      els.daysGrid.appendChild(label);
    }
  }

  function setDayValues(values) {
    const normalized = Array.isArray(values) && values.length === 7
      ? values.map(Boolean)
      : [false, true, true, true, true, true, false];

    const boxes = els.daysGrid.querySelectorAll("input[type='checkbox']");
    boxes.forEach((box) => {
      const idx = Number(box.dataset.dayIndex || "0");
      box.checked = Boolean(normalized[idx]);
    });
  }

  function getDayValues() {
    const out = [false, false, false, false, false, false, false];
    const boxes = els.daysGrid.querySelectorAll("input[type='checkbox']");
    boxes.forEach((box) => {
      const idx = Number(box.dataset.dayIndex || "0");
      out[idx] = box.checked;
    });
    return out;
  }

  function renderAllowlist(values) {
    els.allowlist.innerHTML = "";
    const entries = Array.isArray(values) ? values : [];
    for (const value of entries) {
      const li = document.createElement("li");
      li.textContent = value;
      els.allowlist.appendChild(li);
    }
  }

  function readFormConfig() {
    const limitMinutes = els.limitMinutes.value.trim();
    const pomodoroFocusMinutes = els.pomodoroFocusMinutes.value.trim();
    const pomodoroBreakMinutes = els.pomodoroBreakMinutes.value.trim();
    return {
      enabled: els.blockEnabled.checked,
      setName: els.setName.value.trim(),
      sites: els.sites.value,
      scheduleDays: getDayValues(),
      timeRanges: els.timeRanges.value.trim(),
      limitMinutes: limitMinutes ? Number(limitMinutes) : null,
      limitPeriod: els.limitPeriod.value || null,
      pomodoroEnabled: els.pomodoroEnabled.checked,
      pomodoroFocusMinutes: pomodoroFocusMinutes ? Number(pomodoroFocusMinutes) : 25,
      pomodoroBreakMinutes: pomodoroBreakMinutes ? Number(pomodoroBreakMinutes) : 5,
      allowlistHard: Array.isArray(currentConfig && currentConfig.allowlistHard)
        ? currentConfig.allowlistHard
        : []
    };
  }

  function populateForm(config) {
    currentConfig = config;
    els.blockEnabled.checked = Boolean(config.enabled);
    els.setName.value = config.setName || "Focus Block Set";
    els.sites.value = config.sites || "";
    setDayValues(config.scheduleDays);
    els.timeRanges.value = config.timeRanges || "0900-1700";
    els.limitMinutes.value = config.limitMinutes ? String(config.limitMinutes) : "";
    els.limitPeriod.value = config.limitPeriod || "";
    els.pomodoroEnabled.checked = Boolean(config.pomodoroEnabled);
    els.pomodoroFocusMinutes.value = config.pomodoroFocusMinutes ? String(config.pomodoroFocusMinutes) : "25";
    els.pomodoroBreakMinutes.value = config.pomodoroBreakMinutes ? String(config.pomodoroBreakMinutes) : "5";
    syncPomodoroInputState();
    renderAllowlist(config.allowlistHard);
  }

  async function loadConfig() {
    setStatus("Loading settings...");
    renderErrors([]);

    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_BLOCK_CONFIG" });
      if (!response || !response.success || !response.config) {
        throw new Error((response && response.error) || "Unable to load blocking config.");
      }
      populateForm(response.config);
      setStatus(`Loaded. Last updated ${new Date(response.config.updatedAt).toLocaleString()}.`);
    } catch (error) {
      renderErrors([error.message]);
      setStatus("", true);
    }
  }

  async function saveConfig() {
    const payload = readFormConfig();
    els.saveBtn.disabled = true;
    els.resetBtn.disabled = true;
    setStatus("Saving settings...");
    renderErrors([]);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "SAVE_BLOCK_CONFIG",
        config: payload
      });
      if (!response || response.success !== true) {
        const errors = response && Array.isArray(response.validationErrors) ? response.validationErrors : [
          (response && response.error) || "Failed to save blocking settings."
        ];
        renderErrors(errors);
        setStatus("Fix validation issues and try again.", true);
        return;
      }

      populateForm(response.config);
      setStatus(`Saved at ${new Date(response.config.updatedAt).toLocaleString()}.`);
    } catch (error) {
      renderErrors([error.message]);
      setStatus("Failed to save settings.", true);
    } finally {
      els.saveBtn.disabled = false;
      els.resetBtn.disabled = false;
    }
  }

  buildDayGrid();
  loadConfig();

  els.saveBtn.addEventListener("click", () => {
    void saveConfig();
  });

  els.resetBtn.addEventListener("click", () => {
    if (currentConfig) {
      populateForm(currentConfig);
      renderErrors([]);
      setStatus("Restored last saved values.");
    }
  });

  els.pomodoroEnabled.addEventListener("change", syncPomodoroInputState);
})();
