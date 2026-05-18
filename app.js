/* =========================================================================
   PhiloMap — D3.js timeline rendering
   ========================================================================= */

const MARGIN  = { top: 48, right: 40, bottom: 24, left: 200 };
const BAR_H   = 22;
const BAR_GAP = 4;
const LANE_PAD_TOP    = 18;
const LANE_PAD_BOTTOM = 14;
const MIN_BAR_W = 6;

let lang = "en";
let data = null;
let philosopherMap = {};
let regionMap = {};
let selectedId = null;
let currentTransform = d3.zoomIdentity;
let zoomBehavior = null;
let renderedLanes = [];
let currentXScale = null;

const svg = d3.select("#timeline");
const container = document.getElementById("timeline-container");
const tooltip = document.getElementById("tooltip");
const detailPanel = document.getElementById("detail-panel");
const detailContent = document.getElementById("detail-content");
const detailFolioNum = document.getElementById("detail-folio-num");

async function init() {
  const res = await fetch("data/philosophers.json");
  data = await res.json();

  data.philosophers.forEach((p, i) => {
    philosopherMap[p.id] = p;
    p._folio = String(i + 1).padStart(3, "0");
    if (p.died === null) p.died = 2026;
  });
  data.regions.forEach(r => { regionMap[r.id] = r; });

  render();
  window.addEventListener("resize", debounce(render, 150));

  document.getElementById("zoom-in").addEventListener("click", () => zoomBy(1.5));
  document.getElementById("zoom-out").addEventListener("click", () => zoomBy(1 / 1.5));
  document.getElementById("zoom-reset").addEventListener("click", resetZoom);
  document.getElementById("lang-btn").addEventListener("click", toggleLang);
  document.getElementById("detail-close").addEventListener("click", closeDetail);

  svg.on("click", () => closeDetail());
}

function render() {
  const W = container.clientWidth;
  const H = container.clientHeight;

  svg.attr("width", W).attr("height", H);

  // Preserve defs (with the paper-grain filter), clear other top-level groups
  svg.selectAll(":scope > g").remove();
  if (svg.select("defs").empty()) svg.append("defs");

  const innerW = W - MARGIN.left - MARGIN.right;
  const timeExtent = [-650, 2050];

  const xScale = d3.scaleLinear().domain(timeExtent).range([0, innerW]);
  currentXScale = xScale;

  const lanes = assignLanes(data);
  renderedLanes = lanes;
  const totalH = computeTotalHeight(lanes);
  const svgHeight = Math.max(H, totalH + MARGIN.top + MARGIN.bottom);
  svg.attr("height", svgHeight);

  ensureClipPath(svg, innerW, svgHeight);

  const root = svg
    .append("g")
    .attr("class", "root")
    .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

  // Static side margin (lane labels) — outside clip
  const sideGroup = root.append("g").attr("class", "side-group");

  // Clipped main area
  const zoomGroup = root.append("g").attr("clip-path", "url(#clip-main)");
  const mainGroup = zoomGroup.append("g").attr("class", "main-group");

  drawLaneBackgrounds(mainGroup, lanes, innerW);
  drawGrid(mainGroup, xScale, totalH);
  drawSideLabels(sideGroup, lanes);
  drawTimeAxis(root, xScale, totalH);
  drawInfluenceLines(mainGroup, lanes, xScale);
  drawBars(mainGroup, lanes, xScale);

  zoomBehavior = d3
    .zoom()
    .scaleExtent([0.5, 25])
    .translateExtent([
      [-300, 0],
      [innerW + 300, svgHeight],
    ])
    .on("zoom", (event) => {
      currentTransform = event.transform;
      const newX = currentTransform.rescaleX(xScale);
      applyZoom(mainGroup, root, newX, lanes, innerW, totalH);
    });

  svg.call(zoomBehavior);

  if (currentTransform !== d3.zoomIdentity) {
    svg.call(zoomBehavior.transform, currentTransform);
  }
}

/* -------------------------------------------------------------------------
   Layout: assign each philosopher to a row inside its region's swimlane
   ------------------------------------------------------------------------- */

function assignLanes(data) {
  const regions = data.regions.slice().sort((a, b) => a.order - b.order);
  const lanes = [];
  let yOffset = 0;

  for (const region of regions) {
    const philosophers = data.philosophers
      .filter((p) => p.region === region.id)
      .sort((a, b) => a.born - b.born);

    const rows = packRows(philosophers);
    const laneHeight = rows.length * (BAR_H + BAR_GAP) + LANE_PAD_TOP + LANE_PAD_BOTTOM;

    philosophers.forEach((p) => {
      p._row = rows.findIndex((row) => row.includes(p));
      p._laneY = yOffset;
    });

    lanes.push({ region, philosophers, rows, y: yOffset, height: laneHeight });
    yOffset += laneHeight;
  }
  return lanes;
}

function packRows(philosophers) {
  const rows = [];
  for (const p of philosophers) {
    let placed = false;
    for (let i = 0; i < rows.length; i++) {
      const last = rows[i][rows[i].length - 1];
      if (p.born > last.died + 8) {
        rows[i].push(p);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([p]);
  }
  return rows;
}

function computeTotalHeight(lanes) {
  if (!lanes.length) return 0;
  const last = lanes[lanes.length - 1];
  return last.y + last.height;
}

function ensureClipPath(svg, w, h) {
  const defs = svg.select("defs");
  defs.select("#clip-main").remove();
  defs.append("clipPath")
    .attr("id", "clip-main")
    .append("rect")
    .attr("x", 0)
    .attr("y", -MARGIN.top + 4)
    .attr("width", w)
    .attr("height", h);
}

/* -------------------------------------------------------------------------
   Drawing
   ------------------------------------------------------------------------- */

function drawLaneBackgrounds(group, lanes, innerW) {
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    group.append("rect")
      .attr("class", i % 2 === 0 ? "lane-bg-even" : "lane-bg-odd")
      .attr("x", -300)
      .attr("y", lane.y)
      .attr("width", innerW + 600)
      .attr("height", lane.height);

    if (i > 0) {
      group.append("line")
        .attr("class", "lane-divider")
        .attr("x1", -300)
        .attr("x2", innerW + 300)
        .attr("y1", lane.y)
        .attr("y2", lane.y);
    }
  }
}

function drawSideLabels(group, lanes) {
  // Layout inside the left margin (width = MARGIN.left = 200px from x=-200 to x=0):
  //   [ NUMERAL ] [ vertical rule ] [ REGION NAME ]
  //   -180         -90               -80 → -10
  const NUM_X     = -MARGIN.left + 18;   // -182
  const RULE_X    = -MARGIN.left + 84;   // -116
  const LABEL_X   = -MARGIN.left + 100;  // -100  (text-anchor=start)
  const BRACKET_X = -MARGIN.left + 6;    // -194

  for (const lane of lanes) {
    const cy = lane.y + lane.height / 2;
    const g = group.append("g")
      .attr("class", "side-label")
      .attr("transform", `translate(0, ${cy})`);

    // Decorative left bracket (subtle, frames the numeral)
    g.append("path")
      .attr("class", "lane-label-bracket")
      .attr("d", `M ${BRACKET_X + 6} -36 L ${BRACKET_X} -36 L ${BRACKET_X} 36 L ${BRACKET_X + 6} 36`);

    // Roman numeral
    g.append("text")
      .attr("class", "lane-numeral")
      .attr("x", NUM_X)
      .attr("y", 6)
      .attr("text-anchor", "start")
      .attr("dominant-baseline", "middle")
      .text(lane.region.numeral);

    // Vertical rule between numeral and label
    g.append("line")
      .attr("class", "lane-divider")
      .attr("x1", RULE_X).attr("x2", RULE_X)
      .attr("y1", -22).attr("y2", 22)
      .attr("stroke", "var(--rule)").attr("stroke-width", 0.5);

    // Region name (display face)
    g.append("text")
      .attr("class", "lane-label")
      .attr("x", LABEL_X)
      .attr("y", -3)
      .attr("text-anchor", "start")
      .text(lane.region.name);

    // Region name in Chinese
    g.append("text")
      .attr("class", "lane-label-zh")
      .attr("x", LABEL_X)
      .attr("y", 14)
      .attr("text-anchor", "start")
      .text(lane.region.name_zh);
  }
}

function drawGrid(group, xScale, totalH) {
  const ticks = getMajorTicks(xScale.domain());
  group.selectAll(".grid-line.major")
    .data(ticks)
    .join("line")
    .attr("class", "grid-line major")
    .attr("data-year", d => d)
    .attr("x1", d => xScale(d))
    .attr("x2", d => xScale(d))
    .attr("y1", 0)
    .attr("y2", totalH);

  // Year 0 / CE marker (rubricated)
  group.append("line")
    .attr("class", "era-zero")
    .attr("data-year", 0)
    .attr("x1", xScale(0))
    .attr("x2", xScale(0))
    .attr("y1", 0)
    .attr("y2", totalH);

  group.append("text")
    .attr("class", "era-zero-label")
    .attr("data-year", 0)
    .attr("x", xScale(0) + 4)
    .attr("y", 14)
    .text("BCE | CE");
}

function drawTimeAxis(root, xScale, totalH) {
  const majorTicks = getMajorTicks(xScale.domain());

  const axis = d3.axisTop(xScale)
    .tickValues(majorTicks)
    .tickFormat(formatYear)
    .tickSize(6);

  root.append("g")
    .attr("class", "axis-year axis-major")
    .attr("transform", `translate(0, ${-8})`)
    .call(axis);
}

function drawBars(group, lanes, xScale) {
  const all = lanes.flatMap(l => l.philosophers);

  const barG = group.selectAll(".philosopher-bar")
    .data(all, d => d.id)
    .join(enter => {
      const g = enter.append("g")
        .attr("class", "philosopher-bar")
        .attr("data-id", d => d.id)
        .on("mouseenter", onBarEnter)
        .on("mousemove", onBarMove)
        .on("mouseleave", onBarLeave)
        .on("click", onBarClick);

      g.append("rect").attr("class", "philosopher-bar-fill");
      g.append("rect").attr("class", "philosopher-bar-top");
      g.append("rect").attr("class", "philosopher-bar-stroke");
      return g;
    });

  barG.each(function (d) {
    const sel = d3.select(this);
    const x = xScale(d.born);
    const w = Math.max(MIN_BAR_W, xScale(d.died) - xScale(d.born));
    const y = d._laneY + LANE_PAD_TOP + d._row * (BAR_H + BAR_GAP);
    const color = regionMap[d.region]?.color || "#666";

    sel.select(".philosopher-bar-fill")
      .attr("x", x).attr("y", y)
      .attr("width", w).attr("height", BAR_H)
      .attr("fill", color)
      .attr("opacity", 0.88);

    // Top accent line — slightly darker, like letterpress ink edge
    sel.select(".philosopher-bar-top")
      .attr("x", x).attr("y", y)
      .attr("width", w).attr("height", 2)
      .attr("fill", color)
      .attr("opacity", 1);

    // Invisible stroke layer for highlight
    sel.select(".philosopher-bar-stroke")
      .attr("x", x - 0.5).attr("y", y - 0.5)
      .attr("width", w + 1).attr("height", BAR_H + 1)
      .attr("fill", "none")
      .attr("stroke", "none");
  });

  // Philosopher names
  group.selectAll(".philosopher-name")
    .data(all, d => d.id)
    .join("text")
    .attr("class", "philosopher-name")
    .each(function (d) {
      positionName(d3.select(this), d, xScale);
    });
}

function positionName(sel, d, xScale) {
  const x = xScale(d.born);
  const w = Math.max(MIN_BAR_W, xScale(d.died) - xScale(d.born));
  const y = d._laneY + LANE_PAD_TOP + d._row * (BAR_H + BAR_GAP) + BAR_H / 2 + 4;
  const nameStr = (lang === "zh" && d.name_zh) ? d.name_zh : d.name;

  // Char width estimation
  const charW = lang === "zh" ? 13 : 6.0;
  const textW = nameStr.length * charW;

  if (w > textW + 14) {
    sel.attr("x", x + 8).attr("y", y).attr("text-anchor", "start").classed("inside", true);
  } else {
    sel.attr("x", x + w + 5).attr("y", y).attr("text-anchor", "start").classed("inside", false);
  }
  sel.text(nameStr);
}

function drawInfluenceLines(group, lanes, xScale) {
  const links = [];
  data.philosophers.forEach(p => {
    (p.influenced || []).forEach(targetId => {
      if (philosopherMap[targetId]) {
        links.push({ source: p, target: philosopherMap[targetId] });
      }
    });
  });

  group.selectAll(".influence-line")
    .data(links)
    .join("path")
    .attr("class", "influence-line outgoing")
    .attr("d", d => computeInfluencePath(d, xScale))
    .attr("data-source", d => d.source.id)
    .attr("data-target", d => d.target.id);
}

function computeInfluencePath(link, xScale) {
  const s = link.source;
  const t = link.target;

  const sx = xScale(s.died);
  const sy = s._laneY + LANE_PAD_TOP + s._row * (BAR_H + BAR_GAP) + BAR_H / 2;
  const tx = xScale(t.born);
  const ty = t._laneY + LANE_PAD_TOP + t._row * (BAR_H + BAR_GAP) + BAR_H / 2;

  const dx = tx - sx;
  const dy = ty - sy;
  const sameRegion = s.region === t.region;
  const arcHeight = sameRegion
    ? Math.min(40, Math.abs(dx) * 0.15)
    : 0;

  if (sameRegion) {
    const midX = (sx + tx) / 2;
    const midY = (sy + ty) / 2 - arcHeight;
    return `M${sx},${sy} Q${midX},${midY} ${tx},${ty}`;
  }
  const cpx = sx + dx * 0.5;
  return `M${sx},${sy} C${cpx},${sy} ${cpx},${ty} ${tx},${ty}`;
}

/* -------------------------------------------------------------------------
   Zoom application
   ------------------------------------------------------------------------- */

function applyZoom(mainGroup, root, newX, lanes, innerW, totalH) {
  // Bars
  mainGroup.selectAll(".philosopher-bar").each(function (d) {
    const sel = d3.select(this);
    const x = newX(d.born);
    const w = Math.max(MIN_BAR_W, newX(d.died) - newX(d.born));
    sel.select(".philosopher-bar-fill").attr("x", x).attr("width", w);
    sel.select(".philosopher-bar-top").attr("x", x).attr("width", w);
    sel.select(".philosopher-bar-stroke").attr("x", x - 0.5).attr("width", w + 1);
  });

  // Names
  mainGroup.selectAll(".philosopher-name").each(function (d) {
    positionName(d3.select(this), d, newX);
  });

  // Influence lines
  mainGroup.selectAll(".influence-line").attr("d", d => computeInfluencePath(d, newX));

  // Grid (major)
  const newTicks = getMajorTicks(newX.domain());
  const gridSel = mainGroup.selectAll(".grid-line.major").data(newTicks, d => d);
  gridSel.exit().remove();
  gridSel.attr("x1", d => newX(d)).attr("x2", d => newX(d));
  gridSel.enter().append("line")
    .attr("class", "grid-line major")
    .attr("y1", 0).attr("y2", totalH)
    .attr("x1", d => newX(d)).attr("x2", d => newX(d));

  // Era zero
  mainGroup.select(".era-zero").attr("x1", newX(0)).attr("x2", newX(0));
  mainGroup.select(".era-zero-label").attr("x", newX(0) + 4);

  // Time axis
  root.select(".axis-year").call(
    d3.axisTop(newX)
      .tickValues(getMajorTicks(newX.domain()))
      .tickFormat(formatYear)
      .tickSize(6)
  );
}

/* -------------------------------------------------------------------------
   Interaction
   ------------------------------------------------------------------------- */

function onBarEnter(event, d) {
  tooltip.classList.remove("hidden");
  updateTooltip(d);
  highlightConnections(d);
}

function onBarMove(event) {
  const pad = 14;
  const x = event.clientX + pad;
  const y = event.clientY + pad;
  const rect = tooltip.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = (x + rect.width > vw - 16) ? (event.clientX - rect.width - pad) : x;
  const top  = (y + rect.height > vh - 16) ? (event.clientY - rect.height - pad) : y;
  tooltip.style.left = Math.max(8, left) + "px";
  tooltip.style.top  = Math.max(8, top) + "px";
}

function onBarLeave() {
  tooltip.classList.add("hidden");
  clearHighlights();
}

function onBarClick(event, d) {
  event.stopPropagation();
  selectedId = d.id;
  showDetail(d);
}

function highlightConnections(d) {
  const connected = new Set([d.id]);
  (d.influenced_by || []).forEach(id => connected.add(id));
  (d.influenced || []).forEach(id => connected.add(id));

  svg.selectAll(".philosopher-bar")
    .classed("dimmed", p => !connected.has(p.id))
    .classed("highlighted", p => p.id === d.id);

  svg.selectAll(".philosopher-name")
    .classed("dimmed", p => !connected.has(p.id));

  svg.selectAll(".influence-line")
    .classed("visible", l => l.source.id === d.id || l.target.id === d.id)
    .classed("incoming", l => l.target.id === d.id)
    .classed("outgoing", l => l.source.id === d.id);
}

function clearHighlights() {
  svg.selectAll(".philosopher-bar").classed("dimmed", false).classed("highlighted", false);
  svg.selectAll(".philosopher-name").classed("dimmed", false);
  svg.selectAll(".influence-line").classed("visible", false);
}

function updateTooltip(d) {
  const nameStr = d.name;
  const nameZh = d.name_zh || "";
  const summaryStr = (lang === "zh" && d.summary_zh) ? d.summary_zh : d.summary;
  const schoolStr = d.school.join(" · ");
  const yearStr = `${formatYear(d.born)} — ${d.died >= 2026 ? "present" : formatYear(d.died)}`;
  const age = (d.died >= 2026)
    ? (2026 - d.born) + " yrs"
    : (d.died - d.born) + " yrs";

  tooltip.innerHTML = `
    <div class="tt-name">${escapeHtml(nameStr)}</div>
    ${nameZh ? `<div class="tt-name-zh">${escapeHtml(nameZh)}</div>` : ""}
    <div class="tt-meta">
      <span class="tt-years">${yearStr}</span>
      <span class="tt-sep">·</span>
      <span>${age}</span>
    </div>
    <div class="tt-school">${escapeHtml(schoolStr)}</div>
    <div class="tt-summary">${escapeHtml(summaryStr)}</div>
  `;
}

function showDetail(d) {
  detailPanel.classList.remove("hidden");
  detailPanel.setAttribute("aria-hidden", "false");
  detailFolioNum.textContent = d._folio;

  const summaryStr = (lang === "zh" && d.summary_zh) ? d.summary_zh : d.summary;
  const influencedBy = (d.influenced_by || []).map(id => philosopherMap[id]).filter(Boolean);
  const influenced   = (d.influenced   || []).map(id => philosopherMap[id]).filter(Boolean);
  const region = regionMap[d.region];
  const getName = p => (lang === "zh" && p.name_zh) ? p.name_zh : p.name;
  const yearStr = `${formatYear(d.born)} — ${d.died >= 2026 ? "present" : formatYear(d.died)}`;
  const ageStr = (d.died >= 2026)
    ? `(b. ${d.died - d.born} yrs ago)`
    : `(lived ${d.died - d.born} yrs)`;

  detailContent.innerHTML = `
    <div class="detail-name">${escapeHtml(d.name)}</div>
    <div class="detail-name-zh">${escapeHtml(d.name_zh || "")}</div>
    <div class="detail-years">${yearStr}<span class="age">${ageStr}</span></div>
    <div class="detail-region">${escapeHtml(region?.name || "")}${region?.name_zh ? " · " + region.name_zh : ""}</div>

    <div class="detail-school">
      ${d.school.map(s => `<span class="school-tag">${escapeHtml(s)}</span>`).join("")}
    </div>

    <div class="detail-section">
      <h3>Summary</h3>
      <p class="detail-summary">${escapeHtml(summaryStr)}</p>
    </div>

    ${d.key_works?.length ? `
      <div class="detail-section">
        <h3>Key Works</h3>
        <ul>${d.key_works.map(w => `<li class="work-item">${escapeHtml(w)}</li>`).join("")}</ul>
      </div>` : ""}

    ${influencedBy.length ? `
      <div class="detail-section">
        <h3>Influenced By</h3>
        <ul>${influencedBy.map(p => `<li class="clickable" data-id="${p.id}">${escapeHtml(getName(p))}</li>`).join("")}</ul>
      </div>` : ""}

    ${influenced.length ? `
      <div class="detail-section">
        <h3>Influenced</h3>
        <ul>${influenced.map(p => `<li class="clickable" data-id="${p.id}">${escapeHtml(getName(p))}</li>`).join("")}</ul>
      </div>` : ""}
  `;

  detailContent.querySelectorAll(".clickable").forEach(el => {
    el.addEventListener("click", () => {
      const p = philosopherMap[el.dataset.id];
      if (p) {
        selectedId = p.id;
        showDetail(p);
        detailPanel.scrollTop = 0;
      }
    });
  });
}

function closeDetail() {
  detailPanel.classList.add("hidden");
  detailPanel.setAttribute("aria-hidden", "true");
  selectedId = null;
}

function toggleLang() {
  lang = lang === "en" ? "zh" : "en";
  const enEl = document.querySelector(".lang-en");
  const zhEl = document.querySelector(".lang-zh");
  enEl.classList.toggle("active", lang === "en");
  zhEl.classList.toggle("active", lang === "zh");

  // Re-render names (cheap)
  svg.selectAll(".philosopher-name").each(function (d) {
    positionName(d3.select(this), d, currentTransform.rescaleX(currentXScale));
  });

  if (selectedId && philosopherMap[selectedId]) {
    showDetail(philosopherMap[selectedId]);
  }
}

function zoomBy(factor) {
  svg.transition().duration(350).ease(d3.easeCubicOut).call(zoomBehavior.scaleBy, factor);
}

function resetZoom() {
  svg.transition().duration(500).ease(d3.easeCubicInOut).call(zoomBehavior.transform, d3.zoomIdentity);
}

/* -------------------------------------------------------------------------
   Utils
   ------------------------------------------------------------------------- */

function formatYear(y) {
  y = Math.round(y);
  if (y < 0) return `${Math.abs(y)} BCE`;
  if (y === 0) return "1 CE";
  return `${y} CE`;
}

function getMajorTicks(domain) {
  const [lo, hi] = domain;
  const span = hi - lo;
  let step;
  if (span > 2500) step = 250;
  else if (span > 1500) step = 200;
  else if (span > 800) step = 100;
  else if (span > 400) step = 50;
  else if (span > 200) step = 25;
  else if (span > 80) step = 10;
  else step = 5;

  const ticks = [];
  const start = Math.ceil(lo / step) * step;
  for (let y = start; y <= hi; y += step) ticks.push(y);
  return ticks;
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

init();
