/* Golf Scorecard — 4 players / 18 holes + Vegas & Banker (toggleable)
   - Course Handicap input per player (supports negatives)
   - Net totals with NDB; strokes allocated off the lowest CH (play-off-low)
   - Vegas: teams, multipliers, and opponent-digit flip on birdie+
   - Banker: points-per-match, rotate or until-beaten, multipliers
   - CSV upload (player, ch, h1..h18) + client-side template download
*/

(() => {
  console.log('[golfGames] index.js loaded');
  // ========== Configuration Constants ==========
  const HOLES = 18;
  const PLAYERS = 4;
  const LEADING_FIXED_COLS = 2; // Player + CH
  const NDB_BUFFER = 2; // Net Double Bogey buffer strokes above par

  // Course data (can be made configurable in the future)
  const PARS   = [4,4,4,5,3,4,4,3,4, 4,4,3,5,5,4,4,3,4];
  const HCPMEN = [7,13,11,15,17,1,5,9,3, 10,2,12,14,18,4,6,16,8];

  // ---------- DOM helpers ----------
  const $  = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
  const sum = a => a.reduce((x,y)=>x+(Number(y)||0),0);
  const clampInt = (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(+v) ? Math.trunc(+v) : min));

  // ---------- Shared game helpers ----------
  /** Get par value for a specific hole (1-based index) */
  function getParForHole(hole){
    let el = document.querySelector(`#parRow input[data-hole="${hole}"]`);
    if(!el){
      const inputs = document.querySelectorAll('#parRow input');
      el = inputs[hole-1];
    }
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : NaN;
  }

  /** Get score for a player on a specific hole (0-based player index, 1-based hole) */
  function getScoreForPlayer(playerIdx, hole){
    let el = document.querySelector(`.score-input[data-player="${playerIdx}"][data-hole="${hole}"]`);
    if(!el){
      const row = document.querySelector(`tr[data-player="${playerIdx}"]`) || document.querySelectorAll('tbody tr')[2 + playerIdx];
      if(row){
        const inputs = row.querySelectorAll('.score-input');
        el = inputs[hole-1];
      }
    }
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : NaN;
  }

  /** Get player names from name inputs */
  function getPlayerNames(){
    const nameInputs = Array.from(document.querySelectorAll('.name-edit'));
    return [0,1,2,3].map((i)=>{
      const v = nameInputs[i]?.value?.trim();
      return v || `Player ${i+1}`;
    });
  }

  // Small app manager to centralize cross-game recomputes
  const AppManager = {
    recalcGames(){
      try{ vegas_recalc(); }catch(e){ console.warn('vegas_recalc failed', e); }
      try{ banker_recalc?.(); }catch(e){ console.warn('banker_recalc failed', e); }
      try{ updateSkins?.(); }catch(e){ /* skins may not be open yet */ }
      try{ updateJunk?.(); }catch(e){ /* junk may not be open yet */ }
      try{ window._vegasUpdateDollars?.(); }catch{}
    }
  };
  try{ window.AppManager = AppManager; }catch{}

  const ids = {
    holesHeader:"#holesHeader",parRow:"#parRow",hcpRow:"#hcpRow",totalsRow:"#totalsRow",
    table:"#scorecard",courseName:"#courseName",teeName:"#teeName",
    resetBtn:"#resetBtn",clearAllBtn:"#clearAllBtn",saveBtn:"#saveBtn",printBtn:"#printBtn",saveStatus:"#saveStatus",

    // Games toggles
    toggleVegas:"#toggleVegas", toggleBanker:"#toggleBanker", toggleSkins:"#toggleSkins",
    vegasSection:"#vegasSection", bankerSection:"#bankerSection", skinsSection:"#skinsSection",

    // Vegas
  vegasTeams:"#vegasTeams", vegasTeamWarning:"#vegasTeamWarning",
  vegasTableBody:"#vegasBody", vegasTotalA:"#vegasTotalA", vegasTotalB:"#vegasTotalB", vegasPtsA:"#vegasPtsA",
  optUseNet:"#optUseNet", optDoubleBirdie:"#optDoubleBirdie", optTripleEagle:"#optTripleEagle",
  vegasPointValue:"#vegasPointValue", vegasDollarA:"#vegasDollarA", vegasDollarB:"#vegasDollarB",

    // Banker
    bankerPointValue:"#bankerPointValue", bankerRotation:"#bankerRotation",
    bankerUseNet:"#bankerUseNet", bankerDoubleBirdie:"#bankerDoubleBirdie", bankerTripleEagle:"#bankerTripleEagle",
    bankerBody:"#bankerBody",
    bankerTotP1:"#bankerTotP1", bankerTotP2:"#bankerTotP2", bankerTotP3:"#bankerTotP3", bankerTotP4:"#bankerTotP4",

    
    // Skins
    skinsCarry:"#skinsCarry", skinsHalf:"#skinsHalf",
    skinsBody:"#skinsBody", skinsPotTot:"#skinsPotTot",
    skinsTotP1:"#skinsTotP1", skinsTotP2:"#skinsTotP2", skinsTotP3:"#skinsTotP3", skinsTotP4:"#skinsTotP4",
    skinsP1:"#skinsP1", skinsP2:"#skinsP2", skinsP3:"#skinsP3", skinsP4:"#skinsP4",
    skinsSummary:"#skinsSummary",
// CSV
    csvInput:"#csvInput", dlTemplateBtn:"#dlTemplateBtn",
  };

  // ---------- Header ----------
  function buildHeader(){
    const header=$(ids.holesHeader);
    for(let h=1;h<=HOLES;h++){ const th=document.createElement("th"); th.textContent=h; header.appendChild(th); }
    ["Out","In","Total","To Par","Net"].forEach(label=>{ const th=document.createElement("th"); th.textContent=label; header.appendChild(th); });
  }

  // ---------- Par & HCP rows (locked) ----------
  function buildParAndHcpRows(){
    const parRow=$(ids.parRow), hcpRow=$(ids.hcpRow);
    for(let h=1;h<=HOLES;h++){
      const tdp=document.createElement("td"), ip=document.createElement("input"); ip.type="number"; ip.value=PARS[h-1]; ip.readOnly=true; ip.tabIndex=-1; tdp.appendChild(ip); parRow.appendChild(tdp);
      const tdh=document.createElement("td"), ih=document.createElement("input"); ih.type="number"; ih.value=HCPMEN[h-1]; ih.readOnly=true; ih.tabIndex=-1; tdh.appendChild(ih); hcpRow.appendChild(tdh);
    }
    for(let i=0;i<5;i++){ parRow.appendChild(document.createElement("td")); hcpRow.appendChild(document.createElement("td")); }
  }

  // ---------- Player rows ----------
  function buildPlayerRows(){
    const tbody=$(ids.table).tBodies[0];
    for(let p=0;p<PLAYERS;p++){
      const tr=document.createElement("tr"); tr.className="player-row"; tr.dataset.player=String(p);

      const nameTd=document.createElement("td");
      const nameInput=document.createElement("input"); nameInput.type="text"; nameInput.className="name-edit"; nameInput.placeholder=`Player ${p+1}`;
      nameInput.addEventListener("input",()=>{ vegas_renderTeamControls(); saveDebounced(); });
      nameTd.appendChild(nameInput); tr.appendChild(nameTd);

      const chTd=document.createElement("td");
      const chInput=document.createElement("input"); chInput.type="number"; chInput.className="ch-input"; chInput.placeholder="0"; chInput.min="-20"; chInput.max="54"; chInput.step="1";
  chInput.addEventListener("input",()=>{ if(chInput.value!=="") chInput.value=clampInt(chInput.value,-50,60); recalcAll(); AppManager.recalcGames(); saveDebounced(); });
      chTd.appendChild(chInput); tr.appendChild(chTd);

      for(let h=1;h<=HOLES;h++){
        const td=document.createElement("td"), inp=document.createElement("input");
        inp.type="number"; inp.inputMode="numeric"; inp.min="1"; inp.max="20"; inp.className="score-input"; inp.dataset.player=String(p); inp.dataset.hole=String(h); inp.placeholder="—";
        inp.addEventListener("input",()=>{ if(inp.value!==""){const v=clampInt(inp.value,1,20); if(String(v)!==inp.value) inp.classList.add("invalid"); else inp.classList.remove("invalid"); inp.value=v;} else {inp.classList.remove("invalid");}
          recalcRow(tr); recalcTotalsRow(); AppManager.recalcGames(); saveDebounced(); });
        td.appendChild(inp); tr.appendChild(td);
      }

      const outTd=document.createElement("td"); outTd.className="split";
      const inTd=document.createElement("td"); inTd.className="split";
      const totalTd=document.createElement("td"); totalTd.className="total";
      const toParTd=document.createElement("td"); toParTd.className="to-par";
      const netTd=document.createElement("td"); netTd.className="net";
      tr.append(outTd,inTd,totalTd,toParTd,netTd);

      tbody.appendChild(tr);
    }
  }

  // ---------- Totals row ----------
  function buildTotalsRow(){
    const totalsRow=$(ids.totalsRow);
    for(let h=1;h<=HOLES;h++){
      const td=document.createElement("td"); td.className="subtle"; td.dataset.holeTotal=String(h); td.textContent="—"; totalsRow.appendChild(td);
    }
    const out=document.createElement("td"), inn=document.createElement("td"), total=document.createElement("td"), blank1=document.createElement("td"), blank2=document.createElement("td");
    out.className="subtle"; inn.className="subtle"; total.className="subtle"; totalsRow.append(out,inn,total,blank1,blank2);
  }

  // ========== Handicap & Scoring Logic ==========
  /**
   * Calculate adjusted handicaps using "play off low" system.
   * @returns {number[]} Array of adjusted handicaps (lowest player gets 0)
   */
  function adjustedCHs(){
    const chs=$$(".player-row").map(r=>{ const v=Number($(".ch-input",r)?.value); return Number.isFinite(v)?v:0; });
    const minCH=Math.min(...chs);
    return chs.map(ch=>ch-minCH); // play off low
  }

  /**
   * Calculate strokes received on a specific hole.
   * @param {number} adjCH - Adjusted course handicap
   * @param {number} holeIdx - Zero-based hole index
   * @returns {number} Number of strokes on this hole
   */
  function strokesOnHole(adjCH, holeIdx){
    if(adjCH<=0) return 0;
    const base=Math.floor(adjCH/18), rem=adjCH%18, holeHcp=HCPMEN[holeIdx];
    return base+(holeHcp<=rem?1:0);
  }

  /**
   * Get gross score for a player on a hole.
   * @param {number} playerIdx - Zero-based player index
   * @param {number} holeIdx - Zero-based hole index
   * @returns {number} Gross score or 0 if not entered
   */
  function getGross(playerIdx, holeIdx){
    return Number($(`input.score-input[data-player="${playerIdx}"][data-hole="${holeIdx+1}"]`)?.value)||0;
  }

  /**
   * Calculate net score with Net Double Bogey (NDB) cap applied.
   * @param {number} playerIdx - Zero-based player index
   * @param {number} holeIdx - Zero-based hole index
   * @returns {number} Net score with NDB cap
   */
  function getNetNDB(playerIdx, holeIdx){
    const adjCH=adjustedCHs()[playerIdx], gross=getGross(playerIdx,holeIdx);
    if(!gross) return 0;
    const sr=strokesOnHole(adjCH,holeIdx), ndb=PARS[holeIdx]+NDB_BUFFER+sr, adjGross=Math.min(gross,ndb);
    return adjGross - sr;
  }

  // ---------- Row calc ----------
  function getPlayerHoleValues(rowEl){ return $$("input.score-input",rowEl).map(i=>Number(i.value)||0); }

  function recalcRow(rowEl){
    const s=getPlayerHoleValues(rowEl), out=sum(s.slice(0,9)), inn=sum(s.slice(9,18)), total=out+inn;
    $(".split:nth-of-type(1)",rowEl)?.replaceChildren(document.createTextNode(out||"—"));
    $(".split:nth-of-type(2)",rowEl)?.replaceChildren(document.createTextNode(inn||"—"));
    $(".total",rowEl)?.replaceChildren(document.createTextNode(total||"—"));

    const parTotal=sum(PARS), delta=total&&parTotal? total-parTotal : 0, el=$(".to-par",rowEl);
    if(!total){ el.textContent="—"; el.dataset.sign=""; } else { const sign=delta===0?"0":delta>0?"+":"-"; el.dataset.sign=sign; el.textContent=(delta>0?"+":"")+delta; }

    // Net total
    const pIdx=Number(rowEl.dataset.player);
    let netTotal=0;
    for(let h=0;h<HOLES;h++){
      const gross=s[h]||0; if(!gross) continue;
      const sr=strokesOnHole(adjustedCHs()[pIdx],h), ndb=PARS[h]+2+sr, adjGross=Math.min(gross,ndb);
      netTotal += adjGross - sr;
    }
    $(".net",rowEl).textContent=netTotal?String(netTotal):"—";
  }

  function recalcTotalsRow(){
    for(let h=1;h<=HOLES;h++){
      const ph=$$(`input.score-input[data-hole="${h}"]`).map(i=>Number(i.value)||0), t=sum(ph);
      $(`[data-hole-total="${h}"]`).textContent = t? String(t) : "—";
    }
    const tds=$(ids.totalsRow).querySelectorAll("td"), base=LEADING_FIXED_COLS+HOLES;
    const OUT=$$(".player-row").map(r=>Number($(".split:nth-of-type(1)",r)?.textContent)||0).reduce((a,b)=>a+b,0);
    const INN=$$(".player-row").map(r=>Number($(".split:nth-of-type(2)",r)?.textContent)||0).reduce((a,b)=>a+b,0);
    const TOT=$$(".player-row").map(r=>Number($(".total",r)?.textContent)||0).reduce((a,b)=>a+b,0);
    tds[base+0].textContent=OUT||"—"; tds[base+1].textContent=INN||"—"; tds[base+2].textContent=TOT||"—";
  }
  function recalcAll(){ $$(".player-row").forEach(recalcRow); recalcTotalsRow(); }

  // ---------- Persistence ----------
  const STORAGE_KEY="golf_scorecard_v5";
  function saveState(){
    const state={
      courseName:$(ids.courseName)?.value||"", teeName:$(ids.teeName)?.value||"",
      players:$$(".player-row").map(row=>({ name:$(".name-edit",row).value||"", ch:$(".ch-input",row).value||"", scores:$$("input.score-input",row).map(i=>i.value) })),
      vegas:{ teams:vegas_getTeamAssignments(), opts:vegas_getOptions(), open: $(ids.vegasSection).classList.contains("open") },
      banker:{ opts:banker_getOptions(), open: $(ids.bankerSection).classList.contains("open") },
      skins:{ buyIn: Number(document.getElementById('skinsBuyIn')?.value) || 10, open: $(ids.skinsSection)?.classList.contains("open") },
      savedAt:Date.now(),
    };
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); announce("Saved.");
  }
  let saveTimer=null; function saveDebounced(){ clearTimeout(saveTimer); saveTimer=setTimeout(saveState,300); }
  function loadState(){
    const raw=localStorage.getItem(STORAGE_KEY); if(!raw) return;
    try{
      const s=JSON.parse(raw);
      $(ids.courseName).value=s.courseName||""; $(ids.teeName).value=s.teeName||"";
      const rows=$$(".player-row");
      s.players?.forEach((p,i)=>{ const r=rows[i]; if(!r) return; $(".name-edit",r).value=p.name||""; $(".ch-input",r).value=p.ch??""; const ins=$$("input.score-input",r); p.scores?.forEach((v,j)=>{ if(ins[j]) ins[j].value=v; }); });
      recalcAll();

      vegas_renderTeamControls();
      if(s.vegas?.teams) vegas_setTeamAssignments(s.vegas.teams);
      if(s.vegas?.opts)  vegas_setOptions(s.vegas.opts);
      if(s.vegas?.open)  games_open("vegas");

      banker_renderTable();

      if(s.banker?.open) games_open("banker");

      if(s.skins?.buyIn != null) {
        const buyInEl = document.getElementById('skinsBuyIn');
        if(buyInEl) buyInEl.value = s.skins.buyIn;
      }
      if(s.skins?.open) games_open("skins");

      vegas_recalc(); banker_recalc();
      announce(`Restored saved card (${new Date(s.savedAt||Date.now()).toLocaleString()}).`);
    }catch{}
  }

  function clearScoresOnly(){ $$("input.score-input").forEach(i=>{i.value="";i.classList.remove("invalid");}); recalcAll(); AppManager.recalcGames(); announce("Scores cleared."); }
  function clearAll(){
    $(ids.courseName).value=""; $(ids.teeName).value="";
    $$(".player-row").forEach(r=>{ $(".name-edit",r).value=""; $(".ch-input",r).value=""; $$("input.score-input",r).forEach(i=>{i.value="";i.classList.remove("invalid");}); });
    recalcAll(); vegas_renderTeamControls(); vegas_recalc(); banker_renderTable(); banker_recalc(); announce("All fields cleared.");
  }
  function announce(t){ const el=$(ids.saveStatus); el.textContent=t; el.style.opacity="1"; setTimeout(()=>{el.style.opacity="0.75";},1200); }

  // ======================================================================
  // =============================== GAMES UI ==============================
  // ======================================================================
  function games_open(which){
    if(which==="vegas"){ $(ids.vegasSection).classList.add("open"); $(ids.vegasSection).setAttribute("aria-hidden","false"); $(ids.toggleVegas).classList.add("active"); }
    if(which==="banker"){ $(ids.bankerSection).classList.add("open"); $(ids.bankerSection).setAttribute("aria-hidden","false"); $(ids.toggleBanker).classList.add("active"); }
    if(which==="skins"){ $(ids.skinsSection).classList.add("open"); $(ids.skinsSection).setAttribute("aria-hidden","false"); $(ids.toggleSkins).classList.add("active"); }
  }
  function games_close(which){
    if(which==="vegas"){ $(ids.vegasSection).classList.remove("open"); $(ids.vegasSection).setAttribute("aria-hidden","true"); $(ids.toggleVegas).classList.remove("active"); }
    if(which==="banker"){ $(ids.bankerSection).classList.remove("open"); $(ids.bankerSection).setAttribute("aria-hidden","true"); $(ids.toggleBanker).classList.remove("active"); }
    if(which==="skins"){ $(ids.skinsSection).classList.remove("open"); $(ids.skinsSection).setAttribute("aria-hidden","true"); $(ids.toggleSkins).classList.remove("active"); }
  }
  function games_toggle(which){
    let sec;
    if(which==="vegas") sec = $(ids.vegasSection);
    else if(which==="banker") sec = $(ids.bankerSection);
    else if(which==="skins") sec = $(ids.skinsSection);
    const open = sec?.classList.contains("open");
    open? games_close(which) : games_open(which);
    saveDebounced();
  }

  // Theme toggle
(function(){
  const btn = document.getElementById('themeToggle');
  if(!btn) return;

  // Restore persisted theme
  const saved = localStorage.getItem('theme');
  if(saved === 'light'){
    document.documentElement.setAttribute('data-theme','light');
    btn.textContent = '🌙 Dark Mode';
  }

  btn.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if(isLight){
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('theme');
      btn.textContent = '☀️ Light Mode';
    }else{
      document.documentElement.setAttribute('data-theme','light');
      localStorage.setItem('theme','light');
      btn.textContent = '🌙 Dark Mode';
    }
  });
})();


  // ======================================================================
  // =============================== VEGAS ================================
  // ======================================================================
  // Lightweight module to separate Vegas compute from render
  const Vegas = {
    /**
     * Compute per-hole and total Vegas results.
     * @param {{A:number[], B:number[]}} teams
     * @param {{useNet:boolean, doubleBirdie:boolean, tripleEagle:boolean, pointValue:number}} opts
     * @returns {{perHole:object[], ptsA:number, totalA:number, totalB:number, dollarsA:number, dollarsB:number, valid:boolean}}
     */
    compute(teams, opts){
      if(!(teams.A.length===2 && teams.B.length===2)){
        return {perHole:[], ptsA:0, totalA:0, totalB:0, dollarsA:0, dollarsB:0, valid:false};
      }

      const perHole=[];
      let ptsA=0;

      for(let h=0;h<HOLES;h++){
        const pairA = this._teamPair(teams.A,h,opts.useNet);
        const pairB = this._teamPair(teams.B,h,opts.useNet);
        if(!pairA || !pairB){
          perHole.push({vaStr:'—', vbStr:'—', mult:'—', holePtsA:0});
          continue;
        }

        const aBE = this._teamHasBirdieOrEagle(teams.A,h,opts.useNet);
        const bBE = this._teamHasBirdieOrEagle(teams.B,h,opts.useNet);

        const effA = (bBE.birdie || bBE.eagle) ? [pairA[1],pairA[0]] : pairA;
        const effB = (aBE.birdie || aBE.eagle) ? [pairB[1],pairB[0]] : pairB;

        const vaStr=this._pairToString(effA), vbStr=this._pairToString(effB);
        const va=Number(vaStr), vb=Number(vbStr);

        let winner='A', diff=vb-va;
        if(diff<0){ winner='B'; diff=-diff; }
        const mult=this._multiplierForWinner(teams[winner],h,opts.useNet,opts);
        const holePtsA = winner==='A' ? diff*mult : -diff*mult;

        perHole.push({vaStr, vbStr, mult, holePtsA});
        ptsA += holePtsA;
      }

      const teamSum = team => { let s=0; for(let h=0;h<HOLES;h++){ team.forEach(p=>{ s+=getGross(p,h)||0; }); } return s; };
      const totalA=teamSum(teams.A), totalB=teamSum(teams.B);

      const per = Math.max(0, opts.pointValue || 0);
      const dollarsA = ptsA * per;
      const dollarsB = -dollarsA;

      return {perHole, ptsA, totalA, totalB, dollarsA, dollarsB, valid:true};
    },
    /**
     * Render Vegas results into the DOM.
     */
    render(data){
      const warn=$(ids.vegasTeamWarning);
      if(!data.valid){
        warn.hidden=false;
        for(let h=0;h<HOLES;h++){
          $(`[data-vegas-a="${h}"]`).textContent="—";
          $(`[data-vegas-b="${h}"]`).textContent="—";
          $(`[data-vegas-m="${h}"]`).textContent="—";
          $(`[data-vegas-p="${h}"]`).textContent="—";
        }
        $(ids.vegasTotalA).textContent="—"; $(ids.vegasTotalB).textContent="—"; $(ids.vegasPtsA).textContent="—";
        if($(ids.vegasDollarA)) $(ids.vegasDollarA).textContent = '—';
        if($(ids.vegasDollarB)) $(ids.vegasDollarB).textContent = '—';
        return;
      }
      warn.hidden=true;

      data.perHole.forEach((hole,h)=>{
        $(`[data-vegas-a="${h}"]`).textContent=hole.vaStr;
        $(`[data-vegas-b="${h}"]`).textContent=hole.vbStr;
        $(`[data-vegas-m="${h}"]`).textContent=(hole.mult==='—')?'—':String(hole.mult);
        const pts = hole.holePtsA;
        $(`[data-vegas-p="${h}"]`).textContent=pts? (pts>0?`+${pts}`:`${pts}`) : "—";
      });

      const ptsA = data.ptsA;
      $(ids.vegasPtsA).textContent = ptsA===0? "0" : (ptsA>0? `+${ptsA}`:`${ptsA}`);

      const fmt = v => {
        const abs = Math.abs(v);
        const s = `$${abs.toFixed(2)}`;
        if(v > 0) return `+${s}`;
        if(v < 0) return `-${s}`;
        return s;
      };
      if($(ids.vegasDollarA)) $(ids.vegasDollarA).textContent = fmt(data.dollarsA);
      if($(ids.vegasDollarB)) $(ids.vegasDollarB).textContent = fmt(data.dollarsB);

      $(ids.vegasTotalA).textContent=data.totalA||"—";
      $(ids.vegasTotalB).textContent=data.totalB||"—";
    },
    // Internal helpers
    _teamPair(players, holeIdx, useNet) {
      const vals = players.map(p => useNet ? getNetNDB(p, holeIdx) : getGross(p, holeIdx))
        .filter(v => Number.isFinite(v) && v > 0);
      if (vals.length < 2) return null;
      vals.sort((a,b)=>a-b);
      return [vals[0], vals[1]];
    },
    _pairToString(pair){ return `${pair[0]}${pair[1]}`; },
    _teamHasBirdieOrEagle(players,h,useNet){
      const best=Math.min(...players.map(p=>(useNet?getNetNDB(p,h):getGross(p,h))||Infinity));
      if(!Number.isFinite(best)) return {birdie:false,eagle:false};
      const toPar=best-PARS[h]; return {birdie:toPar<=-1, eagle:toPar<=-2};
    },
    _multiplierForWinner(winnerPlayers,h,useNet,opts){
      const {birdie,eagle}=this._teamHasBirdieOrEagle(winnerPlayers,h,useNet); let m=1;
      if(opts.tripleEagle && eagle) m=Math.max(m,3);
      if(opts.doubleBirdie && birdie) m=Math.max(m,2);
      return m;
    }
  };

  function vegas_renderTeamControls(){
    const box=$(ids.vegasTeams); box.innerHTML="";
    const names=$$(".player-row").map((r,i)=> $(".name-edit",r).value||`Player ${i+1}`);
    for(let i=0;i<PLAYERS;i++){
      const row=document.createElement("div"); row.style.display="contents";
      const label=document.createElement("div"); label.textContent=names[i];
      const aWrap=document.createElement("label"); aWrap.className="radio";
      const a=document.createElement("input"); a.type="radio"; a.name=`vegasTeam_${i}`; a.value="A"; a.addEventListener("change",()=>{vegas_recalc();saveDebounced();});
      aWrap.appendChild(a); aWrap.appendChild(document.createTextNode("Team A"));
      const bWrap=document.createElement("label"); bWrap.className="radio";
      const b=document.createElement("input"); b.type="radio"; b.name=`vegasTeam_${i}`; b.value="B"; b.addEventListener("change",()=>{vegas_recalc();saveDebounced();});
      bWrap.appendChild(b); bWrap.appendChild(document.createTextNode("Team B"));
      row.append(label,aWrap,bWrap); box.appendChild(row);
    }
    $(`input[name="vegasTeam_0"][value="A"]`).checked ||= true;
    $(`input[name="vegasTeam_1"][value="A"]`).checked ||= true;
    $(`input[name="vegasTeam_2"][value="B"]`).checked ||= true;
    $(`input[name="vegasTeam_3"][value="B"]`).checked ||= true;
  }
  function vegas_getTeamAssignments(){
    const teams={A:[],B:[]}; for(let i=0;i<PLAYERS;i++){ const a=$(`input[name="vegasTeam_${i}"][value="A"]`)?.checked; (a?teams.A:teams.B).push(i); } return teams;
  }
  function vegas_setTeamAssignments(t){
    for(let i=0;i<PLAYERS;i++){ const a=$(`input[name="vegasTeam_${i}"][value="A"]`), b=$(`input[name="vegasTeam_${i}"][value="B"]`); if(!a||!b) continue; a.checked=false; b.checked=false; }
    t.A?.forEach(i=>{ const r=$(`input[name="vegasTeam_${i}"][value="A"]`); if(r) r.checked=true; });
    t.B?.forEach(i=>{ const r=$(`input[name="vegasTeam_${i}"][value="B"]`); if(r) r.checked=true; });
  }
  function vegas_getOptions(){ return { useNet:$(ids.optUseNet)?.checked||false, doubleBirdie:$(ids.optDoubleBirdie)?.checked||false, tripleEagle:$(ids.optTripleEagle)?.checked||false, pointValue: Math.max(0, Number($(ids.vegasPointValue)?.value)||0) }; }
  function vegas_setOptions(o){ if('useNet'in o) $(ids.optUseNet).checked=!!o.useNet; if('doubleBirdie'in o) $(ids.optDoubleBirdie).checked=!!o.doubleBirdie; if('tripleEagle'in o) $(ids.optTripleEagle).checked=!!o.tripleEagle; if('pointValue' in o && $(ids.vegasPointValue)) $(ids.vegasPointValue).value = o.pointValue; }

  function vegas_recalc(){
    const teams=vegas_getTeamAssignments(), opts=vegas_getOptions();
    const data = Vegas.compute(teams, opts);
    Vegas.render(data);
    try{ window._vegasUpdateDollars?.(); }catch{}
  }

  // ======================================================================
  // =============================== BANKER ===============================
  // ======================================================================
  // Lightweight module to separate Banker compute from render
  const Banker = {
    /**
     * Compute per-hole and total Banker results.
     * @param {{pointValue:number, rotation:string, useNet:boolean, doubleBirdie:boolean, tripleEagle:boolean}} opts
     * @param {string[]} names - player names
     * @returns {{perHole:object[], totals:number[]}}
     */
    compute(opts, names){
      const perHole=[];
      const totals=[0,0,0,0];
      let banker = 0;

      for(let h=0;h<HOLES;h++){
        const deltas=[0,0,0,0];

        for(let p=0;p<PLAYERS;p++){
          if(p===banker) continue;
          const sb = this._score(banker,h,opts.useNet);
          const so = this._score(p,h,opts.useNet);
          if(!sb || !so){ deltas[p] = 0; continue; }
          if(sb===so){ deltas[p]=0; continue; }
          const winner = (so<sb) ? p : banker;
          const mult   = this._matchMultiplier(winner,h,opts);
          const value  = opts.pointValue * mult;
          if(winner===p){ deltas[p] += value; deltas[banker] -= value; }
          else { deltas[p] -= value; deltas[banker] += value; }
        }

        for(let p=0;p<PLAYERS;p++){
          totals[p] += deltas[p];
        }

        perHole.push({banker, bankerName:names[banker], deltas:[...deltas]});
        banker = this._nextBankerAfterHole(banker,h,opts);
      }

      return {perHole, totals};
    },
    /**
     * Render Banker results into the DOM.
     */
    render(data){
      for(let h=0;h<HOLES;h++){
        const hole = data.perHole[h];
        $(`[data-banker-name="${h}"]`).textContent = hole.bankerName;
        for(let p=0;p<PLAYERS;p++){
          const cell = $(`[data-banker-p="${h}-${p}"]`);
          const d = hole.deltas[p];
          cell.textContent = d===0 ? "—" : (d>0? `+${d}` : `${d}`);
        }
      }

      $(ids.bankerTotP1).textContent = data.totals[0]===0 ? "0" : (data.totals[0]>0?`+${data.totals[0]}`:`${data.totals[0]}`);
      $(ids.bankerTotP2).textContent = data.totals[1]===0 ? "0" : (data.totals[1]>0?`+${data.totals[1]}`:`${data.totals[1]}`);
      $(ids.bankerTotP3).textContent = data.totals[2]===0 ? "0" : (data.totals[2]>0?`+${data.totals[2]}`:`${data.totals[2]}`);
      $(ids.bankerTotP4).textContent = data.totals[3]===0 ? "0" : (data.totals[3]>0?`+${data.totals[3]}`:`${data.totals[3]}`);
    },
    // Internal helpers
    _score(playerIdx, holeIdx, useNet){
      return useNet ? getNetNDB(playerIdx,holeIdx) : getGross(playerIdx,holeIdx);
    },
    _matchMultiplier(winnerIdx, holeIdx, opts){
      const s = this._score(winnerIdx, holeIdx, opts.useNet);
      if(!s) return 1;
      const toPar = s - PARS[holeIdx];
      let m = 1;
      if(opts.tripleEagle && toPar <= -2) m = Math.max(m,3);
      if(opts.doubleBirdie && toPar <= -1) m = Math.max(m,2);
      return m;
    },
    _nextBankerAfterHole(currentBanker, holeIdx, opts){
      if(opts.rotation==="rotate") return (holeIdx+1) % PLAYERS;
      const b=currentBanker;
      let bestOpponent=null, bestScore=Infinity;
      for(let p=0;p<PLAYERS;p++){
        if(p===b) continue;
        const s=this._score(p,holeIdx,opts.useNet) || Infinity;
        if(s<bestScore){ bestScore=s; bestOpponent=p; }
      }
      const sb = this._score(b,holeIdx,opts.useNet) || Infinity;
      if(bestOpponent!==null && bestScore < sb) return bestOpponent;
      return b;
    }
  };

  function banker_renderTable(){
    const body=$(ids.bankerBody); body.innerHTML="";
    for(let h=0;h<HOLES;h++){
      const tr=document.createElement("tr");
      tr.innerHTML = `<td>${h+1}</td><td data-banker-name="${h}">—</td>
        <td data-banker-p="${h}-0">—</td><td data-banker-p="${h}-1">—</td>
        <td data-banker-p="${h}-2">—</td><td data-banker-p="${h}-3">—</td>`;
      body.appendChild(tr);
    }
  }
  function banker_getOptions(){
    return {
      pointValue: Math.max(1, Number($(ids.bankerPointValue).value)||1),
      rotation: $(ids.bankerRotation).value, // "rotate" | "untilBeaten"
      useNet: $(ids.bankerUseNet).checked,
      doubleBirdie: $(ids.bankerDoubleBirdie).checked,
      tripleEagle: $(ids.bankerTripleEagle).checked,
    };
  }
  function banker_setOptions(o){
    if('pointValue' in o) $(ids.bankerPointValue).value = o.pointValue;
    if('rotation' in o)   $(ids.bankerRotation).value   = o.rotation;
    if('useNet' in o)     $(ids.bankerUseNet).checked   = !!o.useNet;
    if('doubleBirdie' in o) $(ids.bankerDoubleBirdie).checked = !!o.doubleBirdie;
    if('tripleEagle' in o)  $(ids.bankerTripleEagle).checked  = !!o.tripleEagle;
  }

  function banker_recalc(){
    const names=$$(".player-row").map((r,i)=>$(".name-edit",r).value||`Player ${i+1}`);
    const opts=banker_getOptions();
    const data = Banker.compute(opts, names);
    Banker.render(data);
  }

  // ======================================================================
  // =============================== CSV I/O ==============================
  // ======================================================================
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field.trim()); field = ""; }
        else if (c === '\n' || c === '\r') {
          if (field.length || row.length) { row.push(field.trim()); rows.push(row); row = []; field = ""; }
          if (c === '\r' && text[i + 1] === '\n') i++;
        } else field += c;
      }
    }
    if (field.length || row.length) { row.push(field.trim()); rows.push(row); }
    return rows.filter(r => r.length && r.some(x => x !== ""));
  }
  function normalizeHeader(h) { return (h || "").toLowerCase().replace(/\s+/g, ""); }
  function rowToPlayerObj(headerMap, row) {
    const get = (name) => { const idx = headerMap[name]; if (idx == null) return undefined; return row[idx]; };
    const obj = { player: get("player") || "", ch: get("ch") != null && get("ch") !== "" ? Number(get("ch")) : "", holes: [] };
    for (let i = 1; i <= 18; i++) {
      const key = `h${i}`; const val = get(key);
      obj.holes.push(val != null && val !== "" ? Number(val) : "");
    }
    return obj;
  }
  async function handleCSVFile(file) {
    const text = await file.text();
    const data = parseCSV(text);
    if (!data.length) { alert("CSV appears empty."); return; }

    const header = data[0].map(normalizeHeader);
    const hmap = {}; header.forEach((h,i)=>{ hmap[h]=i; });

    const required = ["player","ch", ...Array.from({length:18},(_,i)=>`h${i+1}`)];
    const missing = required.filter(k => !(k in hmap));
    if (missing.length) { alert("CSV is missing columns: " + missing.join(", ")); return; }

    const rows = data.slice(1).filter(r => r.some(x => x && x !== "")).slice(0, 4);
    if (!rows.length) { alert("No data rows found under the header."); return; }

    const playerRows = document.querySelectorAll(".player-row");
    rows.forEach((r, idx) => {
      const obj = rowToPlayerObj(hmap, r);
      const rowEl = playerRows[idx]; if (!rowEl) return;
      const nameInput = rowEl.querySelector(".name-edit"); nameInput.value = obj.player || `Player ${idx+1}`;
      const chInput = rowEl.querySelector(".ch-input"); chInput.value = (obj.ch === 0 || Number.isFinite(obj.ch)) ? String(obj.ch) : "";
      const inputs = rowEl.querySelectorAll("input.score-input");
      for (let i = 0; i < 18; i++) { const v = obj.holes[i];
        inputs[i].value = (v === "" || isNaN(v)) ? "" : String(Math.max(1, Math.min(20, Math.trunc(v))));
        inputs[i].classList.remove("invalid");
      }
    });
    for (let i = rows.length; i < 4; i++) {
      const rowEl = playerRows[i]; if (!rowEl) continue;
      rowEl.querySelector(".name-edit").value = "";
      rowEl.querySelector(".ch-input").value = "";
      rowEl.querySelectorAll("input.score-input").forEach(inp => { inp.value = ""; inp.classList.remove("invalid"); });
    }

    recalcAll(); vegas_recalc(); banker_recalc(); saveState();
    announce("CSV imported.");
  }
  function downloadCSVTemplate() {
    const headers = ["player","ch", ...Array.from({length:18},(_,i)=>`h${i+1}`)];
    const rows = [
      ["Daniel",-1,4,3,4,3,2,4,4,2,4, 4,3,2,5,4,4,3,2,4],
      ["Rob",2,   5,4,5,4,3,5,4,3,5, 5,4,3,5,6,5,4,3,5],
      ["John",4,  4,5,6,5,4,6,5,4,5, 4,5,4,6,7,5,5,4,5],
      ["Alex",7,  3,4,4,5,3,5,4,3,4, 3,4,3,4,5,4,4,3,4],
    ];
    let csv = headers.join(",") + "\n" + rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "scorecard_template.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }

  // ======================================================================
  // ============================= INIT / WIRING ==========================
  // ======================================================================
  function init(){
    console.log('[golfGames] init start');
    buildHeader(); buildParAndHcpRows(); buildPlayerRows(); buildTotalsRow();

  $(ids.resetBtn).addEventListener("click", () => { console.log('[golfGames] Reset clicked'); clearScoresOnly(); });
  $(ids.clearAllBtn).addEventListener("click", () => { console.log('[golfGames] Clear all clicked'); clearAll(); });
  $(ids.saveBtn).addEventListener("click", () => { console.log('[golfGames] Save clicked'); saveState(); });
      $(ids.printBtn).addEventListener("click", () => { 
      console.log('[golfGames] Print button clicked'); 
        if(window.printScorecard) { 
        console.log('[golfGames] Calling printScorecard');
          window.printScorecard(); 
        } else {
        console.error('[golfGames] printScorecard function not found');
        }
      });
    $(ids.courseName).addEventListener("input", saveDebounced);
    $(ids.teeName).addEventListener("input", saveDebounced);

    // Games: open/close
    $(ids.toggleVegas).addEventListener("click", ()=>games_toggle("vegas"));
    $(ids.toggleBanker).addEventListener("click", ()=>games_toggle("banker"));

    // Vegas UI + wiring
    vegas_renderTeamControls();
    vegas_renderTable();
  $(ids.optUseNet).addEventListener("change", ()=>{ AppManager.recalcGames(); saveDebounced(); });
  $(ids.optDoubleBirdie).addEventListener("change", ()=>{ AppManager.recalcGames(); saveDebounced(); });
  $(ids.optTripleEagle).addEventListener("change", ()=>{ AppManager.recalcGames(); saveDebounced(); });
  $(ids.vegasPointValue)?.addEventListener("input", ()=>{ AppManager.recalcGames(); saveDebounced(); });

    // Banker UI + wiring
    banker_renderTable();
    $(ids.bankerPointValue).addEventListener("input", ()=>{ banker_recalc(); saveDebounced(); });
    $(ids.bankerRotation).addEventListener("change", ()=>{ banker_recalc(); saveDebounced(); });
    $(ids.bankerUseNet).addEventListener("change", ()=>{ banker_recalc(); saveDebounced(); });
    $(ids.bankerDoubleBirdie).addEventListener("change", ()=>{ banker_recalc(); saveDebounced(); });
    $(ids.bankerTripleEagle).addEventListener("change", ()=>{ banker_recalc(); saveDebounced(); });

    // CSV upload & template
    const csvInput = $(ids.csvInput);
    if (csvInput) csvInput.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleCSVFile(f);
      e.target.value = ""; // allow re-upload same file
    });
    $(ids.dlTemplateBtn).addEventListener("click", downloadCSVTemplate);

    recalcAll(); vegas_recalc(); banker_recalc(); loadState();
  }

  function vegas_renderTable(){ const body=$(ids.vegasTableBody); body.innerHTML=""; for(let h=0;h<HOLES;h++){ const tr=document.createElement("tr"); tr.innerHTML=`<td>${h+1}</td><td data-vegas-a="${h}">—</td><td data-vegas-b="${h}">—</td><td data-vegas-m="${h}">—</td><td data-vegas-p="${h}">—</td>`; body.appendChild(tr);} }

  document.addEventListener("DOMContentLoaded", init);


// ============================
// Skins game
// ============================
// Lightweight module to separate compute from render for maintainability.
const Skins = {
  /**
   * Compute skins outcome for all holes and players.
   * @param {{carry:boolean, half:boolean, buyIn:number}} opts
   * @returns {{totals:number[], holesWon:string[][], winnings:number[], pot:number, totalSkins:number, activePlayers:number}}
   */
  compute(opts){
    const { carry, half, buyIn } = opts;
    const totals=[0,0,0,0];
    const holesWon=[[],[],[],[]];
    let pot=1;

    for(let h=0; h<HOLES; h++){
      const nets = [0,1,2,3].map(p=>getNetForSkins(p,h,half));
      const filled = nets.map((n,p)=>({n,p})).filter(x=>x.n>0);
      if(filled.length<2){ if(carry) pot++; continue; }
      const min = Math.min(...filled.map(x=>x.n));
      const winners = filled.filter(x=>x.n===min).map(x=>x.p);
      if(winners.length!==1){ if(carry) pot++; continue; }
      const w = winners[0];
      totals[w] += pot;
      holesWon[w].push(String(h+1));
      pot = 1;
    }

    // Count active players (those with at least one score)
    const activePlayers = [0,1,2,3].filter(p => {
      for(let h=0; h<HOLES; h++){
        if(getGross(p,h) > 0) return true;
      }
      return false;
    }).length;

    // Calculate dollar winnings
    const totalSkins = totals.reduce((sum, t) => sum + t, 0);
    const moneyPot = buyIn * activePlayers;
    const winnings = totals.map(skinCount => {
      if(totalSkins === 0) return 0;
      return (skinCount / totalSkins) * moneyPot;
    });

    return { totals, holesWon, winnings, pot: moneyPot, totalSkins, activePlayers };
  },
  /**
   * Render computed skins results into the DOM.
   * @param {{totals:number[], holesWon:string[][], winnings:number[]}} data
   */
  render(data){
    const { totals, holesWon, winnings } = data;
    for(let p=0;p<4;p++){
      const holesCell = document.getElementById('skinsHoles'+p);
      const totCell   = document.getElementById('skinsTotal'+p);
      const winCell   = document.getElementById('skinsWinnings'+p);
      if(holesCell) holesCell.textContent = (holesWon[p]||[]).join(', ');
      if(totCell)   totCell.textContent = String(totals[p]||0);
      if(winCell) {
        const amount = winnings[p] || 0;
        winCell.textContent = amount > 0 ? `$${amount.toFixed(2)}` : '—';
      }
    }
  }
};
function strokesOnHoleHalfAware(adjCH, i, half){
  if(adjCH<=0) return 0;
  const holeHcp=HCPMEN[i];
  
  if(half){
    // Half pops: player gets strokes on half as many holes
    // e.g., 4 handicap gets strokes on HCP 1-2 only (not 1-4)
    const halfStrokes = Math.floor(adjCH / 2);
    const base=Math.floor(halfStrokes/18), rem=halfStrokes%18;
    return base+(holeHcp<=rem?1:0);
  } else {
    // Full strokes: standard allocation across all 18 holes
    const base=Math.floor(adjCH/18), rem=adjCH%18;
    return base+(holeHcp<=rem?1:0);
  }
}
/**
 * Calculate net score for Skins game with optional half-pops.
 * @param {number} playerIdx - Zero-based player index
 * @param {number} holeIdx - Zero-based hole index
 * @param {boolean} half - Whether half-pops mode is enabled
 * @returns {number} Net score with NDB cap
 */
function getNetForSkins(playerIdx, holeIdx, half){
  const adjCHsArr = adjustedCHs();
  const gross = getGross(playerIdx, holeIdx);
  if(!gross) return 0;
  const adj = adjCHsArr[playerIdx];
  const sr = strokesOnHoleHalfAware(adj, holeIdx, half);
  const ndb = PARS[holeIdx] + NDB_BUFFER + sr;
  const adjGross = Math.min(gross, ndb);
  return adjGross - sr;
}


function buildSkinsTable(){
  const body = document.getElementById('skinsBody');
  if(!body) return;
  if(body.dataset.simple === '1') return;
  // Build summary-only table: Name | Holes Skinned | Total | Winnings
  body.innerHTML = '';
  for(let p=0; p<4; p++){
    const tr = document.createElement('tr');
    const th = document.createElement('th'); th.id = 'skinsName'+p; th.textContent = 'P'+(p+1);
    const tdH = document.createElement('td'); tdH.id = 'skinsHoles'+p;
    const tdT = document.createElement('td'); tdT.id = 'skinsTotal'+p; tdT.textContent='0';
    const tdW = document.createElement('td'); tdW.id = 'skinsWinnings'+p; tdW.textContent='—';
    tr.append(th, tdH, tdT, tdW);
    body.appendChild(tr);
  }
  body.dataset.simple = '1';
}
function refreshSkinsHeaderNames(){
  const names = Array.from(document.querySelectorAll('.player-row .name-edit'))
    .map((i,idx)=> i.value.trim()||i.placeholder||i.dataset.default||`P${idx+1}`);
  names.forEach((n,idx)=>{ const el=document.getElementById('skinsName'+idx); if(el) el.textContent=n; });
}
function updateSkins(){
  const carry = document.getElementById('skinsCarry')?.checked ?? true;
  const half  = document.getElementById('skinsHalf')?.checked ?? false;
  const buyIn = Math.max(0, Number(document.getElementById('skinsBuyIn')?.value) || 0);
  const data = Skins.compute({carry, half, buyIn});
  Skins.render(data);
}
function initSkins(){
  buildSkinsTable();
  refreshSkinsHeaderNames();
  updateSkins();

  // Recompute on option change
  document.getElementById('skinsCarry')?.addEventListener('change', updateSkins);
  document.getElementById('skinsHalf')?.addEventListener('change', updateSkins);
  document.getElementById('skinsBuyIn')?.addEventListener('input', ()=>{ updateSkins(); saveDebounced(); });

  // Recompute on any score/par/ch input
  document.addEventListener('input', (e)=>{
  const t=e.target; if(!(t instanceof HTMLElement)) return;
  if(t.classList?.contains('score-input') || t.classList?.contains('ch-input') || t.closest('#scorecard')){
    updateSkins();
  }
  if(t.classList?.contains('name-edit')){ refreshSkinsHeaderNames(); }
}, {passive:true});
}

// Open/close: when Skins tab is toggled, ensure table exists and render now
document.getElementById('toggleSkins')?.addEventListener('click', ()=> { const sec = document.getElementById('skinsSection'); const open = !sec.classList.contains('open'); sec.classList.toggle('open', open); sec.setAttribute('aria-hidden', open ? 'false' : 'true'); document.getElementById('toggleSkins')?.classList.toggle('active', open); if(open){
  setTimeout(()=>{ initSkins(); }, 0);}
});

document.addEventListener('DOMContentLoaded', ()=>{
  // Initialize if section already visible (e.g., state restored)
  if(document.getElementById('skinsSection')?.classList.contains('open')){
    initSkins();
  }
});

})();


// -----------------------------
// JUNK (Dots) — Setup & Logic
// -----------------------------
(function(){
  const HOLES = 18; // adjust if you support 9/27/etc.

  // --- Helpers to read from the existing scorecard ---
  function getPar(hole){
    let el = document.querySelector(`#parRow input[data-hole="${hole}"]`);
    if(!el){
      const inputs = document.querySelectorAll('#parRow input');
      el = inputs[hole-1];
    }
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : NaN;
  }

  function getScore(playerIdx, hole){
    let sel = `.score-input[data-player="${playerIdx}"][data-hole="${hole}"]`;
    let el = document.querySelector(sel);
    if(!el){
      const row = document.querySelector(`tr[data-player="${playerIdx}"]`) || document.querySelectorAll('tbody tr')[2 + playerIdx];
      if(row){
        const inputs = row.querySelectorAll('.score-input');
        el = inputs[hole-1];
      }
    }
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : NaN;
  }

  function getPlayerNames(){
    const nameInputs = Array.from(document.querySelectorAll('.name-edit'));
    return [0,1,2,3].map((i)=>{
      const v = nameInputs[i]?.value?.trim();
      return v || `Player ${i+1}`;
    });
  }

  function dotsFor(score, par){
    if(!Number.isFinite(score) || !Number.isFinite(par)) return 0;
    const diff = score - par;
    if(diff <= -2) return 4; // eagle or better
    if(diff === -1) return 2; // birdie
    if(diff === 0)  return 1; // par
    return 0; // bogey or worse
  }

  // Lightweight module to separate compute from render for Junk (Dots)
  const Junk = {
    /**
     * Compute base dots per hole and totals for 4 players.
     * @returns {{perHole:number[][], totals:number[]}}
     */
    compute(){
      const perHole = Array.from({length: HOLES}, ()=> Array(4).fill(0));
      const totals = [0,0,0,0];
      for(let h=1; h<=HOLES; h++){
        const par = getPar(h);
        for(let p=0; p<4; p++){
          const score = getScore(p, h);
          const d = dotsFor(score, par);
          perHole[h-1][p] = Number.isFinite(d) ? d : 0;
          totals[p] += Number.isFinite(d) ? d : 0;
        }
      }
      return { perHole, totals };
    },
    /**
     * Render per-hole dots and totals into the DOM.
     * Note: Achievements enhancement (weighted dots) may overlay this view.
     * @param {{perHole:number[][], totals:number[]}} data
     */
    render(data){
      const { perHole, totals } = data;
      // Cells: if Achievements UI present, only update the inner .junk-dot to avoid destroying wrappers.
      for(let h=1; h<=HOLES; h++){
        for(let p=0; p<4; p++){
          const cell = document.getElementById(`junk_h${h}_p${p+1}`);
          if(!cell) continue;
          const dot = cell.querySelector('.junk-dot');
          const val = Number.isFinite(perHole[h-1][p]) ? perHole[h-1][p] : '—';
          if(dot){
            dot.textContent = String(val);
          }else{
            cell.textContent = String(val);
          }
        }
      }
      // Totals: if achievements are active, let that system own totals (base + bonuses), otherwise render base totals.
      const achActive = !!document.querySelector('details.junk-dd');
      if(!achActive){
        const ids = ['junkTotP1','junkTotP2','junkTotP3','junkTotP4'];
        ids.forEach((id, i)=>{
          const el = document.getElementById(id);
          if(el) el.textContent = Number.isFinite(totals[i]) ? totals[i] : '—';
        });
      }
    }
  };

  function buildJunkTable(){
    const tbody = document.getElementById('junkBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    for(let h=1; h<=HOLES; h++){
      const tr = document.createElement('tr');
      const th = document.createElement('td');
      th.textContent = h;
      tr.appendChild(th);
      for(let p=0; p<4; p++){
        const td = document.createElement('td');
        td.id = `junk_h${h}_p${p+1}`;
        td.textContent = '—';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function refreshJunkHeaderNames(){
    const [n1,n2,n3,n4] = getPlayerNames();
    const ids = ['junkP1','junkP2','junkP3','junkP4'];
    [n1,n2,n3,n4].forEach((n,i)=>{
      const el = document.getElementById(ids[i]);
      if(el) el.textContent = n;
    });
  }

  function updateJunk(){
    const tbody = document.getElementById('junkBody');
    if(!tbody) return;
    const data = Junk.compute();
    Junk.render(data);
  }

  function toggleGame(sectionId, toggleBtn){
    const sections = ['vegasSection','bankerSection','junkSection','skinsSection'];
    sections.forEach(id=>{
      const sec = document.getElementById(id);
      if(!sec) return;
      const open = (id === sectionId) ? !sec.classList.contains('open') : false;
      sec.classList.toggle('open', open);
      sec.setAttribute('aria-hidden', open ? 'false' : 'true');
    });
    const buttons = ['toggleVegas','toggleBanker','toggleJunk','toggleSkins'];
    buttons.forEach(bid=>{
      const b = document.getElementById(bid);
      b && b.classList.toggle('active', bid === toggleBtn && document.getElementById(sectionId)?.classList.contains('open'));
    });
  }

  function initJunk(){
    if(document.getElementById('junkBody')?.children.length) return;
    buildJunkTable();
    refreshJunkHeaderNames();
    updateJunk();

    document.addEventListener('input', (e)=>{
      const t = e.target;
      if(t.classList?.contains('score-input') || t.closest('#parRow') || t.classList?.contains('name-edit')){
        if(t.classList?.contains('name-edit')) refreshJunkHeaderNames();
        updateJunk();
      }
    }, { passive: true });
  }

  
  document.getElementById('toggleSkins')?.addEventListener('click', ()=>{
    initSkins();
    toggleGame('skinsSection','toggleSkins');
  });
document.getElementById('toggleJunk')?.addEventListener('click', ()=>{
    initJunk();
    toggleGame('junkSection','toggleJunk');
  });




})();


// =============================================
// JUNK Achievements Enhancement (Hogan/Sandy/Sadaam/Pulley + Triple)
// Weighted achievements support (+1, +2, +3, ...).
// =============================================
(function(){
  // Each achievement has an id, label, and point value.
  // You can change pts to 2 for any of these if needed.
  const ACH = [
    { id: "hogan",  label: "Hogan",  pts: 1 },
    { id: "sandy",  label: "Sandy",  pts: 1 },
    { id: "sadaam", label: "Sadaam", pts: 1 },
    { id: "pulley", label: "Pulley", pts: 1 },
    { id: "triple", label: "Triple", pts: 3 }, // NEW: 3-point dot
  ];

  // Try to detect number of players from Junk header
  function getPlayerCount(){
    const head = document.querySelector('#junkTable thead tr');
    if(!head) return 4;
    return Math.max(0, head.children.length - 1); // minus "Hole"
  }

  // Base dots logic
  function getPar(hole){
    let el = document.querySelector(`#parRow input[data-hole="${hole}"]`);
    if(!el){
      const inputs = document.querySelectorAll('#parRow input');
      el = inputs[hole-1];
    }
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : NaN;
  }
  
  function getScore(playerIdx, hole){
    let el = document.querySelector(`.score-input[data-player="${playerIdx}"][data-hole="${hole}"]`);
    if(!el){
      const row = document.querySelector(`tr[data-player="${playerIdx}"]`) || document.querySelectorAll('tbody tr')[2 + playerIdx];
      if(row){
        const inputs = row.querySelectorAll('.score-input');
        el = inputs[hole-1];
      }
    }
    const v = el ? parseInt(el.value, 10) : NaN;
    return Number.isFinite(v) ? v : NaN;
  }
  
  /** Calculate base dots for a score relative to par */
  function baseDots(score, par){
    if(!Number.isFinite(score) || !Number.isFinite(par)) return 0;
    const diff = score - par;
    if(diff <= -2) return 4; // Eagle or better
    if(diff === -1) return 2; // Birdie
    if(diff === 0)  return 1; // Par
    return 0; // Bogey or worse
  }

  // Enhance existing Junk cells: wrap number + add <details> menu with weighted items
  function enhanceJunkCells(){
    const tbody = document.querySelector('#junkBody');
    if(!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const players = getPlayerCount();
    rows.forEach((tr, holeIdx)=>{
      for(let p=0; p<players; p++){
        const td = tr.children[p+1]; // skip first col (hole)
        if(!td) continue;
        if(td.querySelector('.junk-cell')) continue; // already enhanced
        const currentText = (td.textContent || '').trim();
        td.textContent = '';

        const wrap = document.createElement('div');
        wrap.className = 'junk-cell';

        const dotSpan = document.createElement('span');
        dotSpan.className = 'junk-dot';
        dotSpan.dataset.player = String(p);
        dotSpan.dataset.hole = String(holeIdx+1);
        dotSpan.textContent = currentText || '—';

        const details = document.createElement('details');
        details.className = 'junk-dd';
        details.dataset.player = String(p);
        details.dataset.hole = String(holeIdx+1);

        const summary = document.createElement('summary');
        summary.textContent = 'Dots';

        const menu = document.createElement('div');
        menu.className = 'menu';

        // Build weighted options
        ACH.forEach(({id,label,pts})=>{
          const lab = document.createElement('label');
          const cb  = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'junk-ach';
          cb.dataset.player = String(p);
          cb.dataset.hole   = String(holeIdx+1);
          cb.dataset.key    = id;
          cb.dataset.pts    = String(pts); // <= weight used in totals
          // restore if previously stored on the TD
          cb.checked = td.dataset[id] === '1';
          cb.addEventListener('change', ()=>{
            td.dataset[id] = cb.checked ? '1' : '';
            updateJunkTotalsWeighted();
          });
          lab.appendChild(cb);
          lab.append(` ${label} (+${pts})`);
          menu.appendChild(lab);
        });

        details.appendChild(summary);
        details.appendChild(menu);
        wrap.appendChild(dotSpan);
        wrap.appendChild(details);
        td.appendChild(wrap);
      }
    });
  }

  // Sum weighted achievements for a player/hole
  function achPoints(p, h){
    const box = document.querySelector(`details.junk-dd[data-player="${p}"][data-hole="${h}"]`);
    if(!box) return 0;
    let total = 0;
    box.querySelectorAll('input.junk-ach:checked').forEach(cb=>{
      const w = Number(cb.dataset.pts) || 1;
      total += w;
    });
    return total;
  }

  function updateJunkTotalsWeighted(){
    const tbody = document.querySelector('#junkBody');
    const players = getPlayerCount();
    if(!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const totals = Array(players).fill(0);
    rows.forEach((tr, holeIdx)=>{
      const h = holeIdx+1;
      const par = getPar(h);
      for(let p=0; p<players; p++){
        const score = getScore(p, h);
        const base  = baseDots(score, par);
        const bonus = achPoints(p, h); // weighted (+1/+2/+3)
        const total = base + bonus;
        totals[p] += total;
        const span = tr.querySelector(`.junk-dot[data-player="${p}"][data-hole="${h}"]`);
        if(span) span.textContent = Number.isFinite(total) ? String(total) : '—';
      }
    });
    const footIds = ['junkTotP1','junkTotP2','junkTotP3','junkTotP4'];
    footIds.forEach((id, i)=>{
      const el = document.getElementById(id);
      if(el) el.textContent = (i<totals.length) ? totals[i] : '—';
    });

    // Calculate net totals (each player's position relative to average)
    const totalDots = totals.reduce((sum, t) => sum + t, 0);
    const avgDots = totalDots / players;
    const netIds = ['junkNetP1','junkNetP2','junkNetP3','junkNetP4'];
    netIds.forEach((id, i)=>{
      const el = document.getElementById(id);
      if(!el || i >= totals.length) return;
      const netPos = totals[i] - avgDots;
      if(netPos === 0) {
        el.textContent = '0';
      } else if(netPos > 0) {
        el.textContent = `+${netPos.toFixed(1)}`;
      } else {
        el.textContent = netPos.toFixed(1);
      }
    });
  }

  function initJunkAchievements(){
    const junkTable = document.getElementById('junkTable');
    if(!junkTable) return;
    enhanceJunkCells();
    updateJunkTotalsWeighted();

    // Update totals on any score/par/name or achievement toggle
    document.addEventListener('input', (e)=>{
      const t = e.target;
      if(t.classList?.contains('score-input') || t.closest('#parRow') || t.classList?.contains('name-edit') || t.classList?.contains('junk-ach')){
        updateJunkTotalsWeighted();
      }
    }, { passive: true });

    document.addEventListener('change', (e)=>{
      const t = e.target;
      if(t.classList?.contains('junk-ach')){
        updateJunkTotalsWeighted();
      }
    });
  }

  // Initialize when Junk tab opens (and once at load)
  document.getElementById('toggleJunk')?.addEventListener('click', ()=> {
    setTimeout(initJunkAchievements, 0);
  });
  document.addEventListener('DOMContentLoaded', initJunkAchievements);
})();


// ============================
// Vegas B Total & UI Tweaks
// ============================
(function(){
  function findVegasATotalEl(){
    const cands = ['vegasPtsA','vegasTotalA','vegasSumA'];
    for(const id of cands){
      const el = document.getElementById(id);
      if(el) return el;
    }
    // fallback: try a data-id
    const el = document.querySelector('#vegasSection [data-role="vegas-total-a"]');
    return el || null;
  }
  function vegasUpdateDollars(){
    const ptsEl = document.getElementById('vegasPtsA');
    const perEl = document.getElementById('vegasPointValue');
    const aEl = document.getElementById('vegasDollarA');
    const bEl = document.getElementById('vegasDollarB');
    if(!ptsEl || !perEl || !aEl || !bEl) return;
    const pts = parseSignedInt(ptsEl.textContent);
    let per = Number.parseFloat((perEl.value||'').trim());
    if(!Number.isFinite(per) || per < 0) per = 0;
    if(pts===null){ aEl.textContent='—'; bEl.textContent='—'; return; }
    const dollarsA = pts * per;
    const dollarsB = -dollarsA;
    const fmt = v => {
      const abs = Math.abs(v);
      const s = `$${abs.toFixed(2)}`;
      if(v>0) return `+${s}`; if(v<0) return `-${s}`; return s;
    };
    aEl.textContent = fmt(dollarsA);
    bEl.textContent = fmt(dollarsB);
  }
  // expose for recalc callers
  try{ window._vegasUpdateDollars = vegasUpdateDollars; }catch{}
  function ensureVegasBTotalsUI(){
    const sec = document.getElementById('vegasSection');
    if(!sec) return null;
    // look for an existing B total slot
    let b = sec.querySelector('#vegasPtsB, [data-role="vegas-total-b"]');
    if(b) return b;
    // Try to append near A total
    const a = findVegasATotalEl();
    if(a && a.parentElement){
      b = document.createElement('span');
      b.id = 'vegasPtsB';
      b.style.marginLeft = '12px';
      b.title = "Team B total (mirror of A)";
      a.insertAdjacentElement('afterend', b);
      return b;
    }
    return null;
  }
  function parseSignedInt(txt){
    if(!txt) return null;
    const m = String(txt).match(/[-+]?\d+/);
    return m ? parseInt(m[0], 10) : null;
  }
  function mirrorVegasTotals(){
    const a = findVegasATotalEl();
    const b = ensureVegasBTotalsUI();
    if(!a || !b) return;
    const aVal = parseSignedInt(a.textContent);
    if(aVal===null) { b.textContent = ''; return; }
    // Team B is the opposite
    const bVal = -aVal;
    b.textContent = (bVal>0? `+${bVal}` : String(bVal));
  }

  // Observe changes to A total and mirror to B automatically
  function observeA(){
    const a = findVegasATotalEl();
    if(!a) return;
    const mo = new MutationObserver(mirrorVegasTotals);
    mo.observe(a, { childList: true, characterData: true, subtree: true });
    mirrorVegasTotals();
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    observeA();
    // Update dollars when points or $/point change
    const pts = document.getElementById('vegasPtsA');
    if(pts){ const mo2 = new MutationObserver(vegasUpdateDollars); mo2.observe(pts, {childList:true, characterData:true, subtree:true}); }
    document.getElementById('vegasPointValue')?.addEventListener('input', vegasUpdateDollars);
    vegasUpdateDollars();
    // also try when Vegas tab is opened
    document.getElementById('toggleVegas')?.addEventListener('click', ()=> {
      setTimeout(()=>{ observeA(); vegasUpdateDollars(); }, 0);
    });
  });
})();

// ============================
// Junk: ensure dropdown stays large enough on touch
// (CSS handled in <style>, logic already present.)
// ============================

// ============================
// PRINT SCORECARD FUNCTIONALITY
// ============================
// Print function - will be called from the button click handler above
function printScorecard() {
  console.log('printScorecard function called');
  // Gather all data
  const courseName = document.getElementById('courseName')?.value || 'Golf Course';
  const teeName = document.getElementById('teeName')?.value || '';
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  
  // Get player data
  const players = Array.from(document.querySelectorAll('.player-row')).map(row => ({
    name: row.querySelector('.name-edit')?.value || 'Player',
    ch: row.querySelector('.ch-input')?.value || '0',
    scores: Array.from(row.querySelectorAll('input.score-input')).map(i => i.value || '—'),
  }));

  // Get pars
  const pars = Array.from(document.querySelectorAll('#parRow input[type="number"]')).map(i => i.value);
  
  // Calculate player totals
  const playerTotals = players.map(p => {
    const scores = p.scores.map(s => Number(s) || 0);
    const out = scores.slice(0, 9).reduce((a, b) => a + b, 0);
    const inn = scores.slice(9, 18).reduce((a, b) => a + b, 0);
    const total = out + inn;
    const parTotal = pars.reduce((a, b) => Number(a) + Number(b), 0);
    const toPar = total && parTotal ? total - parTotal : 0;
    const net = document.querySelector(`.player-row[data-player="${players.indexOf(p)}"] .net`)?.textContent || '—';
    return { ...p, out, inn, total, toPar, net };
  });

  // Build HTML for print
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Golf Scorecard</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; color: #000; background: #fff; padding: 20px; }
        .container { max-width: 900px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #000; padding-bottom: 15px; }
        .header h1 { font-size: 24px; margin: 0; }
        .header p { font-size: 12px; color: #555; margin: 5px 0 0 0; }
        .scorecard { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 11px; }
        .scorecard th { background: #eee; border: 1px solid #999; padding: 6px; font-weight: bold; text-align: center; }
        .scorecard td { border: 1px solid #ccc; padding: 6px; text-align: center; }
        .scorecard td:first-child { text-align: left; font-weight: 500; }
        .scorecard tfoot td { background: #f5f5f5; font-weight: bold; border-top: 2px solid #999; }
        .games { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 30px; }
        .game-box { border: 1px solid #ccc; padding: 15px; background: #f9f9f9; page-break-inside: avoid; }
        .game-box h3 { font-size: 14px; margin: 0 0 10px 0; border-bottom: 1px solid #999; padding-bottom: 5px; }
        .game-table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 10px; }
        .game-table th, .game-table td { border: 1px solid #ccc; padding: 4px; text-align: left; }
        .game-table th { background: #eee; font-weight: bold; }
        .footer { text-align: center; font-size: 10px; color: #999; margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc; }
        @media print {
          body { padding: 0; }
          .container { max-width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Manito Golf Games Scorecard</h1>
          <p><strong>${courseName}</strong>${teeName ? ` • ${teeName}` : ''}</p>
          <p>${date} at ${time}</p>
        </div>

        <table class="scorecard">
          <thead>
            <tr>
              <th>Player</th>
              <th>CH</th>
              ${Array.from({ length: 18 }, (_, i) => `<th>${i + 1}</th>`).join('')}
              <th>Out</th>
              <th>In</th>
              <th>Total</th>
              <th>To Par</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Par</strong></td>
              <td>—</td>
              ${pars.map(p => `<td>${p}</td>`).join('')}
              <td colspan="4"></td>
            </tr>
            ${playerTotals.map(p => `
              <tr>
                <td><strong>${p.name}</strong></td>
                <td>${p.ch}</td>
                ${p.scores.map(s => `<td>${s}</td>`).join('')}
                <td>${p.out || '—'}</td>
                <td>${p.inn || '—'}</td>
                <td>${p.total || '—'}</td>
                <td>${p.total ? (p.toPar === 0 ? 'E' : (p.toPar > 0 ? `+${p.toPar}` : p.toPar)) : '—'}</td>
                <td>${p.net}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="games">
          ${getVegasHtml()}
          ${getBankerHtml()}
          ${getSkinsHtml()}
          ${getJunkHtml()}
        </div>

        <div class="footer">
          <p>Printed from Manito Golf Games • ${date}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  // Open print window
  const printWindow = window.open('', '', 'width=900,height=800');
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}

function getVegasHtml() {
  const vegasSection = document.getElementById('vegasSection');
  if (!vegasSection?.classList.contains('open')) return '';
  
  const teamA = Array.from(document.querySelectorAll('input[name^="vegasTeam_"][value="A"]:checked')).map(inp => {
    const idx = inp.name.match(/\d+/)[0];
    const row = document.querySelectorAll('.player-row')[idx];
    return row?.querySelector('.name-edit')?.value || `Player ${Number(idx) + 1}`;
  });
  
  const teamB = Array.from(document.querySelectorAll('input[name^="vegasTeam_"][value="B"]:checked')).map(inp => {
    const idx = inp.name.match(/\d+/)[0];
    const row = document.querySelectorAll('.player-row')[idx];
    return row?.querySelector('.name-edit')?.value || `Player ${Number(idx) + 1}`;
  });
  
  const ptsA = document.getElementById('vegasPtsA')?.textContent || '—';
  const totalA = document.getElementById('vegasTotalA')?.textContent || '—';
  const totalB = document.getElementById('vegasTotalB')?.textContent || '—';
  const perStr = (document.getElementById('vegasPointValue')?.value || '').trim();
  let per = Number.parseFloat(perStr);
  if(!Number.isFinite(per) || per < 0) per = 0;
  const ptsANum = (ptsA && /[-+]?\d+/.test(ptsA)) ? parseInt(ptsA,10) : null;
  const dollarsA = ptsANum===null? null : +(ptsANum * per).toFixed(2);
  const dollarsB = dollarsA===null? null : -dollarsA;
  const fmt = v => v===null? '—' : (v>0? `+$${v.toFixed(2)}` : (v<0? `-$${Math.abs(v).toFixed(2)}` : `$${v.toFixed(2)}`));

  return `
    <div class="game-box">
      <h3>Vegas Game</h3>
      <table class="game-table">
        <tr><td><strong>Team A:</strong></td><td>${teamA.join(', ')}</td></tr>
        <tr><td><strong>Team B:</strong></td><td>${teamB.join(', ')}</td></tr>
        <tr><td><strong>Team A Gross:</strong></td><td>${totalA}</td></tr>
        <tr><td><strong>Team B Gross:</strong></td><td>${totalB}</td></tr>
        <tr><td><strong>Team A Points:</strong></td><td style="font-weight: bold; color: #090;">${ptsA}</td></tr>
        <tr><td><strong>$/point:</strong></td><td>$${per.toFixed(2)}</td></tr>
        <tr><td><strong>Team A $:</strong></td><td>${fmt(dollarsA)}</td></tr>
        <tr><td><strong>Team B $:</strong></td><td>${fmt(dollarsB)}</td></tr>
      </table>
    </div>
  `;
}

function getBankerHtml() {
  const bankerSection = document.getElementById('bankerSection');
  if (!bankerSection?.classList.contains('open')) return '';
  
  const pointValue = document.getElementById('bankerPointValue')?.value || '1';
  const rotation = document.getElementById('bankerRotation')?.value || 'rotate';
  const players = Array.from(document.querySelectorAll('.player-row')).map(r => r.querySelector('.name-edit')?.value || 'Player');
  
  const tots = [
    document.getElementById('bankerTotP1')?.textContent || '—',
    document.getElementById('bankerTotP2')?.textContent || '—',
    document.getElementById('bankerTotP3')?.textContent || '—',
    document.getElementById('bankerTotP4')?.textContent || '—',
  ];

  return `
    <div class="game-box">
      <h3>Banker Game</h3>
      <table class="game-table">
        <tr><td><strong>Point Value:</strong></td><td>$${pointValue}</td></tr>
        <tr><td><strong>Rotation:</strong></td><td>${rotation === 'rotate' ? 'Rotate each hole' : 'Until beaten'}</td></tr>
        <tr><td colspan="2"><strong>Totals:</strong></td></tr>
        ${tots.map((t, i) => `<tr><td>${players[i]}</td><td>${t}</td></tr>`).join('')}
      </table>
    </div>
  `;
}

function getSkinsHtml() {
  const skinsSection = document.getElementById('skinsSection');
  if (!skinsSection?.classList.contains('open')) return '';
  
  const players = Array.from(document.querySelectorAll('.player-row')).map(r => r.querySelector('.name-edit')?.value || 'Player');
  const tots = [
    document.getElementById('skinsTotal0')?.textContent || '0',
    document.getElementById('skinsTotal1')?.textContent || '0',
    document.getElementById('skinsTotal2')?.textContent || '0',
    document.getElementById('skinsTotal3')?.textContent || '0',
  ];

  return `
    <div class="game-box">
      <h3>Skins Game</h3>
      <table class="game-table">
        ${tots.map((t, i) => `<tr><td>${players[i]}</td><td><strong>${t}</strong></td></tr>`).join('')}
      </table>
    </div>
  `;
}

function getJunkHtml() {
  const junkSection = document.getElementById('junkSection');
  if (!junkSection?.classList.contains('open')) return '';
  
  const players = Array.from(document.querySelectorAll('.player-row')).map(r => r.querySelector('.name-edit')?.value || 'Player');
  const tots = [
    document.getElementById('junkTotP1')?.textContent || '0',
    document.getElementById('junkTotP2')?.textContent || '0',
    document.getElementById('junkTotP3')?.textContent || '0',
    document.getElementById('junkTotP4')?.textContent || '0',
  ];

  return `
    <div class="game-box">
      <h3>Junk (Dots)</h3>
      <table class="game-table">
        ${tots.map((t, i) => `<tr><td>${players[i]}</td><td><strong>${t}</strong></td></tr>`).join('')}
      </table>
    </div>
  `;
}

// ============================
// PRINT SCORECARD & GAMES
// ============================
(function(){
  function generatePrintPage(){
    const courseName = document.getElementById('courseName')?.value || 'Golf Course';
    const teeName = document.getElementById('teeName')?.value || '';
    const timestamp = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
    const playerRows = Array.from(document.querySelectorAll('.player-row'));
    const players = playerRows.map((row, idx) => ({
      idx,
      name: row.querySelector('.name-edit')?.value || `Player ${idx+1}`,
      ch: row.querySelector('.ch-input')?.value || '0',
      scores: Array.from(row.querySelectorAll('.score-input')).map(i => i.value || '—'),
    }));

    // Build HTML for print
    let html = `
    <div class="print-container">
      <div class="print-header">
        <h1>Manito Golf Games</h1>
        <p><strong>${courseName}</strong>${teeName ? ` • ${teeName} Tee` : ''}</p>
        <p>${timestamp}</p>
      </div>

      <div class="print-section">
        <h2>Scorecard</h2>
        <table class="print-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>CH</th>
              ${Array.from({length:18}, (_,i) => `<th>${i+1}</th>`).join('')}
              <th>Out</th>
              <th>In</th>
              <th>Total</th>
              <th>To Par</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Par</strong></td>
              <td>—</td>
              ${Array.from({length:18}, (_,i) => `<td>${window.PARS ? window.PARS[i] : '—'}</td>`).join('')}
              <td colspan="4"></td>
            </tr>`;
    
    players.forEach(p => {
      const scoreInputs = Array.from(document.querySelectorAll(`.player-row[data-player="${p.idx}"] .score-input`));
      const scores = scoreInputs.map(i => Number(i.value) || 0);
      const out = scores.slice(0, 9).reduce((a,b) => a+b, 0);
      const inn = scores.slice(9, 18).reduce((a,b) => a+b, 0);
      const total = out + inn;
      const parTotal = window.PARS ? window.PARS.reduce((a,b) => a+b, 0) : 0;
      const toPar = total && parTotal ? total - parTotal : 0;
      const toParStr = toPar === 0 ? 'E' : (toPar > 0 ? `+${toPar}` : `${toPar}`);
      const netEl = document.querySelector(`.player-row[data-player="${p.idx}"] .net`);
      const net = netEl?.textContent || '—';

      html += `
            <tr>
              <td><strong>${p.name}</strong></td>
              <td>${p.ch}</td>
              ${scores.map((s, i) => `<td>${s || '—'}</td>`).join('')}
              <td>${out || '—'}</td>
              <td>${inn || '—'}</td>
              <td>${total || '—'}</td>
              <td>${total ? toParStr : '—'}</td>
              <td>${net}</td>
            </tr>`;
    });

    html += `</tbody></table></div>`;

    // Games section
    html += `<div class="print-games-grid">`;

    // Vegas
    const vegasSection = document.getElementById('vegasSection');
    if(vegasSection?.classList.contains('open')){
      const vegasTeamA = document.querySelectorAll('input[name^="vegasTeam_"][value="A"]:checked');
      const vegasTeamB = document.querySelectorAll('input[name^="vegasTeam_"][value="B"]:checked');
      const teamANames = Array.from(vegasTeamA).map((_, i) => {
        const playerRow = Array.from(document.querySelectorAll('.player-row'))[i];
        return playerRow?.querySelector('.name-edit')?.value || `Player ${i+1}`;
      }).filter((_, i) => document.querySelector(`input[name="vegasTeam_${i}"][value="A"]`)?.checked);
      const teamBNames = Array.from(vegasTeamB).map((_, i) => {
        const playerRow = Array.from(document.querySelectorAll('.player-row'))[i];
        return playerRow?.querySelector('.name-edit')?.value || `Player ${i+1}`;
      }).filter((_, i) => document.querySelector(`input[name="vegasTeam_${i}"][value="B"]`)?.checked);

      const vegasPtsA = document.getElementById('vegasPtsA')?.textContent || '—';
      const vegasTotalA = document.getElementById('vegasTotalA')?.textContent || '—';
      const vegasTotalB = document.getElementById('vegasTotalB')?.textContent || '—';

      html += `
      <div class="print-game-box">
        <h3>Vegas Game</h3>
        <p><strong>Team A:</strong> ${teamANames.join(', ')}</p>
        <p><strong>Team B:</strong> ${teamBNames.join(', ')}</p>
        <p><strong>Team A Gross:</strong> ${vegasTotalA}</p>
        <p><strong>Team B Gross:</strong> ${vegasTotalB}</p>
        <p style="font-size: 14px; font-weight: bold; color: #090;"><strong>Team A Points:</strong> ${vegasPtsA}</p>
      </div>`;
    }

    // Banker
    const bankerSection = document.getElementById('bankerSection');
    if(bankerSection?.classList.contains('open')){
      const pointValue = document.getElementById('bankerPointValue')?.value || '1';
      const rotation = document.getElementById('bankerRotation')?.value || 'rotate';
      const bankerTotP1 = document.getElementById('bankerTotP1')?.textContent || '—';
      const bankerTotP2 = document.getElementById('bankerTotP2')?.textContent || '—';
      const bankerTotP3 = document.getElementById('bankerTotP3')?.textContent || '—';
      const bankerTotP4 = document.getElementById('bankerTotP4')?.textContent || '—';

      html += `
      <div class="print-game-box">
        <h3>Banker Game</h3>
        <p><strong>Point Value:</strong> $${pointValue}</p>
        <p><strong>Rotation:</strong> ${rotation === 'rotate' ? 'Rotate each hole' : 'Until beaten'}</p>
        <table class="print-table" style="font-size: 10px; margin-top: 10px;">
          <tr>
            <td>${players[0]?.name || 'P1'}</td><td>${bankerTotP1}</td>
          </tr>
          <tr>
            <td>${players[1]?.name || 'P2'}</td><td>${bankerTotP2}</td>
          </tr>
          <tr>
            <td>${players[2]?.name || 'P3'}</td><td>${bankerTotP3}</td>
          </tr>
          <tr>
            <td>${players[3]?.name || 'P4'}</td><td>${bankerTotP4}</td>
          </tr>
        </table>
      </div>`;
    }

    // Skins
    const skinsSection = document.getElementById('skinsSection');
    if(skinsSection?.classList.contains('open')){
      const skinsTotP1 = document.getElementById('skinsTotal0')?.textContent || '0';
      const skinsTotP2 = document.getElementById('skinsTotal1')?.textContent || '0';
      const skinsTotP3 = document.getElementById('skinsTotal2')?.textContent || '0';
      const skinsTotP4 = document.getElementById('skinsTotal3')?.textContent || '0';

      html += `
      <div class="print-game-box">
        <h3>Skins Game</h3>
        <table class="print-table" style="font-size: 10px;">
          <tr>
            <td>${players[0]?.name || 'P1'}</td><td><strong>${skinsTotP1}</strong></td>
          </tr>
          <tr>
            <td>${players[1]?.name || 'P2'}</td><td><strong>${skinsTotP2}</strong></td>
          </tr>
          <tr>
            <td>${players[2]?.name || 'P3'}</td><td><strong>${skinsTotP3}</strong></td>
          </tr>
          <tr>
            <td>${players[3]?.name || 'P4'}</td><td><strong>${skinsTotP4}</strong></td>
          </tr>
        </table>
      </div>`;
    }

    // Junk
    const junkSection = document.getElementById('junkSection');
    if(junkSection?.classList.contains('open')){
      const junkTotP1 = document.getElementById('junkTotP1')?.textContent || '0';
      const junkTotP2 = document.getElementById('junkTotP2')?.textContent || '0';
      const junkTotP3 = document.getElementById('junkTotP3')?.textContent || '0';
      const junkTotP4 = document.getElementById('junkTotP4')?.textContent || '0';

      html += `
      <div class="print-game-box">
        <h3>Junk (Dots)</h3>
        <table class="print-table" style="font-size: 10px;">
          <tr>
            <td>${players[0]?.name || 'P1'}</td><td><strong>${junkTotP1}</strong></td>
          </tr>
          <tr>
            <td>${players[1]?.name || 'P2'}</td><td><strong>${junkTotP2}</strong></td>
          </tr>
          <tr>
            <td>${players[2]?.name || 'P3'}</td><td><strong>${junkTotP3}</strong></td>
          </tr>
          <tr>
            <td>${players[3]?.name || 'P4'}</td><td><strong>${junkTotP4}</strong></td>
          </tr>
        </table>
      </div>`;
    }

    html += `</div>`;

    html += `
      <div class="print-footer">
        <p>Printed from Manito Golf Games • ${timestamp}</p>
      </div>
    </div>`;

    return html;
  }

  // Create printScorecard function that can be called from init
  function printScorecard(){
    const printPage = document.getElementById('printPage');
    if(!printPage) {
      console.error('Print page element not found');
      return;
    }
    printPage.innerHTML = generatePrintPage();
    printPage.style.display = 'block';
    
    // Trigger print dialog
    setTimeout(() => {
      window.print();
      // Optionally hide after print
      setTimeout(() => {
        printPage.style.display = 'none';
      }, 500);
    }, 100);
  }

  // Make functions and PARS accessible globally
  window.printScorecard = printScorecard;
  window.PARS = [4,4,4,5,3,4,4,3,4, 4,4,3,5,5,4,4,3,4];

})();
