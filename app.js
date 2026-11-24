import * as THREE from './three.module.js';

const $ = (selector) => document.querySelector(selector);
const defaults = { mass: 4, temperature: 15, volume: 200, stirring: 0 };
const inputs = Object.fromEntries(Object.keys(defaults).map(key => [key, $(`#${key}`)]));
const readSettings = () => Object.fromEntries(Object.entries(inputs).map(([key, el]) => [key, Number(el.value)]));
let savedSpeed = 1;
try { const stored = Number(localStorage.getItem('calvive-lab-speed')); if ([1, 5, 10].includes(stored)) savedSpeed = stored; } catch {}
const state = { mode: 'idle', elapsed: 0, progress: 0, speed: savedSpeed, duration: 45, settings: readSettings(), recorded: false };
let records = [];
try { records = JSON.parse(localStorage.getItem('calvive-lab-records') || '[]'); if (!Array.isArray(records)) records = []; } catch { records = []; }

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const TABLET_ENTRY_SECONDS = .85;
const formatTime = seconds => {
  const tenths = Math.max(0, Math.round(seconds * 10));
  return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor((tenths % 600) / 10)).padStart(2, '0')}.${tenths % 10}`;
};
const waterColor = new THREE.Color(0x6acbff);
const solutionColor = new THREE.Color(0xffa348);
const durationFor = ({mass, temperature, volume, stirring}) => clamp(
  45 * Math.pow(mass / 4, .72) * Math.pow(200 / volume, .16) * Math.exp(-(temperature - 25) * .012) / (1 + stirring / 350 * .65), 10, 135
);
const variableNames = { mass: 'Tablet mass', temperature: 'Water temperature', volume: 'Water volume', stirring: 'Stirring speed' };
function changedVariables(settings) {
  if (!records.length) return [];
  const baseline = records.at(-1);
  return Object.keys(variableNames).filter(key =>
    [...records, settings].some(run => Number(run[key]) !== Number(baseline[key]))
  );
}
function observedDurationFor(settings) {
  const expected = durationFor(settings);
  const minTick = Math.ceil(expected * .97 * 10);
  const maxTick = Math.floor(expected * 1.03 * 10);
  let tick = minTick + Math.floor(Math.random() * (maxTick - minTick + 1));
  const previous = records.find(record =>
    Number(record.mass) === settings.mass && Number(record.temperature) === settings.temperature &&
    Number(record.volume) === settings.volume && Number(record.stirring) === settings.stirring
  );
  if (previous && tick === Math.round(Number(previous.duration) * 10)) {
    tick += tick === maxTick ? -1 : 1;
  }
  return tick / 10;
}

function updateRange(el) {
  el.style.setProperty('--fill', `${((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100}%`);
}
function updateSettingLabels() {
  const s = state.settings;
  $('#mass-value').textContent = `${s.mass.toFixed(1)} g`;
  $('#temperature-value').textContent = `${s.temperature} °C`;
  $('#volume-value').textContent = `${s.volume} mL`;
  $('#scene-volume').textContent = `${s.volume} mL`;
  $('#stirring-value').textContent = `${s.stirring} rpm`;
  $('#scene-temp').textContent = `${s.temperature} °C`;
  for (const el of Object.values(inputs)) updateRange(el);
  if (sceneParts) updateLiquidLevel();
}

function updateSimulationUI() {
  $('#scene-time').textContent = formatTime(clamp(state.elapsed - TABLET_ENTRY_SECONDS, 0, state.duration));
  $('#scene-speed').textContent = `${state.speed}×`;
  const status = $('#status-badge');
  status.className = 'status-badge' + (state.mode === 'running' ? ' running' : state.mode === 'complete' ? ' complete' : '');
  const statusText = {
    idle: ['Ready', '準備就緒'],
    running: ['Reacting', '反應進行中'],
    paused: ['Paused', '已暫停'],
    complete: ['Complete', '反應完成']
  }[state.mode];
  status.innerHTML = `<span></span> ${statusText[0]} <small lang="zh-Hant">${statusText[1]}</small>`;
  const start = $('#start-button');
  const issue = state.mode === 'idle' ? changedVariables(state.settings) : [];
  const warning = $('#fair-test-warning');
  warning.hidden = issue.length <= 1;
  if (issue.length > 1) {
    $('#fair-test-detail').textContent = `Changed: ${issue.map(key => variableNames[key]).join(' + ')}. Change only one variable, or clear the log to start a new test. 只可改變一項變項；清除紀錄可開始新測試。`;
    start.setAttribute('aria-describedby', 'fair-test-warning');
  } else start.removeAttribute('aria-describedby');
  start.disabled = state.mode === 'complete' || issue.length > 1;
  const actionText = {
    idle: ['Start', '開始反應'],
    running: ['Pause', '暫停反應'],
    paused: ['Resume', '繼續反應'],
    complete: ['Complete', '已完成']
  }[state.mode];
  $('#start-label').innerHTML = `${actionText[0]} <small lang="zh-Hant">${actionText[1]}</small>`;
  $('#start-icon').textContent = state.mode === 'running' ? 'Ⅱ' : state.mode === 'complete' ? '✓' : '▶';
}
function setControlsLocked(locked) { for (const el of Object.values(inputs)) el.disabled = locked; }
function saveRecord() {
  if (state.recorded) return;
  const s = state.settings;
  records.unshift({ id: Date.now(), mass: s.mass, temperature: s.temperature, volume: s.volume, stirring: s.stirring, duration: state.duration.toFixed(1) });
  records = records.slice(0, 20);
  state.recorded = true;
  persistRecords();
}
function persistRecords() {
  try { localStorage.setItem('calvive-lab-records', JSON.stringify(records)); } catch {}
  renderRecords();
  updateSimulationUI();
}
function renderRecords() {
  const body = $('#records-body');
  body.replaceChildren();
  $('#clear-records').disabled = records.length === 0;
  $('#open-graph').disabled = records.length === 0;
  if (!records.length) {
    const row = document.createElement('tr'); row.className = 'empty-row';
    const td = document.createElement('td'); td.colSpan = 7; td.innerHTML = 'No experiments yet <small lang="zh-Hant">尚無實驗紀錄</small>';
    row.append(td); body.append(row); return;
  }
  records.forEach((record, index) => {
    const tr = document.createElement('tr');
    const values = [`#${records.length - index}`, `${Number(record.mass).toFixed(1)} g`, `${record.temperature} °C`, `${record.volume} mL`, `${record.stirring} rpm`, `${record.duration} s`];
    values.forEach(value => { const td = document.createElement('td'); td.textContent = value; tr.append(td); });
    const td = document.createElement('td'); const button = document.createElement('button'); button.className = 'delete-record'; button.type = 'button'; button.innerHTML = 'Delete <small lang="zh-Hant">刪除</small>'; button.setAttribute('aria-label', `Delete experiment ${records.length - index} 刪除第 ${records.length - index} 次實驗`);
    button.addEventListener('click', () => { records = records.filter(item => item.id !== record.id); persistRecords(); });
    td.append(button); tr.append(td); body.append(tr);
  });
}

let graphSnapshot = [];
const selectedGraphRuns = new Set();
function renderGraphRunList() {
  const list = $('#graph-run-list');
  list.replaceChildren();
  graphSnapshot.forEach(({run, duration, temperature, volume}) => {
    const label = document.createElement('label');
    label.className = 'graph-run';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.value = String(run); checkbox.checked = selectedGraphRuns.has(run);
    const copy = document.createElement('span');
    copy.className = 'graph-run-copy';
    const title = document.createElement('strong');
    title.textContent = `Run ${run} · ${Number(duration).toFixed(1)} s`;
    const detail = document.createElement('small');
    detail.textContent = `第 ${run} 次 · ${temperature} °C · ${volume} mL`;
    copy.append(title, detail); label.append(checkbox, copy); list.append(label);
  });
  updateGraphSelectAllLabel();
}
function updateGraphSelectAllLabel() {
  const allSelected = graphSnapshot.length > 0 && selectedGraphRuns.size === graphSnapshot.length;
  $('#graph-select-all').innerHTML = allSelected ? 'Deselect all <small lang="zh-Hant">取消全選</small>' : 'Select all <small lang="zh-Hant">全選</small>';
}
function renderGraphChart() {
  const selected = graphSnapshot.filter(item => selectedGraphRuns.has(item.run) && Number.isFinite(Number(item.duration)));
  $('#graph-count').textContent = `${selected.length} selected · 已選 ${selected.length} 筆`;
  const chart = $('#graph-chart');
  if (!selected.length) {
    chart.innerHTML = '<div class="graph-empty">Select at least one run <small lang="zh-Hant">請至少選擇一筆紀錄</small></div>';
    return;
  }
  const left = 78, top = 32, width = 582, height = 256;
  const durations = selected.map(item => Number(item.duration));
  const ceiling = Math.max(10, Math.ceil(Math.max(...durations) * 1.15 / 10) * 10);
  const firstRun = selected[0].run, lastRun = selected.at(-1).run;
  const x = run => firstRun === lastRun ? left + width / 2 : left + (run - firstRun) / (lastRun - firstRun) * width;
  const y = duration => top + height - duration / ceiling * height;
  const points = selected.map(item => ({run: item.run, value: Number(item.duration), x: x(item.run), y: y(Number(item.duration))}));
  const grid = Array.from({length: 5}, (_, i) => {
    const value = ceiling * i / 4, py = y(value);
    return `<line class="graph-grid" x1="${left}" y1="${py}" x2="${left + width}" y2="${py}"/><text class="graph-tick" x="${left - 12}" y="${py + 4}" text-anchor="end">${Number(value.toFixed(1))}</text>`;
  }).join('');
  const line = points.map((point, i) => `${i ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const area = points.length > 1 ? `<path class="graph-area" d="${line} L ${points.at(-1).x.toFixed(2)} ${top + height} L ${points[0].x.toFixed(2)} ${top + height} Z"/>` : '';
  const step = Math.max(1, Math.ceil(points.length / 8));
  const markers = points.map((point, i) => `<g><circle class="graph-point-halo" cx="${point.x}" cy="${point.y}" r="9"/><circle class="graph-point" cx="${point.x}" cy="${point.y}" r="5"/><title>Run ${point.run}: ${point.value.toFixed(1)} s</title>${(i % step === 0 || i === points.length - 1) ? `<text class="graph-run-tick" x="${point.x}" y="${top + height + 25}" text-anchor="middle">#${point.run}</text>` : ''}${points.length <= 8 ? `<text class="graph-value" x="${point.x}" y="${point.y - 15}" text-anchor="middle">${point.value.toFixed(1)} s</text>` : ''}</g>`).join('');
  chart.innerHTML = `<svg viewBox="0 0 700 335" role="img" aria-label="Dissolution time, the dependent variable, by experiment run; ${selected.length} selected records 溶解耗時應變項折線圖"><defs><linearGradient id="graph-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6357e7" stop-opacity=".18"/><stop offset="100%" stop-color="#6357e7" stop-opacity="0"/></linearGradient></defs>${grid}<text class="graph-y-axis-title" transform="translate(17 160) rotate(-90)" text-anchor="middle">Dissolution time (s)</text><line class="graph-axis" x1="${left}" y1="${top}" x2="${left}" y2="${top + height}"/>${area}<path class="graph-line" d="${line}"/>${markers}</svg>`;
}
$('#open-graph').addEventListener('click', () => {
  graphSnapshot = records.map((record, index) => ({...record, run: records.length - index})).reverse();
  selectedGraphRuns.clear(); graphSnapshot.forEach(item => selectedGraphRuns.add(item.run));
  renderGraphRunList(); renderGraphChart(); $('#graph-dialog').showModal();
});
$('#close-graph').addEventListener('click', () => $('#graph-dialog').close());
$('#graph-dialog').addEventListener('click', event => { if (event.target === $('#graph-dialog')) $('#graph-dialog').close(); });
$('#graph-run-list').addEventListener('change', event => {
  if (event.target.type !== 'checkbox') return;
  const run = Number(event.target.value);
  if (event.target.checked) selectedGraphRuns.add(run); else selectedGraphRuns.delete(run);
  updateGraphSelectAllLabel(); renderGraphChart();
});
$('#graph-select-all').addEventListener('click', () => {
  if (selectedGraphRuns.size === graphSnapshot.length) selectedGraphRuns.clear();
  else graphSnapshot.forEach(item => selectedGraphRuns.add(item.run));
  renderGraphRunList(); renderGraphChart();
});

Object.values(inputs).forEach(el => el.addEventListener('input', () => {
  state.settings = readSettings();
  state.duration = durationFor(state.settings);
  updateSettingLabels(); updateSimulationUI();
}));
function updateSpeedButtons() {
  document.querySelectorAll('.speed-button').forEach(button => { const active = Number(button.dataset.speed) === state.speed; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
}
document.querySelectorAll('.speed-button').forEach(button => button.addEventListener('click', () => {
  state.speed = Number(button.dataset.speed);
  try { localStorage.setItem('calvive-lab-speed', String(state.speed)); } catch {}
  updateSpeedButtons();
  updateSimulationUI();
}));
$('#start-button').addEventListener('click', () => {
  if (state.mode === 'idle') {
    state.settings = readSettings();
    if (changedVariables(state.settings).length > 1) { updateSimulationUI(); return; }
    state.duration = observedDurationFor(state.settings); state.elapsed = 0; state.progress = 0; state.recorded = false;
    setControlsLocked(true); state.mode = 'running';
  } else if (state.mode === 'running') state.mode = 'paused';
  else if (state.mode === 'paused') state.mode = 'running';
  updateSimulationUI();
});
$('#reset-button').addEventListener('click', () => {
  state.mode = 'idle'; state.elapsed = 0; state.progress = 0; state.recorded = false;
  if(sceneParts){
    sceneParts.bubbleCarry=0;
    sceneParts.bubbles.forEach(item=>{item.active=false;item.mesh.visible=false;});
  }
  for (const [key, value] of Object.entries(defaults)) inputs[key].value = value;
  state.settings = readSettings(); state.duration = durationFor(state.settings);
  setControlsLocked(false);
  updateSpeedButtons();
  updateSettingLabels(); updateSimulationUI();
});
$('#clear-records').addEventListener('click', () => { records = []; persistRecords(); });

let sceneParts = null;
function advanceSimulation(dt) {
  if (state.mode !== 'running') return;
  state.elapsed += dt * state.speed;
  const normalized = clamp((state.elapsed - TABLET_ENTRY_SECONDS) / state.duration, 0, 1);
  state.progress = 1 - Math.pow(1 - normalized, 1.55);
  if (normalized >= 1) { state.progress = 1; state.mode = 'complete'; saveRecord(); }
  updateSimulationUI();
}
function initScene() {
  const canvas = $('#scene');
  const container = $('#scene-container');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
  const target = new THREE.Vector3(0, 1.78, 0);
  let azimuth = .54, elevation = .23, dragging = false, prevX = 0, prevY = 0, lastDrag = 0;
  function positionCamera() { const radius = 9.25; camera.position.set(Math.sin(azimuth) * Math.cos(elevation) * radius, target.y + Math.sin(elevation) * radius, Math.cos(azimuth) * Math.cos(elevation) * radius); camera.lookAt(target); }
  positionCamera();
  canvas.addEventListener('pointerdown', event => { dragging = true; prevX = event.clientX; prevY = event.clientY; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => { if (!dragging) return; azimuth += (event.clientX - prevX) * .007; elevation = clamp(elevation + (event.clientY - prevY) * .004, -.03, .65); prevX = event.clientX; prevY = event.clientY; lastDrag = performance.now(); positionCamera(); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });

  scene.add(new THREE.HemisphereLight(0xdbeaff, 0x1e3360, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(-3, 7, 5); scene.add(key);
  const blue = new THREE.PointLight(0x76caff, 65, 13); blue.position.set(3, 4, -2); scene.add(blue);
  const warm = new THREE.PointLight(0xffa44f, 25, 9); warm.position.set(-2, 1.8, 3); scene.add(warm);

  const platformMat = new THREE.MeshStandardMaterial({color:0x1b3157,metalness:.45,roughness:.35});
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.38, 2.5, .17, 80), platformMat); platform.position.y = -.18; scene.add(platform);
  const platformGlow = new THREE.Mesh(new THREE.TorusGeometry(2.25,.022,8,96),new THREE.MeshBasicMaterial({color:0x5386dc,transparent:true,opacity:.45})); platformGlow.rotation.x = Math.PI / 2; platformGlow.position.y = -.086; scene.add(platformGlow);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.38,64),new THREE.MeshBasicMaterial({color:0x050f28,transparent:true,opacity:.42,depthWrite:false})); shadow.rotation.x = -Math.PI/2; shadow.position.y = -.077; scene.add(shadow);

  const glassMat = new THREE.MeshPhysicalMaterial({color:0xd9efff,metalness:0,roughness:.05,transparent:true,opacity:.17,side:THREE.DoubleSide,depthWrite:false,clearcoat:1,clearcoatRoughness:0});
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.36,1.3,3.8,80,1,true),glassMat); glass.position.y = 1.9; glass.renderOrder = 5; scene.add(glass);
  const rimMat = new THREE.MeshPhysicalMaterial({color:0xdaf2ff,metalness:.14,roughness:.05,transparent:true,opacity:.86,clearcoat:1});
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.36,.047,12,96),rimMat); rim.rotation.x = Math.PI/2; rim.position.y = 3.8; rim.renderOrder = 6; scene.add(rim);
  const baseRim = new THREE.Mesh(new THREE.TorusGeometry(1.3,.032,10,96),new THREE.MeshBasicMaterial({color:0x91b8dd,transparent:true,opacity:.65})); baseRim.rotation.x=Math.PI/2; baseRim.position.y=.04; scene.add(baseRim);
  const baseDisc = new THREE.Mesh(new THREE.CircleGeometry(1.3,80),new THREE.MeshPhysicalMaterial({color:0xc4e6fb,transparent:true,opacity:.2,side:THREE.DoubleSide,depthWrite:false})); baseDisc.rotation.x=-Math.PI/2; baseDisc.position.y=.02; scene.add(baseDisc);
  const tickMat = new THREE.MeshBasicMaterial({color:0xdcefff,transparent:true,opacity:.55,depthWrite:false});
  for (let i=0;i<6;i++) { const len=i%2===0?.3:.17; const mark = new THREE.Mesh(new THREE.BoxGeometry(len,.015,.012),tickMat); mark.position.set(-1.3+len/2,.77+i*.42,.14); mark.rotation.y=-.1; scene.add(mark); }

  const liquidMat = new THREE.MeshPhysicalMaterial({color:0xff9b48,roughness:.22,metalness:0,transparent:true,opacity:.28,side:THREE.DoubleSide,depthWrite:false,clearcoat:1});
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(1.295,1.26,1,80,1,true),liquidMat); liquid.renderOrder = 2; scene.add(liquid);
  const surfaceMat = new THREE.MeshPhysicalMaterial({color:0xffb268,roughness:.12,metalness:0,transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false});
  const surfaceGeometry = new THREE.BufferGeometry();
  const surfaceVertices = [];
  const surfaceIndices = [];
  const radialSteps = 12, angularSteps = 72;
  for(let ring=0;ring<=radialSteps;ring++){
    const radius=1.295*ring/radialSteps;
    for(let step=0;step<=angularSteps;step++){
      const angle=step/angularSteps*Math.PI*2;
      surfaceVertices.push(Math.cos(angle)*radius,0,Math.sin(angle)*radius);
      if(ring<radialSteps&&step<angularSteps){
        const a=ring*(angularSteps+1)+step,b=a+angularSteps+1;
        surfaceIndices.push(a,a+1,b,b,a+1,b+1);
      }
    }
  }
  surfaceGeometry.setAttribute('position',new THREE.Float32BufferAttribute(surfaceVertices,3).setUsage(THREE.DynamicDrawUsage));
  surfaceGeometry.setIndex(surfaceIndices);
  surfaceGeometry.computeVertexNormals();
  const surface = new THREE.Mesh(surfaceGeometry,surfaceMat); surface.renderOrder=3; scene.add(surface);
  const waterRing = new THREE.Mesh(new THREE.TorusGeometry(1.29,.027,8,80),new THREE.MeshBasicMaterial({color:0xffcf9c,transparent:true,opacity:.72,depthWrite:false})); waterRing.rotation.x=Math.PI/2; waterRing.renderOrder=4; scene.add(waterRing);
  const rippleMat = new THREE.MeshBasicMaterial({color:0xffe1b8,transparent:true,opacity:.3,depthWrite:false});
  const ripples=[];
  for(let i=0;i<3;i++){const ring=new THREE.Mesh(new THREE.RingGeometry(.36+i*.23,.375+i*.23,64),rippleMat.clone());ring.rotation.x=-Math.PI/2;ring.renderOrder=4;scene.add(ring);ripples.push(ring);}
  const currentGroup = new THREE.Group();
  const currentMaterial = new THREE.MeshBasicMaterial({color:0xe1f7ff,transparent:true,opacity:0,depthWrite:false});
  for(let i=0;i<3;i++){
    const points=[];
    for(let step=0;step<=32;step++){
      const t=step/32,angle=i*Math.PI*2/3+t*2.45;
      const radius=.43+i*.14+t*.23;
      points.push(new THREE.Vector3(Math.cos(angle)*radius,0,Math.sin(angle)*radius));
    }
    const line=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),48,.016,5,false),currentMaterial);
    line.renderOrder=4; currentGroup.add(line);
  }
  currentGroup.visible=false; scene.add(currentGroup);

  const tablet = new THREE.Group();
  const tabletMat = new THREE.MeshStandardMaterial({color:0xffdfaa,roughness:.82,metalness:0});
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,.18,64),tabletMat); tablet.add(body);
  const sideBand = new THREE.Mesh(new THREE.TorusGeometry(.498,.013,6,64),new THREE.MeshStandardMaterial({color:0xf4bd76,roughness:.9})); sideBand.rotation.x=Math.PI/2;sideBand.position.y=.02;tablet.add(sideBand);
  for(let i=0;i<30;i++){const theta=i*2.399, r=.1+Math.sqrt((i+1)/31)*.38;const spot=new THREE.Mesh(new THREE.SphereGeometry(.012+(i%4)*.004,6,4),new THREE.MeshStandardMaterial({color:i%3===0?0xf3bd70:0xfff2d3,roughness:1}));spot.position.set(Math.cos(theta)*r,.098,Math.sin(theta)*r);tablet.add(spot);}
  tablet.position.y=.22; tablet.renderOrder=3; scene.add(tablet);
  const fragments=[];
  const fragmentMat = new THREE.MeshStandardMaterial({color:0xffdfb2,roughness:.9});
  for(let i=0;i<18;i++){const fragment=new THREE.Mesh(new THREE.IcosahedronGeometry(.055+(i%3)*.022,0),fragmentMat);fragment.position.set(Math.cos(i*2.4)*(.43+(i%4)*.12),.12,Math.sin(i*2.4)*(.43+(i%4)*.12));fragment.visible=false;scene.add(fragment);fragments.push(fragment);}
  const bubbleGeo = new THREE.SphereGeometry(1,8,8);
  const bubbleMat = new THREE.MeshPhysicalMaterial({color:0xcaf6ff,emissive:0x4babc9,emissiveIntensity:.22,metalness:0,roughness:.08,transparent:true,opacity:.68,depthWrite:false});
  const bubbles=[];
  for(let i=0;i<180;i++){const mesh=new THREE.Mesh(bubbleGeo,bubbleMat);mesh.visible=false;mesh.renderOrder=4;scene.add(mesh);bubbles.push({mesh,active:false,age:0,angle:0,radial:0,size:.025+(i%7)*.009,speed:.65+(i%9)*.055});}
  const stirRod = new THREE.Group();
  const rodShaft = new THREE.Group(); rodShaft.position.set(.58,2.3,0); rodShaft.rotation.z=-.24;
  const rodGlass = new THREE.Mesh(new THREE.CylinderGeometry(.039,.039,3,16),new THREE.MeshPhysicalMaterial({color:0xc7edff,metalness:.05,roughness:.08,transparent:true,opacity:.88,clearcoat:1}));
  rodShaft.add(rodGlass);
  const rodGrip = new THREE.Mesh(new THREE.CylinderGeometry(.061,.052,.36,16),new THREE.MeshStandardMaterial({color:0x78b8e9,metalness:.2,roughness:.28}));
  rodGrip.position.y=1.28; rodShaft.add(rodGrip);
  stirRod.add(rodShaft); stirRod.visible=false; scene.add(stirRod);

  sceneParts={renderer,scene,camera,container,tablet,fragments,bubbles,liquid,surface,waterRing,ripples,currentGroup,currentMaterial,stirRod,glass,stirPhase:0,stirEnergy:0,visualTime:0,bubbleCarry:0,bubbleIndex:0};
  const resize=()=>{const {width,height}=container.getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();};
  new ResizeObserver(resize).observe(container); resize(); updateLiquidLevel();
  let last=performance.now();
  function frame(now){
    const dt=Math.min((now-last)/1000,.05);last=now;
    advanceSimulation(dt);
    if(!dragging && now-lastDrag>1700){azimuth+=dt*.075;positionCamera();}
    if(state.mode==='running') sceneParts.visualTime+=dt;
    renderScene(sceneParts.visualTime,dt);
    renderer.render(scene,camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function updateLiquidLevel(){
  if(!sceneParts)return;
  const h=1.5+(state.settings.volume-50)/250*1.65;
  sceneParts.liquid.scale.y=h;sceneParts.liquid.position.y=h/2+.035;
  sceneParts.surface.position.y=h+.035;sceneParts.waterRing.position.y=h+.038;
  sceneParts.ripples.forEach(ring=>ring.position.y=h+.042);
}
function renderScene(time,dt){
  if(!sceneParts)return;
  const {tablet,fragments,bubbles,surface,waterRing,ripples,currentGroup,currentMaterial,stirRod,liquid}=sceneParts;
  const p=state.progress;
  const active=state.mode!=='idle';
  const stirAmount=state.settings.stirring/400;
  const stirring=state.mode==='running'&&state.elapsed>.6&&stirAmount>0;
  const previousEnergy=sceneParts.stirEnergy;
  sceneParts.stirEnergy+=((stirring?Math.sqrt(stirAmount):0)-sceneParts.stirEnergy)*Math.min(1,dt*3.5);
  if(!stirring&&sceneParts.stirEnergy<.001) sceneParts.stirEnergy=0;
  if(stirring) sceneParts.stirPhase+=dt*(1.5+5*stirAmount);
  stirRod.visible=stirAmount>0;
  stirRod.rotation.y=sceneParts.stirPhase;
  currentGroup.visible=sceneParts.stirEnergy>.025;
  currentGroup.position.y=surface.position.y-.025;
  currentGroup.rotation.y=sceneParts.stirPhase*.8;
  currentMaterial.opacity=sceneParts.stirEnergy*.68;
  const surfacePosition=surface.geometry.attributes.position;
  const energy=sceneParts.stirEnergy;
  if(energy>0||previousEnergy>0){
    for(let i=0;i<surfacePosition.count;i++){
      const x=surfacePosition.getX(i),z=surfacePosition.getZ(i);
      const radius=Math.hypot(x,z)/1.295,angle=Math.atan2(z,x);
      const depression=-.19*energy*(1-radius*radius);
      const wave=.028*energy*Math.sin(angle*2-sceneParts.stirPhase*2+radius*8)*radius*(1-radius);
      surfacePosition.setY(i,depression+wave);
    }
    surfacePosition.needsUpdate=true;
    surface.geometry.computeVertexNormals();
  }
  const entry=clamp(state.elapsed/.85,0,1);
  const eased=1-Math.pow(1-entry,3);
  tablet.position.y=active?4.55-(4.31*eased)+Math.max(0,Math.sin(entry*Math.PI*3))*.07:4.35;
  const scale=active?Math.max(.001,1-p*.96):1;
  tablet.scale.set(scale,Math.max(.15,scale),scale);
  tablet.rotation.y=time*.13+(state.settings.stirring/400)*time*.18;
  tablet.visible=p<.998;
  const tint=active?Math.min(.61,.18+p*.43):.13;
  liquid.material.color.lerpColors(waterColor,solutionColor,active?Math.min(1,p*1.55):0);
  surface.material.color.lerpColors(waterColor,solutionColor,active?Math.min(1,p*1.55):0);
  liquid.material.opacity=tint;
  surface.material.opacity=active?Math.min(.82,.3+p*.36+energy*.16):.27;
  waterRing.material.opacity=active?.4+p*.23:.3;
  surface.scale.setScalar(1+Math.sin(time*2.5)*.003);
  ripples.forEach((ring,i)=>{ring.visible=active&&p<1;ring.material.opacity=active?(.24+.17*Math.sin(time*3+i*2))*(1-p*.7):0;ring.scale.setScalar(1+(time*.36+i*.3)%1*.18);});
  const waterTop=sceneParts.surface.position.y;
  const heatFactor=Math.exp((state.settings.temperature-25)*.014);
  const bubbleDt=state.mode==='running'?dt*state.speed:state.mode==='complete'?dt:0;
  if(state.mode==='running'&&entry>.7&&p<.998){
    const rate=25*heatFactor*Math.sqrt(state.settings.mass/4)*(1+stirAmount*.15)*Math.pow(1-p,.55);
    sceneParts.bubbleCarry=Math.min(36,sceneParts.bubbleCarry+bubbleDt*rate);
    const emissionCount=Math.floor(sceneParts.bubbleCarry);
    sceneParts.bubbleCarry-=emissionCount;
    for(let n=0;n<emissionCount;n++){
      const index=sceneParts.bubbleIndex++;
      const item=bubbles[index%bubbles.length];
      item.active=true;item.age=0;
      item.angle=index*2.399963;
      item.radial=.06+Math.sqrt((index*.61803398875)%1)*.35;
      item.speed=(.65+(index%9)*.055)*(1+(heatFactor-1)*.14);
      item.mesh.visible=true;
    }
  }
  bubbles.forEach(item=>{
    if(!item.active)return;
    item.age+=bubbleDt;
    const height=.22+item.age*item.speed;
    if(height>=waterTop-.03){item.active=false;item.mesh.visible=false;return;}
    const swirl=sceneParts.stirPhase*(.35+height/waterTop*.35);
    const radius=item.radial+height/waterTop*.14;
    item.mesh.position.set(Math.cos(item.angle+swirl+item.age*.14)*radius,height,Math.sin(item.angle+swirl+item.age*.14)*radius);
    item.mesh.scale.setScalar(item.size*(.75+height/waterTop*.5));
  });
  fragments.forEach((fragment,i)=>{fragment.visible=active&&p>.12&&p<.96&&i<Math.round(p*21);if(fragment.visible){fragment.rotation.y=time*.4+i;fragment.position.y=.11+Math.sin(time*1.8+i)*.025;fragment.scale.setScalar(1-p*.55);}});
}

renderRecords(); updateSpeedButtons(); updateSettingLabels(); updateSimulationUI();
try { initScene(); } catch (error) { console.error('3D scene unavailable', error); $('#scene-fallback').hidden=false; let previous=performance.now(); setInterval(()=>{const now=performance.now();advanceSimulation(Math.min((now-previous)/1000,.1));previous=now;},50); }
