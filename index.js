/* Golf Scorecard — 4 players / 18 holes + Vegas & Banker (toggleable)
   - Course Handicap input per player (supports negatives)
   - Net totals with NDB; strokes allocated off the lowest CH (play-off-low)
   - Vegas: teams, multipliers, and opponent-digit flip on birdie+
   - Banker: points-per-match, rotate or until-beaten, multipliers
   - CSV upload (player, ch, h1..h18) + client-side template download
*/

(() => {
  const HOLES = 18;
  const PLAYERS = 4;
  const LEADING_FIXED_COLS = 2; // Player + CH

  // ----- Fixed values from your card -----
  const PARS   = [4,4,4,5,3,4,4,3,4, 4,4,3,5,5,4,4,3,4];
  const HCPMEN = [7,13,11,15,17,1,5,9,3, 10,2,12,14,18,4,6,16,8];

  // ---------- DOM helpers ----------
  const $  = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
  const sum = a => a.reduce((x,y)=>x+(Number(y)||0),0);
  const clampInt = (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(+v) ? Math.trunc(+v) : min));

  const ids = {
    holesHeader:"#holesHeader",parRow:"#parRow",hcpRow:"#hcpRow",totalsRow:"#totalsRow",
    table:"#scorecard",courseName:"#courseName",teeName:"#teeName",
    resetBtn:"#resetBtn",clearAllBtn:"#clearAllBtn",saveBtn:"#saveBtn",saveStatus:"#saveStatus",

    // Games toggles
    toggleVegas:"#toggleVegas", toggleBanker:"#toggleBanker", toggleSkins:"#toggleSkins",
    vegasSection:"#vegasSection", bankerSection:"#bankerSection", skinsSection:"#skinsSection",

    // Vegas
    vegasTeams:"#vegasTeams", vegasTeamWarning:"#vegasTeamWarning",
    vegasTableBody:"#vegasBody", vegasTotalA:"#vegasTotalA", vegasTotalB:"#vegasTotalB", vegasPtsA:"#vegasPtsA",
    optUseNet:"#optUseNet", optDoubleBirdie:"#optDoubleBirdie", optTripleEagle:"#optTripleEagle",

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
      chInput.addEventListener("input",()=>{ if(chInput.value!=="") chInput.value=clampInt(chInput.value,-50,60); recalcAll(); vegas_recalc(); banker_recalc(); saveDebounced(); });
      chTd.appendChild(chInput); tr.appendChild(chTd);

      for(let h=1;h<=HOLES;h++){
        const td=document.createElement("td"), inp=document.createElement("input");
        inp.type="number"; inp.inputMode="numeric"; inp.min="1"; inp.max="20"; inp.className="score-input"; inp.dataset.player=String(p); inp.dataset.hole=String(h); inp.placeholder="—";
        inp.addEventListener("input",()=>{ if(inp.value!==""){const v=clampInt(inp.value,1,20); if(String(v)!==inp.value) inp.classList.add("invalid"); else inp.classList.remove("invalid"); inp.value=v;} else {inp.classList.remove("invalid");}
          recalcRow(tr); recalcTotalsRow(); vegas_recalc(); banker_recalc(); saveDebounced(); });
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

  // ---------- Handicap math (shared) ----------
  function adjustedCHs(){
    const chs=$$(".player-row").map(r=>{ const v=Number($(".ch-input",r)?.value); return Number.isFinite(v)?v:0; });
    const minCH=Math.min(...chs);
    return chs.map(ch=>ch-minCH); // play off low
  }
  function strokesOnHole(adjCH, i){
    if(adjCH<=0) return 0;
    const base=Math.floor(adjCH/18), rem=adjCH%18, holeHcp=HCPMEN[i];
    return base+(holeHcp<=rem?1:0);
  }
  function getGross(playerIdx, holeIdx){
    return Number($(`input.score-input[data-player="${playerIdx}"][data-hole="${holeIdx+1}"]`)?.value)||0;
  }
  function getNetNDB(playerIdx, holeIdx){
    const adjCH=adjustedCHs()[playerIdx], gross=getGross(playerIdx,holeIdx);
    if(!gross) return 0;
    const sr=strokesOnHole(adjCH,holeIdx), ndb=PARS[holeIdx]+2+sr, adjGross=Math.min(gross,ndb);
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
      if(s.banker?.opts) banker_setOptions(s.banker.opts);
      if(s.banker?.open) games_open("banker");

      vegas_recalc(); banker_recalc();
      announce(`Restored saved card (${new Date(s.savedAt||Date.now()).toLocaleString()}).`);
    }catch{}
  }

  function clearScoresOnly(){ $$("input.score-input").forEach(i=>{i.value="";i.classList.remove("invalid");}); recalcAll(); vegas_recalc(); banker_recalc(); announce("Scores cleared."); }
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
  }
  function games_close(which){
    if(which==="vegas"){ $(ids.vegasSection).classList.remove("open"); $(ids.vegasSection).setAttribute("aria-hidden","true"); $(ids.toggleVegas).classList.remove("active"); }
    if(which==="banker"){ $(ids.bankerSection).classList.remove("open"); $(ids.bankerSection).setAttribute("aria-hidden","true"); $(ids.toggleBanker).classList.remove("active"); }
  }
  function games_toggle(which){
    const open = (which==="vegas"? $(ids.vegasSection) : $(ids.bankerSection)).classList.contains("open");
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
  function vegas_getOptions(){ return { useNet:$(ids.optUseNet)?.checked||false, doubleBirdie:$(ids.optDoubleBirdie)?.checked||false, tripleEagle:$(ids.optTripleEagle)?.checked||false }; }
  function vegas_setOptions(o){ if('useNet'in o) $(ids.optUseNet).checked=!!o.useNet; if('doubleBirdie'in o) $(ids.optDoubleBirdie).checked=!!o.doubleBirdie; if('tripleEagle'in o) $(ids.optTripleEagle).checked=!!o.tripleEagle; }

  // Core helpers
  function vegas_teamPair(players, holeIdx, useNet) {
    const vals = players.map(p => useNet ? getNetNDB(p, holeIdx) : getGross(p, holeIdx))
      .filter(v => Number.isFinite(v) && v > 0);
    if (vals.length < 2) return null;
    vals.sort((a,b)=>a-b);
    return [vals[0], vals[1]]; // lo, hi
  }
  function vegas_pairToString(pair){ return `${pair[0]}${pair[1]}`; }
  function vegas_teamHasBirdieOrEagle(players,h,useNet){
    const best=Math.min(...players.map(p=>(useNet?getNetNDB(p,h):getGross(p,h))||Infinity));
    if(!Number.isFinite(best)) return {birdie:false,eagle:false};
    const toPar=best-PARS[h]; return {birdie:toPar<=-1, eagle:toPar<=-2};
  }
  function vegas_multiplierForWinner(winnerPlayers,h,useNet,opts){
    const {birdie,eagle}=vegas_teamHasBirdieOrEagle(winnerPlayers,h,useNet); let m=1;
    if(opts.tripleEagle && eagle) m=Math.max(m,3);
    if(opts.doubleBirdie && birdie) m=Math.max(m,2);
    return m;
  }

  function vegas_recalc(){
    const teams=vegas_getTeamAssignments(), warn=$(ids.vegasTeamWarning), opts=vegas_getOptions();
    if(!(teams.A.length===2 && teams.B.length===2)){
      warn.hidden=false; for(let h=0;h<HOLES;h++){ $(`[data-vegas-a="${h}"]`).textContent="—"; $(`[data-vegas-b="${h}"]`).textContent="—"; $(`[data-vegas-m="${h}"]`).textContent="—"; $(`[data-vegas-p="${h}"]`).textContent="—"; }
      $(ids.vegasTotalA).textContent="—"; $(ids.vegasTotalB).textContent="—"; $(ids.vegasPtsA).textContent="—"; return;
    }
    warn.hidden=true;

    let ptsA=0;
    for(let h=0;h<HOLES;h++){
      // Base lo–hi pairs
      const pairA = vegas_teamPair(teams.A,h,opts.useNet);
      const pairB = vegas_teamPair(teams.B,h,opts.useNet);
      if(!pairA || !pairB){
        $(`[data-vegas-a="${h}"]`).textContent="—";
        $(`[data-vegas-b="${h}"]`).textContent="—";
        $(`[data-vegas-m="${h}"]`).textContent="—";
        $(`[data-vegas-p="${h}"]`).textContent="—";
        continue;
      }
      // Birdie/eagle checks
      const aBE = vegas_teamHasBirdieOrEagle(teams.A,h,opts.useNet);
      const bBE = vegas_teamHasBirdieOrEagle(teams.B,h,opts.useNet);

      // Opponent digit flips if a team has birdie+
      const effA = (bBE.birdie || bBE.eagle) ? [pairA[1],pairA[0]] : pairA;
      const effB = (aBE.birdie || aBE.eagle) ? [pairB[1],pairB[0]] : pairB;

      const vaStr=vegas_pairToString(effA), vbStr=vegas_pairToString(effB);
      const va=Number(vaStr), vb=Number(vbStr);

      let winner='A', diff=vb-va;
      if(diff<0){ winner='B'; diff=-diff; }
      const mult=vegas_multiplierForWinner(teams[winner],h,opts.useNet,opts);
      const holePtsA = winner==='A' ? diff*mult : -diff*mult;

      $(`[data-vegas-a="${h}"]`).textContent=vaStr;
      $(`[data-vegas-b="${h}"]`).textContent=vbStr;
      $(`[data-vegas-m="${h}"]`).textContent=mult||"—";
      $(`[data-vegas-p="${h}"]`).textContent=holePtsA? (holePtsA>0?`+${holePtsA}`:`${holePtsA}`) : "—";

      ptsA += holePtsA;
    }
    $(ids.vegasPtsA).textContent = ptsA===0? "0" : (ptsA>0? `+${ptsA}`:`${ptsA}`);

    // Gross transparency numbers
    const teamSum = team => { let s=0; for(let h=0;h<HOLES;h++){ team.forEach(p=>{ s+=getGross(p,h)||0; }); } return s; };
    $(ids.vegasTotalA).textContent=teamSum(teams.A)||"—";
    $(ids.vegasTotalB).textContent=teamSum(teams.B)||"—";
  }

  // ======================================================================
  // =============================== BANKER ===============================
  // ======================================================================
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

  // Banker business helpers
  function banker_score(playerIdx, holeIdx, useNet){
    return useNet ? getNetNDB(playerIdx,holeIdx) : getGross(playerIdx,holeIdx);
  }
  function banker_matchMultiplier(winnerIdx, holeIdx, opts){
    const s = banker_score(winnerIdx, holeIdx, opts.useNet);
    if(!s) return 1;
    const toPar = s - PARS[holeIdx];
    let m = 1;
    if(opts.tripleEagle && toPar <= -2) m = Math.max(m,3);
    if(opts.doubleBirdie && toPar <= -1) m = Math.max(m,2);
    return m;
  }
  function banker_nextBankerAfterHole(currentBanker, holeIdx, opts){
    if(opts.rotation==="rotate") return (holeIdx+1) % PLAYERS;
    const b=currentBanker;
    let bestOpponent=null, bestScore=Infinity;
    for(let p=0;p<PLAYERS;p++){
      if(p===b) continue;
      const s=banker_score(p,holeIdx,opts.useNet) || Infinity;
      if(s<bestScore){ bestScore=s; bestOpponent=p; }
    }
    const sb = banker_score(b,holeIdx,opts.useNet) || Infinity;
    if(bestOpponent!==null && bestScore < sb) return bestOpponent;
    return b;
  }

  function banker_recalc(){
    const names=$$(".player-row").map((r,i)=>$(".name-edit",r).value||`Player ${i+1}`);
    const opts=banker_getOptions();
    const totals=[0,0,0,0];

    let banker = 0; // start P1 on hole 1
    for(let h=0;h<HOLES;h++){
      $(`[data-banker-name="${h}"]`).textContent = names[banker];
      const deltas=[0,0,0,0];

      for(let p=0;p<PLAYERS;p++){
        if(p===banker) continue;
        const sb = banker_score(banker,h,opts.useNet);
        const so = banker_score(p,h,opts.useNet);
        if(!sb || !so){ deltas[p] = 0; continue; }
        if(sb===so){ deltas[p]=0; continue; }
        const winner = (so<sb) ? p : banker;
        const mult   = banker_matchMultiplier(winner,h,opts);
        const value  = opts.pointValue * mult;
        if(winner===p){ deltas[p] += value; deltas[banker] -= value; }
        else { deltas[p] -= value; deltas[banker] += value; }
      }

      for(let p=0;p<PLAYERS;p++){
        const cell = $(`[data-banker-p="${h}-${p}"]`);
        const d = deltas[p];
        cell.textContent = d===0 ? "—" : (d>0? `+${d}` : `${d}`);
        totals[p] += d;
      }

      banker = banker_nextBankerAfterHole(banker,h,opts);
    }

    $(ids.bankerTotP1).textContent = totals[0]===0 ? "0" : (totals[0]>0?`+${totals[0]}`:`${totals[0]}`);
    $(ids.bankerTotP2).textContent = totals[1]===0 ? "0" : (totals[1]>0?`+${totals[1]}`:`${totals[1]}`);
    $(ids.bankerTotP3).textContent = totals[2]===0 ? "0" : (totals[2]>0?`+${totals[2]}`:`${totals[2]}`);
    $(ids.bankerTotP4).textContent = totals[3]===0 ? "0" : (totals[3]>0?`+${totals[3]}`:`${totals[3]}`);
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
    buildHeader(); buildParAndHcpRows(); buildPlayerRows(); buildTotalsRow();

    $(ids.resetBtn).addEventListener("click", clearScoresOnly);
    $(ids.clearAllBtn).addEventListener("click", clearAll);
    $(ids.saveBtn).addEventListener("click", saveState);
    $(ids.courseName).addEventListener("input", saveDebounced);
    $(ids.teeName).addEventListener("input", saveDebounced);

    // Games: open/close
    $(ids.toggleVegas).addEventListener("click", ()=>games_toggle("vegas"));
    $(ids.toggleBanker).addEventListener("click", ()=>games_toggle("banker"));

    // Vegas UI + wiring
    vegas_renderTeamControls();
    vegas_renderTable();
    $(ids.optUseNet).addEventListener("change", ()=>{ vegas_recalc(); saveDebounced(); });
    $(ids.optDoubleBirdie).addEventListener("change", ()=>{ vegas_recalc(); saveDebounced(); });
    $(ids.optTripleEagle).addEventListener("change", ()=>{ vegas_recalc(); saveDebounced(); });

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
function strokesOnHoleHalfAware(adjCH, i, half){
  const useAdj = half ? Math.floor(adjCH/2) : adjCH;
  if(useAdj<=0) return 0;
  const base=Math.floor(useAdj/18), rem=useAdj%18, holeHcp=HCPMEN[i];
  return base+(holeHcp<=rem?1:0);
}
function getNetForSkins(playerIdx, holeIdx, half){
  const adjCHsArr = adjustedCHs();
  const gross = getGross(playerIdx, holeIdx);
  if(!gross) return 0;
  const adj = adjCHsArr[playerIdx];
  const sr = strokesOnHoleHalfAware(adj, holeIdx, half);
  const ndb = PARS[holeIdx] + 2 + sr;
  const adjGross = Math.min(gross, ndb);
  return adjGross - sr;
}


function buildSkinsTable(){
  const body = document.getElementById('skinsBody');
  if(!body) return;
  if(body.dataset.simple === '1') return;
  // Build summary-only table: Name | Holes Skinned | Total
  body.innerHTML = '';
  for(let p=0; p<4; p++){
    const tr = document.createElement('tr');
    const th = document.createElement('th'); th.id = 'skinsName'+p; th.textContent = 'P'+(p+1);
    const tdH = document.createElement('td'); tdH.id = 'skinsHoles'+p;
    const tdT = document.createElement('td'); tdT.id = 'skinsTotal'+p; tdT.textContent='0';
    tr.append(th, tdH, tdT);
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

  for(let p=0;p<4;p++){
    const holesCell = document.getElementById('skinsHoles'+p);
    const totCell   = document.getElementById('skinsTotal'+p);
    if(holesCell) holesCell.textContent = holesWon[p].join(', ');
    if(totCell)   totCell.textContent = String(totals[p]||0);
  }
}
function initSkins(){
  buildSkinsTable();
  refreshSkinsHeaderNames();
  updateSkins();

  // Recompute on option change
  document.getElementById('skinsCarry')?.addEventListener('change', updateSkins);
  document.getElementById('skinsHalf')?.addEventListener('change', updateSkins);

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
    let totals = [0,0,0,0];
    for(let h=1; h<=HOLES; h++){
      const par = getPar(h);
      for(let p=0; p<4; p++){
        const score = getScore(p, h);
        const d = dotsFor(score, par);
        totals[p] += d;
        const cell = document.getElementById(`junk_h${h}_p${p+1}`);
        if(cell) cell.textContent = Number.isFinite(d) ? d : '—';
      }
    }
    const ids = ['junkTotP1','junkTotP2','junkTotP3','junkTotP4'];
    ids.forEach((id, i)=>{
      const el = document.getElementById(id);
      if(el) el.textContent = totals[i];
    });
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

  // Base dots logic copied from earlier block
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
  function baseDots(score, par){
    if(!Number.isFinite(score) || !Number.isFinite(par)) return 0;
    const diff = score - par;
    if(diff <= -2) return 4;
    if(diff === -1) return 2;
    if(diff === 0)  return 1;
    return 0;
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
    const m = String(txt).match(/[-+]?\\d+/);
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
    // also try when Vegas tab is opened
    document.getElementById('toggleVegas')?.addEventListener('click', ()=> {
      setTimeout(()=>{ observeA(); }, 0);
    });
  });
})();

// ============================
// Junk: ensure dropdown stays large enough on touch
// (CSS handled in <style>, logic already present.)
// ============================
