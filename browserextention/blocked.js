(() => {
  const countdownEl = document.getElementById("countdown");

  function formatDuration(totalSeconds) {
    const safe = Math.max(0, Number(totalSeconds) || 0);
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  let targetEpoch = 0;
  try {
    const params = new URLSearchParams(window.location.search);
    targetEpoch = Number(params.get("nu")) || 0;
  } catch {
    targetEpoch = 0;
  }

  function updateTimer() {
    if (!targetEpoch) {
      countdownEl.textContent = "--:--";
      return;
    }
    const nowEpoch = Math.floor(Date.now() / 1000);
    const remaining = Math.max(0, targetEpoch - nowEpoch);
    countdownEl.textContent = formatDuration(remaining);
    if (remaining === 0) {
      window.location.reload();
    }
  }

  updateTimer();
  window.setInterval(updateTimer, 1000);
})();
