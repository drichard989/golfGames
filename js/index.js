// index.js — Scorecard + Vegas + UPDATED Banker rules (preserve hardcoded PAR/HCP) 
document.addEventListener('DOMContentLoaded', () => {
  const HOLES = 18;
  const players = [
    { id: 0, name: 'Player A', ch: 0 },
    { id: 1, name: 'Player B', ch: 0 },
    { id: 2, name: 'Player C', ch: 0 },
    { id: 3, name: 'Player D', ch: 0 },
  ];

  // Your hardcoded card values — edit these to match your course
  const PARS   = [4,4,4,5,3,4,4,3,4, 4,4,3,5,5,4,4,3,4];
  const HCPMEN = [7,13,11,15,17,1,5,9,3, 10,2,12,14,18,4,6,16,8];

  const el = (sel) => document.querySelector(sel);
  const els = (sel) => Array.from(document.querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ======= Build Scorecard (preserve existing PAR/HCP if present) =======
  const holesHeader = el('#holesHeader');
  for (let i=1; i<=HOLES; i++) { const th = document.createElement('th'); th.textContent = i; holesHeader.appendChild(th); }
  ['Out','In','Total','To Par','Net'].forEach(lbl => { const th = document.createElement('th'); th.textContent = lbl; holesHeader.appendChild(th); });

  const parRow = el('#parRow');
  const hcpRow = el('#hcpRow');

  function ensureRow(row, values, min, max){
    const existingInputs = row.querySelectorAll('input');
    if (existingInputs.length >= HOLES) {
      // do not overwrite the user's hardcoded values
      // just make sure there are trailing alignment cells
      while (row.children.length < HOLES + 2 + 5) row.appendChild(document.createElement('td'));
      return;
    }
    // clear any existing cells beyond the first two
    while (row.children.length > 2) row.removeChild(row.lastElementChild);
    // build inputs from provided values
    for (let i=0;i<HOLES;i++){
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type='number'; inp.min=String(min); inp.max=String(max); inp.value = values[i];
      td.appendChild(inp); row.appendChild(td);
    }
    for (let i=0;i<5;i++){ row.appendChild(document.createElement('td')); }
  }

  ensureRow(parRow, PARS, 3, 6);
  ensureRow(hcpRow, HCPMEN, 1, 18);

  const tbody = document.querySelector('#scorecard tbody');
  function buildPlayerRow(p){
    const tr = document.createElement('tr'); tr.dataset.pid = p.id;
    const nameTd = document.createElement('td');
    const nameInput = document.createElement('input'); nameInput.className='name-edit'; nameInput.value=p.name;
    nameInput.addEventListener('input', () => { p.name = nameInput.value; refreshVegasTeams(); refreshBankerControls(); recalcAll(); });
    nameTd.appendChild(nameInput); tr.appendChild(nameTd);

    const chTd = document.createElement('td');
    const chInput = document.createElement('input'); chInput.className='ch-input'; chInput.type='number'; chInput.value=p.ch;
    chInput.addEventListener('input', () => { p.ch = Number(chInput.value||0); recalcAll(); });
    chTd.appendChild(chInput); tr.appendChild(chTd);

    for (let h=1;h<=HOLES;h++){
      const td = document.createElement('td');
      const s = document.createElement('input'); s.type='number'; s.className='score-input'; s.min='1';
      s.dataset.pid = String(p.id);
      s.dataset.hole = String(h);
      s.addEventListener('input', () => recalcAll());
      s.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const pid = Number(e.target.dataset.pid);
          const hole = Number(e.target.dataset.hole);
          let nextPid = pid + 1;
          let nextHole = hole;
          if (nextPid >= players.length) { nextPid = 0; nextHole = hole + 1; }
          if (nextHole > HOLES) return;
          const next = document.querySelector(`#scorecard tbody tr[data-pid="${nextPid}"] .score-input[data-hole="${nextHole}"]`);
          if (next) { next.focus(); next.select?.(); }
        }
      });
      td.appendChild(s); tr.appendChild(td);
    }
    for (let i=0;i<5;i++){ const td=document.createElement('td'); td.className = ['split','split','total','to-par','net'][i]; tr.appendChild(td); }
    tbody.appendChild(tr);
  }
  [0,1,2,3].forEach(i => buildPlayerRow(players[i]));

  const totalsRow = el('#totalsRow');
  for (let i=1;i<=HOLES;i++){ totalsRow.appendChild(document.createElement('td')); }
  for (let i=0;i<3;i++){ totalsRow.appendChild(document.createElement('td')); }

  // ======= Score helpers =======
  function getPar(h){ const inp = parRow.querySelectorAll('input')[h-1]; return Number(inp?.value || PARS[h-1] || 4); }
  function getHcpIndex(h){ const inp = hcpRow.querySelectorAll('input')[h-1]; return Number(inp?.value || HCPMEN[h-1] || h); }

  function getScoresForHole(h){
    const out = new Map();
    els('#scorecard tbody tr').filter(tr=>tr.dataset.pid!==undefined).forEach(tr => {
      const pid = Number(tr.dataset.pid);
      const inputs = tr.querySelectorAll('.score-input');
      out.set(pid, Number(inputs[h-1].value || NaN));
    });
    return out;
  }

  function computeNetForHole(h, useNet){
    const par = getPar(h);
    const chs = players.map(p => p.ch);
    const low = Math.min(...chs);
    const adj = players.map(p => Math.max(0, p.ch - low));
    const holeIndex = getHcpIndex(h);
    const strokes = players.map((p, i) => {
      const s = adj[i];
      if (!useNet) return 0;
      const full = Math.floor(s / 18);
      const rem = s % 18;
      return full + (holeIndex <= rem ? 1 : 0);
    });

    const gross = getScoresForHole(h);
    const net = new Map();
    players.forEach((p, i) => {
      const g = gross.get(p.id);
      if (Number.isNaN(g)) { net.set(p.id, NaN); return; }
      if (!useNet) { net.set(p.id, g); return; }
      const strokesRecv = strokes[i];
      const cap = par + 2 + strokesRecv;
      net.set(p.id, Math.min(g, cap) - strokesRecv);
    });
    return net;
  }

  function sumRange(pid, from, to){
    let s=0, n=0;
    for(let h=from; h<=to; h++){
      const v = Number(els(`#scorecard tbody tr[data-pid="${pid}"] .score-input`)[h-1].value || NaN);
      if(!Number.isNaN(v)){ s+=v; n++; }
    }
    return {sum:s, count:n};
  }

  function recalcScorecard(){
    players.forEach(p => {
      const tr = el(`#scorecard tbody tr[data-pid="${p.id}"]`);
      const toParEl = tr.querySelector('.to-par');
      const totalEl = tr.querySelector('.total');
      const netEl = tr.querySelector('.net');
      const outEl = tr.querySelectorAll('.split')[0];
      const inEl  = tr.querySelectorAll('.split')[1];

      const out = sumRange(p.id,1,9).sum;
      const inn = sumRange(p.id,10,18).sum;
      const tot = out + inn;
      outEl.textContent = Number.isFinite(out) && out>0 ? out : '—';
      inEl.textContent  = Number.isFinite(inn) && inn>0 ? inn : '—';
      totalEl.textContent = Number.isFinite(tot) && tot>0 ? tot : '—';

      let toPar = 0, got=0;
      for(let h=1;h<=HOLES;h++){
        const g = Number(els(`#scorecard tbody tr[data-pid="${p.id}"] .score-input`)[h-1].value || NaN);
        const par = getPar(h);
        if(!Number.isNaN(g)){ toPar += (g - par); got++; }
      }
      toParEl.textContent = got? (toPar>0?`+${toPar}`:toPar===0?'E':`${toPar}`) : '—';
      toParEl.dataset.sign = got? (toPar>0?'+':toPar<0?'-':'0') : '';

      const useNet = el('#bankerUseNet')?.checked || el('#optUseNet')?.checked;
      let netSum = 0, have=0;
      for(let h=1;h<=HOLES;h++){
        const map = computeNetForHole(h, !!useNet);
        const v = map.get(p.id);
        if(!Number.isNaN(v)){ netSum += v; have++; }
      }
      netEl.textContent = have? netSum : '—';
    });

    const totals = el('#totalsRow').querySelectorAll('td');
    for(let h=1; h<=HOLES; h++){
      let sum=0, have=0;
      players.forEach(p => {
        const v = Number(els(`#scorecard tbody tr[data-pid="${p.id}"] .score-input`)[h-1].value || NaN);
        if(!Number.isNaN(v)){ sum+=v; have++; }
      });
      totals[h+1].textContent = have? sum : '—';
    }
  }

  // ======= VEGAS (unchanged from earlier merged version) =======
  const vegasTeamsEl = el('#vegasTeams');
  const vegasBody = el('#vegasBody');
  const optUseNet = el('#optUseNet');
  const optDoubleBirdie = el('#optDoubleBirdie');
  const optTripleEagle  = el('#optTripleEagle');
  const vegasTeamWarning = el('#vegasTeamWarning');

  const teamOf = new Array(4).fill('A'); // 'A' or 'B'
  function refreshVegasTeams(){
    if(!vegasTeamsEl) return;
    vegasTeamsEl.innerHTML='';
    players.forEach((p,i)=>{
      const row = document.createElement('div'); row.className='team-row'; row.style.display='contents';
      const name = document.createElement('div'); name.textContent = p.name; row.appendChild(name);
      const a = document.createElement('label'); a.className='radio';
      const ra = document.createElement('input'); ra.type='radio'; ra.name=`team_${i}`; ra.checked = teamOf[i]==='A';
      ra.addEventListener('change', ()=>{ teamOf[i]='A'; recalcVegas(); });
      a.appendChild(ra); a.appendChild(document.createTextNode('Team A')); row.appendChild(a);
      const b = document.createElement('label'); b.className='radio';
      const rb = document.createElement('input'); rb.type='radio'; rb.name=`team_${i}`; rb.checked = teamOf[i]==='B';
      rb.addEventListener('change', ()=>{ teamOf[i]='B'; recalcVegas(); });
      b.appendChild(rb); b.appendChild(document.createTextNode('Team B')); row.appendChild(b);
      vegasTeamsEl.appendChild(row);
    });
  }
  function buildVegasTable(){
    if(!vegasBody) return;
    vegasBody.innerHTML='';
    for(let h=1; h<=HOLES; h++){
      const tr = document.createElement('tr'); tr.dataset.hole=h;
      tr.innerHTML = `<td>${h}</td><td>—</td><td>—</td><td>—</td><td>—</td>`;
      vegasBody.appendChild(tr);
    }
  }
  refreshVegasTeams(); buildVegasTable();

  function twoDigit(a,b){ const [x,y]=[a,b].sort((m,n)=>m-n); return Number(String(x)+String(y)); }
  function isBirdieOrBetter(score, par){ return score <= par-1; }
  function isEagleOrBetter(score, par){ return score <= par-2; }

  function recalcVegas(){
    if(!vegasBody) return;
    const cntA = teamOf.filter(t=>t==='A').length;
    const cntB = 4 - cntA;
    const valid = cntA===2 && cntB===2;
    vegasTeamWarning.hidden = !!valid;

    let totalA=0, totalB=0, ptsA=0;
    for(let h=1; h<=HOLES; h++){
      const tr = vegasBody.querySelector(`tr[data-hole="${h}"]`);
      const map = computeNetForHole(h, optUseNet && optUseNet.checked);
      const par = getPar(h);

      const A = [], B = [];
      players.forEach((p,i)=>{
        const v = map.get(p.id);
        if(Number.isNaN(v)) return;
        (teamOf[i]==='A'?A:B).push(v);
      });
      let numA='—', numB='—', mult='—', pts='—';
      if (valid && A.length===2 && B.length===2){
        const aNum0 = twoDigit(A[0],A[1]);
        const bNum0 = twoDigit(B[0],B[1]);
        const aBird = A.some(s=>isBirdieOrBetter(s,par));
        const aEagle= A.some(s=>isEagleOrBetter(s,par));
        const bBird = B.some(s=>isBirdieOrBetter(s,par));
        const bEagle= B.some(s=>isEagleOrBetter(s,par));
        let aNum = aNum0, bNum = bNum0;
        if (aBird || aEagle){ const digits = String(bNum0).split(''); bNum = Number(digits.reverse().join('')); }
        if (bBird || bEagle){ const digits = String(aNum0).split(''); aNum = Number(digits.reverse().join('')); }
        let winnerIsA = aNum > bNum;
        let m = 1;
        if (winnerIsA && aEagle && optTripleEagle.checked) m = 3;
        else if (winnerIsA && aBird && optDoubleBirdie.checked) m = 2;
        if (!winnerIsA && bEagle && optTripleEagle.checked) m = 3;
        else if (!winnerIsA && bBird && optDoubleBirdie.checked) m = 2;
        const hi = Math.max(aNum, bNum), lo = Math.min(aNum, bNum);
        const diff = (hi - lo) * m;
        pts = winnerIsA ? `+${diff}` : `-${diff}`;
        ptsA += winnerIsA ? diff : -diff;
        numA = aNum; numB = bNum; mult = `×${m}`;
        totalA += aNum; totalB += bNum;
      }
      tr.children[1].textContent = numA;
      tr.children[2].textContent = numB;
      tr.children[3].textContent = mult;
      tr.children[4].textContent = pts;
    }
    el('#vegasTotalA').textContent = totalA || '—';
    el('#vegasTotalB').textContent = totalB || '—';
    el('#vegasPtsA').textContent   = ptsA ? (ptsA>0?`+${ptsA}`:`${ptsA}`) : '—';
  }

  // ======= UPDATED BANKER =======
  const bankerBody = el('#bankerBody');
  const bankerMinBet = el('#bankerMinBet');
  const bankerMaxBet = el('#bankerMaxBet');
  const bankerUseNet = el('#bankerUseNet');
  const initialBankerSel = el('#initialBanker');
  const randomizeBankerBtn = el('#randomizeBanker');

  function refreshBankerControls(){
    if(!initialBankerSel) return;
    initialBankerSel.innerHTML = '';
    players.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      initialBankerSel.appendChild(opt);
    });
  }
  refreshBankerControls();

  function buildBankerTable(){
    if(!bankerBody) return;
    bankerBody.innerHTML='';
    for(let h=1; h<=HOLES; h++){
      const tr = document.createElement('tr'); tr.dataset.hole = h;
      const cells = [
        `<td>${h}</td>`,
        `<td class="muted">—</td>`
      ];
      for(let i=0;i<players.length;i++){ cells.push(`<td class="compact"><input type="number" step="1" class="ch-input"/></td>`); }
      for(let i=0;i<players.length;i++){ cells.push(`<td class="compact"><input type="number" min="1" max="4" value="${i+1}" class="ch-input"/></td>`); }
      for(let i=0;i<players.length;i++){ cells.push(`<td class="compact">—</td>`); }
      tr.innerHTML = cells.join('');
      bankerBody.appendChild(tr);
    }
  }
  buildBankerTable();

  function enforceBetBounds(input){
    const min = Number(bankerMinBet?.value||1);
    const max = Math.max(min, Number(bankerMaxBet?.value||min));
    input.value = input.value ? clamp(Number(input.value), min, max) : '';
    input.min = String(min); input.max = String(max);
  }

  function getHoleFinishOrder(h){
    const tr = el(`#bankerBody tr[data-hole="${h}"]`);
    const inputs = Array.from(tr.querySelectorAll('input'));
    const orderInputs = inputs.slice(4, 8);
    return orderInputs.map(inp => Number(inp.value||999));
  }

  function getHoleBets(h){
    const tr = el(`#bankerBody tr[data-hole="${h}"]`);
    const inputs = Array.from(tr.querySelectorAll('input'));
    const betInputs = inputs.slice(0, 4);
    return betInputs.map(inp => Number(inp.value||NaN));
  }

  function setBankerNameForHole(h, name){
    const tr = el(`#bankerBody tr[data-hole="${h}"]`);
    const td = tr.children[1];
    td.textContent = name;
  }

  function recalcBanker(){
    if(!bankerBody) return;
    els('#bankerBody input[type="number"]').forEach(enforceBetBounds);

    const useNet = bankerUseNet && bankerUseNet.checked;
    const bankerByHole = new Array(HOLES+1);
    bankerByHole[1] = Number(initialBankerSel?.value||0);
    const delta = Array.from({length:HOLES}, ()=>[0,0,0,0]);

    for(let h=1; h<=HOLES; h++){
      const bankerId = bankerByHole[h];
      setBankerNameForHole(h, players[bankerId]?.name ?? '—');

      const map = computeNetForHole(h, useNet);
      const scores = players.map(p => map.get(p.id));

      const tr = el(`#bankerBody tr[data-hole="${h}"]`);
      const inputs = Array.from(tr.querySelectorAll('input'));
      const betInputs = inputs.slice(0,4);
      betInputs.forEach((inp, idx) => {
        if(idx === bankerId){ inp.value=''; inp.disabled=true; }
        else { inp.disabled=false; enforceBetBounds(inp); }
      });

      if (!Number.isNaN(scores[bankerId])) {
        for(let pid=0; pid<players.length; pid++){
          if(pid===bankerId) continue;
          const b = Number(betInputs[pid].value||NaN);
          const sOpp = scores[pid], sBank = scores[bankerId];
          if(Number.isNaN(sOpp) || Number.isNaN(b)) continue;
          if(sOpp === sBank){
          } else if(sOpp < sBank){
            delta[h-1][pid] += b;
            delta[h-1][bankerId] -= b;
          } else {
            delta[h-1][pid] -= b;
            delta[h-1][bankerId] += b;
          }
        }
      }

      if (h < HOLES){
        const validScores = scores.filter(v=>!Number.isNaN(v));
        if (validScores.length>0){
          const minScore = Math.min(...validScores);
          const tied = players.map((p,i)=> ({i, s: scores[i]})).filter(o=>o.s===minScore).map(o=>o.i);
          let nextId;
          if (tied.length===1){ nextId = tied[0]; }
          else {
            const ord = getHoleFinishOrder(h);
            nextId = tied.reduce((best, i) => ord[i] < ord[best] ? i : best, tied[0]);
          }
          bankerByHole[h+1] = nextId;
        } else {
          bankerByHole[h+1] = bankerByHole[h];
        }
      }
    }

    const totals = [0,0,0,0];
    for(let h=1; h<=HOLES; h++){
      const tr = el(`#bankerBody tr[data-hole="${h}"]`);
      const deltaCells = Array.from(tr.children).slice(-4);
      for(let i=0;i<4;i++){
        const v = delta[h-1][i];
        totals[i] += v;
        deltaCells[i].textContent = v===0 ? '—' : (v>0?`+$${v}`:`-$${Math.abs(v)}`);
        deltaCells[i].className = 'compact ' + (v>0?'delta-pos':v<0?'delta-neg':'muted');
      }
    }
    el('#bankerTotP1').textContent = formatMoney(totals[0]);
    el('#bankerTotP2').textContent = formatMoney(totals[1]);
    el('#bankerTotP3').textContent = formatMoney(totals[2]);
    el('#bankerTotP4').textContent = formatMoney(totals[3]);
  }

  
  // ======= CSV Import / Export =======
  function importCsvText(text){
    // Expect headers: player,ch,h1..h18
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return;
    const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
    const idxPlayer = headers.indexOf('player');
    const idxCh = headers.indexOf('ch');
    const idxH = Array.from({length:18}, (_,i)=> headers.indexOf(`h${i+1}`));
    if (idxPlayer === -1 || idxCh === -1 || idxH.some(i=>i===-1)) {
      alert('CSV format should be: player,ch,h1,h2,...,h18');
      return;
    }
    const rows = lines.slice(1).map(l => l.split(',').map(x=>x.trim()));
    rows.slice(0,4).forEach((cols, r) => {
      const tr = document.querySelector(`#scorecard tbody tr[data-pid="${r}"]`);
      if (!tr) return;
      // name
      const nameInput = tr.querySelector('.name-edit');
      if (nameInput) { nameInput.value = cols[idxPlayer] || nameInput.value; }
      // CH
      const chInput = tr.querySelector('.ch-input');
      if (chInput) { chInput.value = cols[idxCh] || chInput.value; }
      // scores
      const scoreInputs = tr.querySelectorAll('.score-input');
      for (let h=0; h<18; h++){
        const val = cols[idxH[h]];
        if (val !== undefined && val !== '') scoreInputs[h].value = val;
      }
    });
    recalcAll();
  }

  function downloadTemplate(){
    const headers = ['player','ch', ...Array.from({length:18}, (_,i)=>`h${i+1}`)];
    const body = Array.from({length:4}, (_,r)=>{
      const name = `Player ${r+1}`;
      const ch = r===0?0:'';
      const holes = Array.from({length:18}, ()=>'');
      return [name, ch, ...holes];
    });
    const csv = [headers.join(','), ...body.map(r=>r.join(','))].join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scorecard_template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }
function formatMoney(v){
    if(v===0) return '—';
    const sign = v>0 ? '+' : '-';
    return `${sign}$${Math.abs(v)}`;
  }

  // ======= Events =======
  el('#toggleVegas')?.addEventListener('click', () => {
    const sec = el('#vegasSection');
    sec.classList.toggle('open');
    el('#toggleVegas').classList.toggle('active');
  });
  el('#toggleBanker')?.addEventListener('click', () => {
    const sec = el('#bankerSection');
    sec.classList.toggle('open');
    el('#toggleBanker').classList.toggle('active');
  });

  [optUseNet, optDoubleBirdie, optTripleEagle].forEach(inp => inp?.addEventListener('change', recalcAll));
  [el('#bankerMinBet'), el('#bankerMaxBet'), el('#bankerUseNet'), el('#initialBanker')].forEach(inp => {
    inp?.addEventListener('input', recalcAll);
    inp?.addEventListener('change', recalcAll);
  });
  el('#randomizeBanker')?.addEventListener('click', () => {
    const idx = Math.floor(Math.random()*players.length);
    const sel = el('#initialBanker');
    if (sel) sel.value = String(idx);
    recalcAll();
  });
  el('#resetBtn')?.addEventListener('click', () => {
    els('.score-input').forEach(i => i.value = '');
    els('#bankerBody input').forEach(i => { if(!i.disabled) i.value=''; });
    els('.ch-input').forEach((i, idx) => { if(idx<4) i.value = '0'; });
    recalcAll();
  });

  function recalcAll(){
    recalcScorecard();
    recalcVegas();
    recalcBanker();
  }


  // CSV UI events
  const csvInput = document.querySelector('#csvInput');
  const dlTemplateBtn = document.querySelector('#dlTemplateBtn');
  csvInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importCsvText(String(reader.result||''));
    reader.readAsText(file);
  });
  dlTemplateBtn?.addEventListener('click', downloadTemplate);

  recalcAll();
});
