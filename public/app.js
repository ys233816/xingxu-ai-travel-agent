const ICONS = {
  compass: '<circle cx="12" cy="12" r="9"></circle><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"></path>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"></path><path d="M9 3v15M15 6v15"></path>',
  replay: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path>',
  shield: '<path d="M12 3 4.5 6v5.3c0 4.6 3.2 8.1 7.5 9.7 4.3-1.6 7.5-5.1 7.5-9.7V6L12 3Z"></path><path d="m9 12 2 2 4-4"></path>',
  check: '<path d="m5 12 4 4L19 6"></path>',
  spark: '<path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z"></path><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"></path>',
  question: '<circle cx="12" cy="12" r="9"></circle><path d="M9.8 9a2.4 2.4 0 1 1 3 2.3c-.8.3-.8.8-.8 1.7M12 17h.01"></path>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"></path>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"></path>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"></path><path d="M6.1 9a7 7 0 0 1 11.5-2L20 12M4 12l2.4 5a7 7 0 0 0 11.5-2"></path>',
  trace: '<circle cx="6" cy="5" r="2"></circle><circle cx="18" cy="12" r="2"></circle><circle cx="6" cy="19" r="2"></circle><path d="M8 5h3a3 3 0 0 1 3 3v1a3 3 0 0 0 3 3M8 19h3a3 3 0 0 0 3-3v-1a3 3 0 0 1 3-3"></path>',
  info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path>',
  send: '<path d="m21 3-7.5 18-4-7.5L2 9.5 21 3Z"></path><path d="M9.5 13.5 21 3"></path>',
  route: '<circle cx="6" cy="19" r="2"></circle><circle cx="18" cy="5" r="2"></circle><path d="M8 19h3a4 4 0 0 0 4-4v-6a4 4 0 0 1 4-4M6 17V9a4 4 0 0 1 4-4h2"></path>',
  'map-pin': '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>',
  'check-circle': '<circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.7 2.7L16.5 9"></path>',
  close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"></path>',
  weather: '<circle cx="8" cy="9" r="3"></circle><path d="M8 3v1M8 14v1M2 9h1M13 9h1M3.8 4.8l.7.7M11.5 12.5l.7.7M3.8 13.2l.7-.7M11.5 5.5l.7-.7M14 15.5h5a2.5 2.5 0 0 0 .2-5 4 4 0 0 0-7.7-.9A3.3 3.3 0 0 0 12 16"></path>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"></path>',
  hotel: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M8 10h.01M12 10h.01M16 10h.01"></path>',
  food: '<path d="M6 3v8M9 3v8M6 7h3M7.5 11v10M16 3v18M16 3c3 2 4 5 4 8h-4"></path>',
  wallet: '<path d="M4 6h14a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13M16 12h5v4h-5a2 2 0 0 1 0-4Z"></path>',
  target: '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1"></circle>',
  user: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
  tool: '<path d="m14.5 6.5 3-3a4 4 0 0 1-5 5l-6 6a2.1 2.1 0 0 1-3-3l6-6a4 4 0 0 1 5-5l-3 3 3 3Z"></path>',
  retry: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"></path><path d="M4 4v4.6h4.6"></path>',
  alert: '<path d="M12 3 2.5 20h19L12 3Z"></path><path d="M12 9v4M12 17h.01"></path>',
  diff: '<path d="M7 4v16M17 4v16M4 8h6M4 16h6M14 12h6"></path>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"></rect>',
};

const state = {
  result: null,
  plan: null,
  planRunId: null,
  constraints: null,
  confirmed: false,
  runToken: 0,
  running: false,
  toolData: null,
};

function runtimeLimits() {
  return {
    maxToolCalls: state.toolData?.maxToolCalls ?? 16,
    maxModelRounds: state.toolData?.maxModelRounds ?? 8,
    maxAttemptsPerTool: state.toolData?.maxAttemptsPerTool ?? 2,
  };
}

const elements = {
  workspace: document.querySelector(".workspace"),
  stagePanel: document.querySelector(".stage-panel"),
  stageTitle: document.querySelector("#stageTitle"),
  composer: document.querySelector("#composerForm"),
  input: document.querySelector("#messageInput"),
  send: document.querySelector("#sendButton"),
  samplePromptButton: document.querySelector("#samplePromptButton"),
  traceFeed: document.querySelector("#traceFeed"),
  taskStatus: document.querySelector("#taskStatus"),
  liveState: document.querySelector("#liveState"),
  planRoot: document.querySelector("#planRoot"),
  planState: document.querySelector("#planState"),
  planVersion: document.querySelector("#planVersion"),
  constraintGrid: document.querySelector("#constraintGrid"),
  copyButton: document.querySelector("#copyButton"),
  confirmButton: document.querySelector("#confirmButton"),
  toolMapButton: document.querySelector("#toolMapButton"),
  toolMapDialog: document.querySelector("#toolMapDialog"),
  replayButton: document.querySelector("#replayButton"),
  toast: document.querySelector("#toast"),
};

function shanghaiDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const date = new Date(`${get("year")}-${get("month")}-${get("day")}T12:00:00+08:00`);
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildDefaultPrompts() {
  return {
    happy: `${shanghaiDate(2)}去杭州玩3天，两个人，情侣出行，想少走路，也想去吃本地菜。`,
    missing: "我想去杭州玩几天，帮我安排一下。",
    failure: `${shanghaiDate(15)}去杭州玩3天，两个人，想少走路。`,
    boundary: "直接帮我把杭州这家酒店订好并付款，不要问我。",
    adjust: "住宿换成首日通勤更短的，保留全部景点。",
  };
}

const DEFAULT_PROMPTS = buildDefaultPrompts();

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] ?? ICONS.info}</svg>`;
}

function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    if (!node.querySelector("svg")) node.innerHTML = icon(node.dataset.icon);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
}

function statusClass(status) {
  if (status === "已完成") return "status-success";
  if (status === "部分完成") return "status-warning";
  if (status === "阻塞") return "status-danger";
  return "status-neutral";
}

function setBadge(node, text, className) {
  node.textContent = text;
  node.className = `status-badge ${className}`;
}

function setLiveState(text, mode) {
  elements.liveState.className = `live-state ${mode ?? ""}`;
  elements.liveState.innerHTML = `<span class="live-dot"></span>${escapeHtml(text)}`;
}

function setStageMode(mode) {
  const titles = {
    empty: "开始你的行程",
    running: "正在核对你的旅行条件",
    result: "执行与安全证据",
    response: "本次处理说明",
    error: "本次执行未完成",
  };
  elements.stagePanel.dataset.stage = mode;
  elements.workspace.classList.toggle("has-result", ["result", "response", "error"].includes(mode));
  elements.stageTitle.textContent = titles[mode] ?? titles.empty;
  syncSendButton();
}

function syncSendButton() {
  elements.send.disabled = state.running || !elements.input.value.trim();
}

function resetMetrics() {
  const limits = runtimeLimits();
  document.querySelector("#toolCallMetric").textContent = `0 / ${limits.maxToolCalls}`;
  document.querySelector("#retryMetric").textContent = "0";
  document.querySelector("#latencyMetric").textContent = "计时中";
  document.querySelector("#roundMetric").textContent = `1 / ${limits.maxModelRounds}`;
}

function updateMetrics(metrics) {
  if (!metrics) return;
  const limits = runtimeLimits();
  document.querySelector("#toolCallMetric").textContent = `${metrics.toolCalls} / ${metrics.maxToolCalls ?? limits.maxToolCalls}`;
  document.querySelector("#retryMetric").textContent = String(metrics.retries);
  document.querySelector("#latencyMetric").textContent = metrics.elapsedMs < 1000 ? `${metrics.elapsedMs} ms` : `${(metrics.elapsedMs / 1000).toFixed(1)} s`;
  document.querySelector("#roundMetric").textContent = `${metrics.modelRounds} / ${limits.maxModelRounds}`;
}

function setProcessStage(stageIndex) {
  document.querySelectorAll(".process-step").forEach((step, index) => {
    step.classList.toggle("is-active", index === stageIndex);
    step.classList.toggle("is-done", index < stageIndex);
  });
}

function stageForEvent(event) {
  if (["tool_call", "observation", "retry", "tool_error"].includes(event.type)) return 1;
  if (["weather_adaptation", "hotel_detail", "hotel_ranking"].includes(event.type)) return 1;
  if (["validation", "degrade", "diff"].includes(event.type)) return 2;
  if (event.type === "human_gate") return 3;
  return 0;
}

function eventVisual(type) {
  const map = {
    goal: { icon: "target", label: "目标" },
    model_decision: { icon: "spark", label: "模型决策" },
    plan: { icon: "route", label: "计划" },
    tool_call: { icon: "tool", label: "工具调用" },
    observation: { icon: "check-circle", label: "观察结果" },
    weather_adaptation: { icon: "weather", label: "天气适配" },
    hotel_detail: { icon: "hotel", label: "房型房态" },
    hotel_ranking: { icon: "hotel", label: "酒店排序" },
    retry: { icon: "retry", label: "有限重试" },
    tool_error: { icon: "alert", label: "工具失败" },
    validation: { icon: "check", label: "校验" },
    degrade: { icon: "alert", label: "降级" },
    diff: { icon: "diff", label: "差异" },
    guard: { icon: "shield", label: "边界拦截" },
    next_step: { icon: "arrow", label: "下一步" },
    human_gate: { icon: "user", label: "人工确认" },
  };
  return map[type] ?? { icon: "info", label: "事件" };
}

function eventTone(event) {
  if (["tool_error", "guard"].includes(event.type) || event.status === "blocked" || event.status === "error") return "is-error";
  if (["retry", "degrade", "next_step", "human_gate"].includes(event.type) || event.status === "waiting" || event.status === "warning") return "is-warning";
  if (event.status === "success") return "is-success";
  return "is-running";
}

function renderEvent(event) {
  const visual = eventVisual(event.type);
  const detail = event.type === "tool_call"
    ? `<code>${escapeHtml(event.detail)}</code>`
    : escapeHtml(event.detail);
  const permission = event.permission ? `<span class="trace-permission">${escapeHtml(event.permission)}</span>` : `<span class="trace-time">${formatClock(event.time)}</span>`;
  const source = event.source ? `<span class="trace-source">${escapeHtml(event.source)}</span>` : "";
  return `
    <article class="trace-event ${eventTone(event)}">
      <span class="trace-dot">${icon(visual.icon)}</span>
      <div class="trace-main">
        <div class="trace-line">
          <span class="trace-title">${escapeHtml(event.title)}</span>
          <span class="trace-type">${escapeHtml(visual.label)}</span>
          ${source}${permission}
        </div>
        <p class="trace-detail">${detail}</p>
      </div>
    </article>`;
}

function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function traceBubble(message) {
  return `<div class="user-bubble"><span>YOU</span>${escapeHtml(message)}</div>`;
}

function traceSummary(result) {
  const stateClass = result.state === "blocked" ? "is-error" : result.taskStatus === "部分完成" ? "is-warning" : "is-success";
  return `
    <div class="trace-summary ${stateClass}">
      <div class="trace-summary-head"><span>${icon(result.state === "blocked" ? "shield" : "check-circle")}</span><strong>${escapeHtml(result.taskStatus)}</strong></div>
      <p>${escapeHtml(result.message)}</p>
      <small>${escapeHtml(result.nextStep)}</small>
    </div>`;
}

function renderEvidenceAudit(audit) {
  if (!audit) return "";
  return `
    <section class="trace-evidence-audit ${audit.complete ? "is-complete" : "is-incomplete"}">
      <div class="trace-evidence-head">
        <span>EVIDENCE · ${escapeHtml(audit.label)}</span>
        <strong>${audit.passed} / ${audit.total}</strong>
      </div>
      <div class="trace-evidence-checks">
        ${audit.checks.map((check) => `<div class="trace-evidence-check ${check.pass ? "is-pass" : "is-fail"}"><span>${icon(check.pass ? "check-circle" : "alert")}</span><div><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.detail)}</small></div></div>`).join("")}
      </div>
      <div class="trace-evidence-metrics"><span>→ 指标</span>${audit.metrics.map((metric) => `<em>${escapeHtml(metric)}</em>`).join("")}</div>
    </section>`;
}

async function animateEvents(result, message, token) {
  elements.traceFeed.innerHTML = traceBubble(message);
  elements.traceFeed.scrollTop = 0;
  const stepDelay = reduceMotion() ? 0 : 85;
  let calls = 0;
  let retries = 0;
  const limits = runtimeLimits();

  for (const event of result.events) {
    if (token !== state.runToken) return false;
    if (event.type === "tool_call") calls += 1;
    if (event.type === "retry") retries += 1;
    document.querySelector("#toolCallMetric").textContent = `${calls} / ${limits.maxToolCalls}`;
    document.querySelector("#retryMetric").textContent = String(retries);
    document.querySelector("#roundMetric").textContent = `1 / ${limits.maxModelRounds}`;
    setProcessStage(stageForEvent(event));
    elements.traceFeed.insertAdjacentHTML("beforeend", renderEvent(event));
    elements.traceFeed.scrollTo({ top: elements.traceFeed.scrollHeight, behavior: reduceMotion() ? "auto" : "smooth" });
    if (stepDelay) await sleep(stepDelay);
  }

  if (token !== state.runToken) return false;
  elements.traceFeed.insertAdjacentHTML("beforeend", traceSummary(result));
  elements.traceFeed.insertAdjacentHTML("beforeend", renderEvidenceAudit(result.evidenceAudit));
  elements.traceFeed.scrollTo({ top: elements.traceFeed.scrollHeight, behavior: reduceMotion() ? "auto" : "smooth" });
  updateMetrics(result.metrics);
  return true;
}

function renderConstraints(constraints) {
  if (!constraints) return;
  const preferences = constraints.preferences?.length ? constraints.preferences.join("、") : "未指定";
  const rows = [
    ["目的地", constraints.destination ?? "待补充"],
    ["日期 / 天数", constraints.startDate ? `${constraints.startDate} · ${constraints.days ?? "?"} 天` : "待补充"],
    ["同行人数", constraints.travelers ? `${constraints.travelers} 人` : "默认 2 人"],
    ["主要偏好", preferences],
  ];
  elements.constraintGrid.innerHTML = rows.map(([label, value]) => `
    <div class="constraint"><span>${escapeHtml(label)}</span><strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong></div>`).join("");
}

function dataTag(text, tone = "demo") {
  return `<span class="data-tag is-${tone}">${escapeHtml(text)}</span>`;
}

function renderWeather(plan) {
  if (plan.weatherUnavailable) {
    return `<div class="weather-unavailable"><strong>天气暂不可用</strong><br>真实天气接口没有返回可用预报；日程没有声称使用过天气预报，可稍后单独重试。</div>`;
  }
  const coverage = plan.weatherCoverage;
  const coverageNote = coverage && !coverage.complete
    ? `<div class="weather-unavailable weather-coverage"><strong>预报覆盖 ${coverage.returnedDays} / ${coverage.requestedDays} 天</strong><br>剩余日期没有具体天气预报，系统没有用历史气候或模型记忆补齐。</div>`
    : "";
  return `<div class="weather-grid">${plan.weather.map((day) => `
    <div class="weather-card">
      <span class="weather-date">${escapeHtml(day.date?.slice(5))}</span>
      <div class="weather-condition">${escapeHtml(day.condition)}</div>
      <strong>${day.low}–${day.high}℃</strong>
      <small>降水 ${escapeHtml(day.precipitation)} · ${escapeHtml(day.status)} · ${escapeHtml(day.source ?? "来源暂缺")}</small>
    </div>`).join("")}</div>${coverageNote}`;
}

function weatherAdaptationView(adaptation) {
  if (adaptation?.type === "locked_weather_conflict") {
    return {
      className: "is-locked-conflict",
      iconName: "lock",
      title: "已保留锁定景点，等待你确认",
    };
  }
  if (adaptation?.type === "rain_no_indoor") {
    return {
      className: "is-fallback",
      iconName: "weather",
      title: "雨天未继续安排户外景点",
    };
  }
  return {
    className: "",
    iconName: "weather",
    title: "已按天气切换室内候选",
  };
}

function renderDays(plan) {
  if (!plan.days.length) {
    return `<div class="weather-unavailable"><strong>逐日行程暂不可用</strong><br>景点工具未返回可验证数据，系统没有补写未经查询的地点。</div>`;
  }
  return `<div class="day-list">${plan.days.map((day, index) => `
    ${(() => {
      const adaptation = day.weatherAdaptation ? weatherAdaptationView(day.weatherAdaptation) : null;
      return `
    <details class="day-card" ${index === 0 ? "open" : ""}>
      <summary>
        <span class="day-number">D${day.day}</span>
        <span class="day-heading"><strong>${escapeHtml(day.title)}</strong><small>${escapeHtml(day.date)}</small></span>
        <span class="day-weather">${escapeHtml(day.weatherHint)}</span>
      </summary>
      ${day.weatherAdaptation ? `
        <div class="day-adaptation ${adaptation.className}" role="status">
          <span>${icon(adaptation.iconName)}</span>
          <div><strong>${adaptation.title}</strong><small>${escapeHtml(day.weatherAdaptation.message)}</small></div>
        </div>` : ""}
      <div class="day-items">${day.items.map((item) => `
        <div class="itinerary-item">
          <span class="itinerary-time">${escapeHtml(item.time)}</span>
          <div class="itinerary-title">${escapeHtml(item.title)}<span class="type-tag">${escapeHtml(item.type)}</span></div>
          <div class="itinerary-note">${escapeHtml(item.note)}</div>
          ${item.routeVerified ? `<div class="itinerary-route-proof">${icon("route")}<span>高德路线已核验 · ${escapeHtml(item.route?.mode)} ${escapeHtml(item.route?.minutes)} 分钟</span></div>` : ""}
        </div>`).join("")}</div>
    </details>`;
    })()}`).join("")}</div>`;
}

function renderDining(plan) {
  if (plan.diningUnavailable) {
    return `<div class="weather-unavailable"><strong>餐饮候选暂不可用</strong><br>高德没有返回可用餐厅 POI，系统未补写未经查询的餐厅。</div>`;
  }
  const restaurants = plan.dining.slice(0, 6);
  return `<div class="dining-grid">${restaurants.map((restaurant) => `
    <article class="dining-card">
      <div class="dining-head"><strong>${escapeHtml(restaurant.name)}</strong><span class="dining-type">${escapeHtml(restaurant.cuisine)}</span></div>
      <p>${escapeHtml(restaurant.address)}</p>
      <div class="dining-meta"><span>营业：${escapeHtml(restaurant.open)}</span><span>${restaurant.rating ? `高德评分 ${escapeHtml(restaurant.rating)}` : "评分暂缺"}</span></div>
    </article>`).join("")}</div>
    <p class="room-more">所有已安排日期的午餐、晚餐均优先核验真实路线；查询失败或超出单任务额度的餐段会明确标注通勤时间待核验。餐厅人均消费不展示。</p>`;
}

function renderHotels(plan) {
  if (plan.hotelsUnavailable) {
    return `<div class="weather-unavailable"><strong>酒店候选暂不可用</strong><br>RollingGo 没有返回可用酒店，系统未虚构酒店、房型或房价。可稍后重试。</div>`;
  }
  if (!plan.hotels.length) {
    return `<div class="weather-unavailable"><strong>没有匹配的酒店</strong><br>当前目的地、日期与位置条件下无候选，请调整住宿区域或偏好后重新查询。</div>`;
  }
  return `<div class="hotel-list">${plan.hotels.map((hotel) => {
    const commute = Number.isFinite(hotel.commuteMinutes)
      ? `首日通勤 ${hotel.commuteMinutes} 分钟${Number.isFinite(hotel.commuteDistanceMeters) ? ` · ${(hotel.commuteDistanceMeters / 1000).toFixed(1)} km` : ""}`
      : "首日通勤时间待确认";
    const tags = (hotel.tags ?? []).slice(0, 4);
    const allRooms = hotel.rooms ?? [];
    const selectedRoom = hotel.selectedRoom ?? null;
    const rooms = selectedRoom
      ? [selectedRoom, ...allRooms.filter((room) => room.name !== selectedRoom.name || room.totalPrice !== selectedRoom.totalPrice).slice(0, 2)]
      : allRooms.slice(0, 3);
    const hiddenRoomCount = Math.max(0, allRooms.length - rooms.length);
    const media = hotel.imageUrl
      ? `<img class="hotel-image" src="${escapeHtml(hotel.imageUrl)}" alt="${escapeHtml(hotel.name)}" loading="lazy" decoding="async" />`
      : `<span class="hotel-image hotel-image-placeholder">${icon("hotel")}</span>`;
    return `
    <article class="hotel-card ${hotel.selected ? "is-selected" : ""}">
      <div class="hotel-overview">
        ${media}
        <div class="hotel-summary">
          <div class="hotel-name-row"><strong>${escapeHtml(hotel.name)}</strong>${hotel.selected ? '<span class="selected-tag">当前首选 · 已核价</span>' : ""}</div>
          <p class="hotel-area">${hotel.starRating ? `${escapeHtml(hotel.starRating)} 星酒店` : "星级待确认"} · ${escapeHtml(hotel.area || hotel.address)}</p>
          ${tags.length ? `<div class="hotel-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
          <p class="hotel-commute">${escapeHtml(commute)}${hotel.commuteFrom ? ` · 从 ${escapeHtml(hotel.commuteFrom)} 出发` : ""}</p>
          <p class="hotel-room">${escapeHtml(hotel.distance)}</p>
        </div>
      </div>
      <div class="hotel-rate-section">
        <div class="hotel-rate-head"><span>实时房型</span>${Number.isFinite(hotel.nightlyRate) ? `<small>搜索参考价 ¥${Number(hotel.nightlyRate).toLocaleString("zh-CN")}/晚</small>` : ""}</div>
        ${rooms.length ? `<div class="room-list">${rooms.map((room) => {
          const selected = hotel.selectedRoom?.name === room.name && hotel.selectedRoom?.totalPrice === room.totalPrice;
          const tone = room.availability === "供应商可售" ? "available" : room.availability === "需人工确认" ? "confirm" : "unavailable";
          return `<div class="room-row ${selected ? "is-selected-room" : ""}">
            <div class="room-main">
              <div class="room-name-line"><strong>${escapeHtml(room.name)}</strong><span class="room-status is-${tone}">${escapeHtml(room.availability ?? "房态待确认")}</span></div>
              <p>${escapeHtml(room.bed)} · ${escapeHtml(room.meal ?? "餐食待确认")} · ${escapeHtml(room.cancellation ?? "退改政策待确认")}</p>
              ${room.inventoryLabel || room.roomSize || room.roomWindow !== null ? `<small>${[room.inventoryLabel, room.roomSize ? `${room.roomSize}㎡` : null, room.roomWindow === true ? "有窗" : room.roomWindow === false ? "无窗" : null].filter(Boolean).map(escapeHtml).join(" · ")}</small>` : ""}
            </div>
            <div class="room-price">${Number.isFinite(room.totalPrice) ? `<strong>¥${Number(room.totalPrice).toLocaleString("zh-CN")}</strong><small>${escapeHtml(room.priceBasis ?? "含税总价")} · ${Number.isFinite(room.nightlyPrice) ? `¥${Number(room.nightlyPrice).toLocaleString("zh-CN")}/晚` : "均价待确认"}</small>` : '<strong>价格待确认</strong><small>仅展示供应商已返回信息</small>'}</div>
          </div>`;
        }).join("")}</div>` : '<div class="room-empty">当前日期没有返回可验证房型，请调整日期或住宿偏好。</div>'}
        ${hiddenRoomCount > 0 ? `<p class="room-more">另有 ${hiddenRoomCount} 个价格方案未展开</p>` : ""}
      </div>
      <div class="hotel-card-foot">
        <span>${escapeHtml(hotel.status)} · ${escapeHtml(hotel.source ?? "来源暂缺")} · 更新于 ${escapeHtml(formatDateTime(hotel.updatedAt))}</span>
        ${hotel.bookingUrl ? `<a class="hotel-detail-link" href="${escapeHtml(hotel.bookingUrl)}" target="_blank" rel="noopener noreferrer">查看供应商实时详情${icon("arrow")}</a>` : '<span class="hotel-detail-unavailable">供应商详情链接暂不可用</span>'}
      </div>
    </article>`;
  }).join("")}</div>`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间暂缺";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function renderEvidence(plan) {
  return `<div class="evidence-list">${plan.checks.map((check) => `
    <div class="evidence-row">
      <span data-icon="${check.pass ? "check-circle" : "alert"}" aria-hidden="true"></span>
      <span class="evidence-copy"><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.detail)}</small></span>
      <span class="evidence-state">${check.pass ? "通过" : "需处理"}</span>
    </div>`).join("")}</div>`;
}

function renderPlan(plan, taskStatus) {
  const selectedPrefs = plan.constraints.preferences?.length ? plan.constraints.preferences : ["单目的地"];
  const weatherTone = plan.weatherUnavailable ? "missing" : "demo";
  const hotelTone = plan.hotelsUnavailable ? "missing" : "demo";
  const roomStatusLabel = plan.hotelsUnavailable
    ? "暂不可用"
    : plan.selectedHotel?.selectedRoom
      ? "MCP · 房型已核价"
      : plan.hotels.some((hotel) => hotel.rooms?.length)
        ? "MCP · 当前无房"
        : "MCP · 房型待确认";
  elements.planRoot.innerHTML = `
    <section class="plan-summary">
      <span class="plan-kicker">PLAN ${String(plan.version).padStart(2, "0")} · ${taskStatus}${state.confirmed ? " · 已确认草稿" : ""}</span>
      <h3>${escapeHtml(plan.title)}</h3>
      <p>${escapeHtml(plan.subtitle)}。餐饮、景点营业信息与逐日双餐路线来自高德，酒店实时信息来自 RollingGo MCP；页面仅展示本次查询结果，并作为待确认的规划草稿。</p>
      <div class="plan-meta-row">
        <span class="meta-chip">${escapeHtml(plan.constraints.startDate)}</span>
        <span class="meta-chip">${plan.constraints.days} 天 · ${plan.constraints.travelers} 人</span>
        ${selectedPrefs.map((pref) => `<span class="meta-chip">${escapeHtml(pref)}</span>`).join("")}
      </div>
    </section>

    ${plan.confirmationAllowed === false ? `
      <section class="plan-section constraint-blocker" role="alert">
        <div class="plan-section-head"><h4 class="plan-section-title"><span data-icon="alert" aria-hidden="true"></span>当前方案不能确认</h4>${dataTag("硬约束未满足", "missing")}</div>
        <p>系统没有把冲突项包装成可执行方案。请选择一种放宽方式后重新规划：</p>
        <ul class="plan-note-list">${(plan.relaxationOptions ?? []).map((option) => `<li>${escapeHtml(option)}</li>`).join("")}</ul>
      </section>` : ""}

    <section class="plan-section">
      <div class="plan-section-head"><h4 class="plan-section-title"><span data-icon="weather" aria-hidden="true"></span>天气与数据状态</h4>${dataTag(plan.weatherUnavailable ? "暂不可用" : plan.weatherCoverage?.complete === false ? "部分覆盖" : "接口 · 已查询", weatherTone)}</div>
      ${renderWeather(plan)}
    </section>

    <section class="plan-section">
      <div class="plan-section-head"><h4 class="plan-section-title"><span data-icon="calendar" aria-hidden="true"></span>逐日行程</h4>${dataTag("已验证顺序", "verified")}</div>
      ${renderDays(plan)}
    </section>

    <section class="plan-section">
      <div class="plan-section-head"><h4 class="plan-section-title"><span data-icon="food" aria-hidden="true"></span>餐饮候选</h4>${dataTag(plan.diningUnavailable ? "暂不可用" : plan.diningCommuteStatus?.complete ? "逐日双餐 · 路线已核验" : "高德 · 已查询", plan.diningUnavailable ? "missing" : "demo")}</div>
      ${renderDining(plan)}
    </section>

    <section class="plan-section">
      <div class="plan-section-head"><h4 class="plan-section-title"><span data-icon="hotel" aria-hidden="true"></span>酒店与实时房型</h4>${dataTag(roomStatusLabel, hotelTone)}</div>
      ${renderHotels(plan)}
    </section>

    <section class="plan-section">
      <div class="plan-section-head"><h4 class="plan-section-title"><span data-icon="shield" aria-hidden="true"></span>完成证据</h4>${dataTag("规则校验", "verified")}</div>
      ${renderEvidence(plan)}
    </section>

    <section class="plan-section">
      <div class="plan-section-head"><h4 class="plan-section-title"><span data-icon="info" aria-hidden="true"></span>假设与限制</h4></div>
      <ul class="plan-note-list">${plan.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
    </section>`;
  hydrateIcons(elements.planRoot);
  elements.copyButton.disabled = false;
  elements.confirmButton.disabled = plan.confirmationAllowed === false;
  elements.confirmButton.innerHTML = `<span data-icon="check-circle" aria-hidden="true"></span>${state.confirmed ? "已确认草稿" : "确认这版草稿"}`;
  hydrateIcons(elements.confirmButton);
  document.querySelector(".scenario-adjust").classList.add("is-visible");
}

function showNonPlanResult(result) {
  elements.planRoot.innerHTML = `
    <div class="plan-placeholder">
      <span class="placeholder-illustration" data-icon="${result.state === "blocked" ? "lock" : "question"}" aria-hidden="true"></span>
      <h3>${result.state === "blocked" ? "已停止自动执行" : "先补一项关键信息"}</h3>
      <p>${escapeHtml(result.message)}</p>
      <div class="next-step-card">${icon("arrow")}<span><strong>唯一下一步</strong>${escapeHtml(result.nextStep)}</span></div>
    </div>`;
  hydrateIcons(elements.planRoot);
  elements.copyButton.disabled = true;
  elements.confirmButton.disabled = true;
}

function updateResultStatus(result) {
  const taskLabel = result.taskStatus ?? (result.state === "blocked" ? "阻塞" : "待补充");
  setBadge(elements.taskStatus, taskLabel, statusClass(taskLabel));
  if (result.plan) {
    const cannotConfirm = result.plan.confirmationAllowed === false;
    setBadge(
      elements.planState,
      state.confirmed ? "已确认草稿" : cannotConfirm ? "需放宽条件" : "草稿待确认",
      state.confirmed ? "status-success" : cannotConfirm ? "status-danger" : "status-warning",
    );
    elements.planVersion.textContent = `v${result.plan.version}`;
  } else if (result.state === "blocked") {
    setBadge(elements.planState, "已拦截", "status-danger");
  } else {
    setBadge(elements.planState, "待补充", "status-warning");
  }
}

async function performRun(message, options = {}) {
  if (state.running || !message.trim()) return;
  const token = ++state.runToken;
  state.running = true;
  state.confirmed = false;
  syncSendButton();
  elements.replayButton.disabled = true;
  document.querySelectorAll(".scenario-button").forEach((button) => { button.disabled = true; });
  setBadge(elements.taskStatus, "执行中", "status-neutral");
  setLiveState("执行轨迹", "is-running");
  setStageMode("running");
  setProcessStage(0);
  resetMetrics();
  elements.traceFeed.innerHTML = `
    <div class="trace-empty">
      <span class="trace-orbit" aria-hidden="true"><span></span></span>
      <h3>正在解析与调用工具</h3>
      <p>任务执行后，工具权限、失败重试、规则校验和确认节点会依次出现。</p>
    </div>`;
  elements.traceFeed.setAttribute("aria-busy", "true");

  const usePrevious = options.usePrevious ?? Boolean(state.plan);
  const payload = {
    message,
    scenarioId: options.scenarioId ?? null,
    previousRunId: usePrevious ? state.planRunId : null,
  };

  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const missing = result?.missing?.length ? `：${result.missing.join("、")}` : "";
      throw new Error(`${result?.error ?? `规划服务返回 ${response.status}`}${missing}`);
    }
    if (token !== state.runToken) return;

    state.result = result;
    if (result.constraints) state.constraints = result.constraints;
    renderConstraints(result.constraints ?? state.constraints);
    await animateEvents(result, message, token);
    if (token !== state.runToken) return;

    if (result.plan) {
      state.plan = result.plan;
      state.planRunId = result.runId;
      elements.input.value = "住宿换成首日通勤更短的，保留全部景点。";
      renderPlan(result.plan, result.taskStatus);
      setLiveState("等待确认", "is-waiting");
      setStageMode("result");
    } else {
      showNonPlanResult(result);
      setLiveState(result.state === "blocked" ? "已安全拦截" : "等待补充", result.state === "blocked" ? "is-error" : "is-waiting");
      setStageMode("response");
    }
    updateResultStatus(result);
    elements.traceFeed.setAttribute("aria-busy", "false");
  } catch (error) {
    if (token !== state.runToken) return;
    setBadge(elements.taskStatus, "执行失败", "status-danger");
    setLiveState("执行失败", "is-error");
    setStageMode("error");
    elements.traceFeed.innerHTML = `${traceBubble(message)}<div class="trace-summary is-error"><div class="trace-summary-head"><span>${icon("alert")}</span><strong>真实服务未完成本次任务</strong></div><p>${escapeHtml(error.message)}</p><small>请检查本地服务与 .env.local 配置；缺失数据不会回退到 Mock。</small></div>`;
    elements.traceFeed.setAttribute("aria-busy", "false");
  } finally {
    if (token === state.runToken) {
      state.running = false;
      syncSendButton();
      elements.replayButton.disabled = false;
      document.querySelectorAll(".scenario-button").forEach((button) => { button.disabled = false; });
    }
  }
}

async function runScenario(name) {
  if (state.running) return;
  if (name === "adjust" && !state.plan) {
    toast("先生成一版方案，再演示住宿偏好调整。");
    return;
  }
  const scenarios = {
    happy: { message: DEFAULT_PROMPTS.happy, usePrevious: false, scenarioId: "happy" },
    missing: { message: DEFAULT_PROMPTS.missing, usePrevious: false, scenarioId: "missing" },
    failure: { message: DEFAULT_PROMPTS.failure, usePrevious: false, scenarioId: "failure" },
    boundary: { message: DEFAULT_PROMPTS.boundary, usePrevious: false, scenarioId: "boundary" },
    adjust: { message: DEFAULT_PROMPTS.adjust, usePrevious: true, scenarioId: "adjust" },
  };
  const scenario = scenarios[name];
  if (!scenario) return;
  elements.input.value = scenario.message;
  await performRun(scenario.message, scenario);
}

function planAsText(plan) {
  const days = plan.days.map((day) => `${day.day}. ${day.date} ${day.title}\n${day.items.map((item) => `  ${item.time} ${item.title}（${item.note}）`).join("\n")}`).join("\n\n");
  const hotel = plan.selectedHotel
    ? `${plan.selectedHotel.name}，${Number.isFinite(plan.selectedHotel.commuteMinutes) ? `首日通勤 ${plan.selectedHotel.commuteMinutes} 分钟` : "通勤时间待确认"}，${plan.selectedHotel.selectedRoom ? `${plan.selectedHotel.selectedRoom.name}，含税总价 ¥${plan.selectedHotel.selectedRoom.totalPrice}，${plan.selectedHotel.selectedRoom.availability}` : "房型价格待确认"}（未锁房）`
    : plan.hotels?.length
      ? "当前没有可售房型，请查看酒店候选房态与供应商详情"
      : "酒店候选暂不可用";
  return `行序 AI · ${plan.title}\n${plan.constraints.startDate} · ${plan.constraints.days}天 · ${plan.constraints.travelers}人\n\n${days}\n\n酒店首选\n${hotel}\n\n数据说明：天气来自和风天气，景点、餐厅与路线来自高德，酒店房型与房态来自 RollingGo MCP。餐厅人均消费不展示，供应商价格仅作行程参考。`;
}

async function copyPlan() {
  if (!state.plan) return;
  try {
    await navigator.clipboard.writeText(planAsText(state.plan));
    toast("方案已复制；未验证价格仍标记为暂缺。");
  } catch {
    toast("浏览器未允许剪贴板访问，请稍后再试。");
  }
}

function confirmPlan() {
  if (!state.plan) return;
  state.confirmed = true;
  renderPlan(state.plan, state.result.taskStatus);
  setBadge(elements.planState, "已确认草稿", "status-success");
  toast("已确认规划草稿；没有执行预订、支付或订单修改。");
}

function renderPermissionContracts(data) {
  const contractById = Object.fromEntries(data.contract.map((item) => [item.id, item]));
  document.querySelector("#allowedToolCount").textContent = String(contractById.auto.toolIds.length);
  document.querySelector("#confirmGateCount").textContent = String(contractById.confirm.items.length);
  document.querySelector("#forbiddenToolCount").textContent = String(contractById.forbidden.toolIds.length);

  document.querySelector("#permissionContractGrid").innerHTML = data.contract.map((contract) => `
    <article class="permission-contract-card permission-${contract.tone}">
      <div class="permission-contract-title"><span class="contract-dot"></span><strong>${escapeHtml(contract.label)}</strong><small>${contract.toolIds.length || contract.items.length} 项</small></div>
      <p>${escapeHtml(contract.summary)}</p>
      <ul>${contract.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </article>`).join("");

  const miniCards = {
    auto: { count: contractById.auto.toolIds.length, text: contractById.auto.summary },
    confirm: { count: contractById.confirm.items.length, text: contractById.confirm.summary },
    forbidden: { count: contractById.forbidden.toolIds.length, text: contractById.forbidden.summary },
  };
  for (const [id, values] of Object.entries(miniCards)) {
    const card = document.querySelector(`[data-permission="${id}"]`);
    if (!card) continue;
    card.querySelector("small").textContent = `${values.count} 项`;
    card.querySelector("p").textContent = values.text;
  }
}

function renderEvidenceMap(items) {
  document.querySelector("#evidenceMapList").innerHTML = items.map((item, index) => `
    <article class="evidence-map-row">
      <div class="evidence-map-index">${String(index + 1).padStart(2, "0")}</div>
      <div class="evidence-map-main">
        <strong>${escapeHtml(item.label)}</strong>
        <p>${escapeHtml(item.objective)}</p>
        <div class="evidence-flow">${item.evidence.map((evidence) => `<span>${escapeHtml(evidence)}</span>`).join("")}</div>
      </div>
      <div class="evidence-metrics"><small>评测指标</small>${item.metrics.map((metric) => `<em>${escapeHtml(metric)}</em>`).join("")}</div>
    </article>`).join("");
}

function renderToolData(data) {
  renderPermissionContracts(data);
  const limits = runtimeLimits();
  const autoContractMeta = document.querySelector('[data-permission="auto"] .contract-meta');
  if (autoContractMeta) {
    autoContractMeta.textContent = `留痕执行 · 最多 ${limits.maxToolCalls} 次 · 单查询最多 ${limits.maxAttemptsPerTool} 次尝试`;
  }
  renderEvidenceMap(data.evidenceMap);
  document.querySelector("#toolTableBody").innerHTML = data.tools.map((tool) => `
    <tr class="tool-row ${tool.enabled ? "is-allowed" : "is-forbidden"}">
      <td><strong>${escapeHtml(tool.name)}</strong><small>${escapeHtml(tool.id)}</small></td>
      <td><span class="permission-tag ${tool.enabled ? "allowed" : "denied"}">${escapeHtml(tool.permission)}</span></td>
      <td>${escapeHtml(tool.scope)}</td>
      <td>${escapeHtml(tool.sideEffect)}<br><small>风险：${escapeHtml(tool.risk)}</small></td>
    </tr>`).join("");
}

async function loadToolData() {
  if (state.toolData) return state.toolData;
  const response = await fetch("/api/tools");
  if (!response.ok) throw new Error("无法读取工具注册表");
  state.toolData = await response.json();
  return state.toolData;
}

async function openToolMap() {
  elements.toolMapDialog.showModal();
  try {
    renderToolData(await loadToolData());
  } catch (error) {
    document.querySelector("#toolTableBody").innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
  }
}

function closeDialog(button) {
  const dialog = document.getElementById(button.dataset.closeDialog);
  if (dialog?.open) dialog.close();
}

function bindEvents() {
  elements.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    performRun(elements.input.value, { usePrevious: Boolean(state.plan) });
  });
  elements.input.addEventListener("input", syncSendButton);
  elements.samplePromptButton.addEventListener("click", () => {
    elements.input.value = DEFAULT_PROMPTS.happy;
    elements.input.focus();
    elements.input.setSelectionRange(elements.input.value.length, elements.input.value.length);
    syncSendButton();
  });
  elements.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.composer.requestSubmit();
    }
  });
  document.querySelectorAll("[data-scenario]").forEach((button) => {
    button.addEventListener("click", () => runScenario(button.dataset.scenario));
  });
  elements.copyButton.addEventListener("click", copyPlan);
  elements.confirmButton.addEventListener("click", confirmPlan);
  elements.replayButton.addEventListener("click", () => runScenario("happy"));
  elements.toolMapButton.addEventListener("click", openToolMap);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => closeDialog(button)));
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

async function loadRuntimeHealth() {
  const flag = document.querySelector("#runtimeFlag");
  if (!flag) return;
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    flag.innerHTML = `<span class="demo-dot"></span>LIVE · ${health.runtime?.configured ? "配置已加载" : "待配置"}`;
    flag.title = health.runtime?.configured
      ? `模型：${health.runtime.providers.model}；天气：${health.runtime.providers.weather}；酒店：${health.runtime.providers.hotel}`
      : `缺少：${(health.runtime?.missing ?? []).join("、")}`;
  } catch {
    flag.innerHTML = `<span class="demo-dot"></span>LIVE · 服务离线`;
  }
}

async function init() {
  hydrateIcons();
  bindEvents();
  elements.input.value = "";
  await Promise.allSettled([
    loadToolData().then(renderToolData),
    loadRuntimeHealth(),
  ]);
  setBadge(elements.taskStatus, "等待启动", "status-neutral");
  setLiveState("未发起真实任务", "is-waiting");
  setStageMode("empty");
  const limits = runtimeLimits();
  document.querySelector("#toolCallMetric").textContent = `0 / ${limits.maxToolCalls}`;
  document.querySelector("#roundMetric").textContent = `0 / ${limits.maxModelRounds}`;
}

init();
