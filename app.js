const MARGIN = { top: 40, right: 30, bottom: 20, left: 160 };
const BAR_HEIGHT = 18;
const BAR_GAP = 3;
const LANE_PAD = 12;
const MIN_BAR_WIDTH = 4;

let lang = "en";
let data = null;
let philosopherMap = {};
let selectedId = null;

const svg = d3.select("#timeline");
const container = document.getElementById("timeline-container");
const tooltip = document.getElementById("tooltip");
const detailPanel = document.getElementById("detail-panel");
const detailContent = document.getElementById("detail-content");

async function init() {
  const res = await fetch("data/philosophers.json");
  data = await res.json();

  data.philosophers.forEach((p) => {
    philosopherMap[p.id] = p;
    if (p.died === null) p.died = 2026;
  });

  render();
  window.addEventListener("resize", render);

  document.getElementById("zoom-in").addEventListener("click", () => zoomBy(1.4));
  document.getElementById("zoom-out").addEventListener("click", () => zoomBy(1 / 1.4));
  document.getElementById("zoom-reset").addEventListener("click", resetZoom);
  document.getElementById("lang-btn").addEventListener("click", toggleLang);
  document.getElementById("detail-close").addEventListener("click", closeDetail);
}

let currentTransform = d3.zoomIdentity;
let zoomBehavior;

function render() {
  const W = container.clientWidth;
  const H = container.clientHeight;

  svg.attr("width", W).attr("height", H);
  svg.selectAll("*").remove();

  const innerW = W - MARGIN.left - MARGIN.right;
  const timeExtent = [-650, 2050];

  const xScale = d3
    .scaleLinear()
    .domain(timeExtent)
    .range([0, innerW]);

  const lanes = assignLanes(data, xScale);
  const totalHeight = computeTotalHeight(lanes);
  const svgHeight = Math.max(H, totalHeight + MARGIN.top + MARGIN.bottom);
  svg.attr("height", svgHeight);

  const defs = svg.append("defs");
  defs
    .append("clipPath")
    .attr("id", "clip-main")
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerW)
    .attr("height", svgHeight);

  const root = svg
    .append("g")
    .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

  const zoomGroup = root.append("g").attr("clip-path", "url(#clip-main)");
  const mainGroup = zoomGroup.append("g");

  drawGrid(mainGroup, xScale, totalHeight);
  drawLanes(root, mainGroup, lanes, xScale);
  drawAxis(root, xScale, totalHeight);
  drawInfluenceLines(mainGroup, lanes, xScale);
  drawBars(mainGroup, lanes, xScale);

  zoomBehavior = d3
    .zoom()
    .scaleExtent([0.5, 20])
    .translateExtent([
      [-200, 0],
      [innerW + 200, svgHeight],
    ])
    .on("zoom", (event) => {
      currentTransform = event.transform;
      const newX = currentTransform.rescaleX(xScale);
      mainGroup.selectAll(".philosopher-bar").each(function (d) {
        const el = d3.select(this);
        const x1 = newX(d.born);
        const w = Math.max(MIN_BAR_WIDTH, newX(d.died) - newX(d.born));
        el.attr("x", x1).attr("width", w);
      });
      mainGroup.selectAll(".philosopher-name").each(function (d) {
        const el = d3.select(this);
        const x1 = newX(d.born);
        const w = Math.max(MIN_BAR_WIDTH, newX(d.died) - newX(d.born));
        const nameStr = lang === "zh" && d.name_zh ? d.name_zh : d.name;
        const charW = lang === "zh" ? 12 : 6.5;
        const textW = nameStr.length * charW;
        if (w > textW + 8) {
          el.attr("x", x1 + 6).attr("text-anchor", "start").classed("inside", true);
        } else {
          el.attr("x", x1 + w + 4).attr("text-anchor", "start").classed("inside", false);
        }
      });
      mainGroup.selectAll(".influence-line").attr("d", function (d) {
        return computeInfluencePath(d, lanes, newX);
      });
      mainGroup.selectAll(".grid-line").each(function () {
        const el = d3.select(this);
        const yr = +el.attr("data-year");
        el.attr("x1", newX(yr)).attr("x2", newX(yr));
      });
      root.select(".axis-year").call(
        d3
          .axisTop(newX)
          .tickValues(getTickValues(newX.domain()))
          .tickFormat(formatYear)
          .tickSize(6)
      );
    });

  svg.call(zoomBehavior);

  if (currentTransform !== d3.zoomIdentity) {
    svg.call(zoomBehavior.transform, currentTransform);
  }
}

function assignLanes(data, xScale) {
  const regions = data.regions.slice().sort((a, b) => a.order - b.order);
  const lanes = [];
  let yOffset = 0;

  for (const region of regions) {
    const philosophers = data.philosophers
      .filter((p) => p.region === region.id)
      .sort((a, b) => a.born - b.born);

    const rows = packRows(philosophers);
    const laneHeight = rows.length * (BAR_HEIGHT + BAR_GAP) + LANE_PAD * 2;

    philosophers.forEach((p) => {
      p._row = rows.findIndex((row) => row.includes(p));
      p._laneY = yOffset;
    });

    lanes.push({
      region,
      philosophers,
      rows,
      y: yOffset,
      height: laneHeight,
    });

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
      if (p.born > last.died + 5) {
        rows[i].push(p);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([p]);
    }
  }
  return rows;
}

function computeTotalHeight(lanes) {
  if (lanes.length === 0) return 0;
  const last = lanes[lanes.length - 1];
  return last.y + last.height;
}

function drawGrid(group, xScale, totalHeight) {
  const ticks = getTickValues(xScale.domain());
  group
    .selectAll(".grid-line")
    .data(ticks)
    .join("line")
    .attr("class", "grid-line")
    .attr("data-year", (d) => d)
    .attr("x1", (d) => xScale(d))
    .attr("x2", (d) => xScale(d))
    .attr("y1", 0)
    .attr("y2", totalHeight);
}

function drawAxis(root, xScale, totalHeight) {
  const axis = d3
    .axisTop(xScale)
    .tickValues(getTickValues(xScale.domain()))
    .tickFormat(formatYear)
    .tickSize(6);

  root
    .append("g")
    .attr("class", "axis-year")
    .call(axis);
}

function drawLanes(root, mainGroup, lanes, xScale) {
  const innerW = xScale.range()[1] - xScale.range()[0];

  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];

    mainGroup
      .append("rect")
      .attr("x", xScale.range()[0] - 200)
      .attr("y", lane.y)
      .attr("width", innerW + 400)
      .attr("height", lane.height)
      .attr("fill", i % 2 === 0 ? "rgba(0,0,0,0.015)" : "rgba(0,0,0,0.035)")
      .attr("class", "lane-bg");

    mainGroup
      .append("line")
      .attr("x1", xScale.range()[0] - 200)
      .attr("x2", innerW + 200)
      .attr("y1", lane.y)
      .attr("y2", lane.y)
      .attr("stroke", "#d4d0c8")
      .attr("stroke-width", 0.5);

    root
      .append("text")
      .attr("class", "lane-label")
      .attr("x", -12)
      .attr("y", lane.y + lane.height / 2 - 6)
      .attr("text-anchor", "end")
      .text(lane.region.name);

    root
      .append("text")
      .attr("class", "lane-label-zh")
      .attr("x", -12)
      .attr("y", lane.y + lane.height / 2 + 8)
      .attr("text-anchor", "end")
      .text(lane.region.name_zh);
  }
}

function drawBars(group, lanes, xScale) {
  const allPhilosophers = lanes.flatMap((l) => l.philosophers);

  group
    .selectAll(".philosopher-bar")
    .data(allPhilosophers, (d) => d.id)
    .join("rect")
    .attr("class", "philosopher-bar")
    .attr("x", (d) => xScale(d.born))
    .attr("y", (d) => d._laneY + LANE_PAD + d._row * (BAR_HEIGHT + BAR_GAP))
    .attr("width", (d) => Math.max(MIN_BAR_WIDTH, xScale(d.died) - xScale(d.born)))
    .attr("height", BAR_HEIGHT)
    .attr("rx", 3)
    .attr("ry", 3)
    .attr("fill", (d) => {
      const region = data.regions.find((r) => r.id === d.region);
      return region ? region.color : "#999";
    })
    .attr("opacity", 0.75)
    .on("mouseenter", onBarEnter)
    .on("mousemove", onBarMove)
    .on("mouseleave", onBarLeave)
    .on("click", onBarClick);

  group
    .selectAll(".philosopher-name")
    .data(allPhilosophers, (d) => d.id)
    .join("text")
    .attr("class", "philosopher-name")
    .each(function (d) {
      const el = d3.select(this);
      const x1 = xScale(d.born);
      const w = Math.max(MIN_BAR_WIDTH, xScale(d.died) - xScale(d.born));
      const nameStr = lang === "zh" && d.name_zh ? d.name_zh : d.name;
      const charW = lang === "zh" ? 12 : 6.5;
      const textW = nameStr.length * charW;

      el.attr("y", d._laneY + LANE_PAD + d._row * (BAR_HEIGHT + BAR_GAP) + BAR_HEIGHT / 2 + 3.5);

      if (w > textW + 8) {
        el.attr("x", x1 + 6).attr("text-anchor", "start").classed("inside", true);
      } else {
        el.attr("x", x1 + w + 4).attr("text-anchor", "start").classed("inside", false);
      }

      el.text(nameStr);
    });
}

function drawInfluenceLines(group, lanes, xScale) {
  const links = [];
  data.philosophers.forEach((p) => {
    (p.influenced || []).forEach((targetId) => {
      if (philosopherMap[targetId]) {
        links.push({ source: p, target: philosopherMap[targetId] });
      }
    });
  });

  group
    .selectAll(".influence-line")
    .data(links)
    .join("path")
    .attr("class", "influence-line")
    .attr("d", (d) => computeInfluencePath(d, lanes, xScale))
    .attr("stroke", (d) => {
      const region = data.regions.find((r) => r.id === d.source.region);
      return region ? region.color : "#999";
    })
    .attr("data-source", (d) => d.source.id)
    .attr("data-target", (d) => d.target.id);
}

function computeInfluencePath(link, lanes, xScale) {
  const s = link.source;
  const t = link.target;

  const sx = xScale(s.died);
  const sy = s._laneY + LANE_PAD + s._row * (BAR_HEIGHT + BAR_GAP) + BAR_HEIGHT / 2;
  const tx = xScale(t.born);
  const ty = t._laneY + LANE_PAD + t._row * (BAR_HEIGHT + BAR_GAP) + BAR_HEIGHT / 2;

  const dx = tx - sx;
  const cpx = sx + dx * 0.5;

  return `M${sx},${sy} C${cpx},${sy} ${cpx},${ty} ${tx},${ty}`;
}

function onBarEnter(event, d) {
  tooltip.classList.remove("hidden");
  updateTooltip(d);

  highlightConnections(d);
}

function onBarMove(event) {
  const x = event.clientX + 12;
  const y = event.clientY + 12;
  const rect = tooltip.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  tooltip.style.left = (x + rect.width > vw ? event.clientX - rect.width - 12 : x) + "px";
  tooltip.style.top = (y + rect.height > vh ? event.clientY - rect.height - 12 : y) + "px";
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
  (d.influenced_by || []).forEach((id) => connected.add(id));
  (d.influenced || []).forEach((id) => connected.add(id));

  svg.selectAll(".philosopher-bar").classed("dimmed", (p) => !connected.has(p.id));
  svg.selectAll(".philosopher-bar").classed("highlighted", (p) => p.id === d.id);

  svg
    .selectAll(".influence-line")
    .classed("visible", (l) => l.source.id === d.id || l.target.id === d.id)
    .classed(
      "highlighted",
      (l) => l.source.id === d.id || l.target.id === d.id
    );
}

function clearHighlights() {
  svg.selectAll(".philosopher-bar").classed("dimmed", false).classed("highlighted", false);
  svg.selectAll(".influence-line").classed("visible", false).classed("highlighted", false);
}

function updateTooltip(d) {
  const nameStr = lang === "zh" && d.name_zh ? `${d.name_zh} (${d.name})` : d.name;
  const summaryStr = lang === "zh" && d.summary_zh ? d.summary_zh : d.summary;
  const schoolStr = d.school.join(" / ");

  tooltip.innerHTML = `
    <div class="tt-name">${nameStr}</div>
    <div class="tt-years">${formatYear(d.born)} -- ${d.died >= 2026 ? "present" : formatYear(d.died)}</div>
    <div class="tt-school">${schoolStr}</div>
    <div class="tt-summary">${summaryStr}</div>
  `;
}

function showDetail(d) {
  detailPanel.classList.remove("hidden");

  const summaryStr = lang === "zh" && d.summary_zh ? d.summary_zh : d.summary;
  const influencedBy = (d.influenced_by || [])
    .map((id) => philosopherMap[id])
    .filter(Boolean);
  const influenced = (d.influenced || [])
    .map((id) => philosopherMap[id])
    .filter(Boolean);

  const getName = (p) => (lang === "zh" && p.name_zh ? p.name_zh : p.name);

  detailContent.innerHTML = `
    <div class="detail-name">${d.name}</div>
    <div class="detail-name-zh">${d.name_zh || ""}</div>
    <div class="detail-years">${formatYear(d.born)} -- ${d.died >= 2026 ? "present" : formatYear(d.died)}</div>
    <div class="detail-school">
      ${d.school.map((s) => `<span class="school-tag">${s}</span>`).join("")}
    </div>
    <div class="detail-section">
      <h3>Summary</h3>
      <p>${summaryStr}</p>
    </div>
    ${
      d.key_works && d.key_works.length
        ? `<div class="detail-section">
            <h3>Key Works</h3>
            <ul>${d.key_works.map((w) => `<li class="work-item">${w}</li>`).join("")}</ul>
          </div>`
        : ""
    }
    ${
      influencedBy.length
        ? `<div class="detail-section">
            <h3>Influenced By</h3>
            <ul>${influencedBy.map((p) => `<li class="clickable" data-id="${p.id}">${getName(p)}</li>`).join("")}</ul>
          </div>`
        : ""
    }
    ${
      influenced.length
        ? `<div class="detail-section">
            <h3>Influenced</h3>
            <ul>${influenced.map((p) => `<li class="clickable" data-id="${p.id}">${getName(p)}</li>`).join("")}</ul>
          </div>`
        : ""
    }
  `;

  detailContent.querySelectorAll(".clickable").forEach((el) => {
    el.addEventListener("click", () => {
      const p = philosopherMap[el.dataset.id];
      if (p) showDetail(p);
    });
  });
}

function closeDetail() {
  detailPanel.classList.add("hidden");
  selectedId = null;
}

function toggleLang() {
  lang = lang === "en" ? "zh" : "en";
  render();
  if (selectedId && philosopherMap[selectedId]) {
    showDetail(philosopherMap[selectedId]);
  }
}

function zoomBy(factor) {
  svg.transition().duration(300).call(zoomBehavior.scaleBy, factor);
}

function resetZoom() {
  currentTransform = d3.zoomIdentity;
  svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity);
}

function formatYear(y) {
  if (y < 0) return `${Math.abs(y)} BCE`;
  if (y === 0) return "1 CE";
  return `${y} CE`;
}

function getTickValues(domain) {
  const [lo, hi] = domain;
  const span = hi - lo;
  let step;
  if (span > 2000) step = 200;
  else if (span > 1000) step = 100;
  else if (span > 400) step = 50;
  else if (span > 150) step = 25;
  else step = 10;

  const ticks = [];
  const start = Math.ceil(lo / step) * step;
  for (let y = start; y <= hi; y += step) {
    ticks.push(y);
  }
  return ticks;
}

svg.on("click", () => {
  closeDetail();
});

init();
