/* ============================================================================
   WOLF GAME MODULE
   ============================================================================

   Wolf Rules (common variant):
   - Requires exactly 4 players.
   - Order of play rotates every hole. Player at index ((hole-1) % 4) is the
     "Wolf" for that hole (simple cycle; easy to reason about).
   - On each hole the Wolf picks ONE of three decisions:
       1. Partner: pick one of the other 3 players as partner. 2v2 match.
       2. Lone Wolf: go alone against the other 3 (1v3).
       3. Blind Wolf: go alone, declared before anyone tees off (1v3, doubled).
   - Lower team "ball" (best score on the team) wins the hole.
   - Ties push (no points awarded, no carry-over).

   Default scoring (each outcome per player):
   - Partner win:      +1 to each partner (2 total).
   - Partner loss:     +1 to each opponent (2 total).
   - Lone Wolf win:    +3 to Wolf, 0 to each opponent.
   - Lone Wolf loss:   0 to Wolf, +1 to each opponent (3 total).
   - Blind Wolf win:   +4 to Wolf.
   - Blind Wolf loss:  +2 to each opponent.
   - Tie:              no points.

   Handicap modes (same semantics as other games):
   - gross:        compare raw gross scores.
   - playOffLow:   strokes relative to lowest CH, applied via hole HCP index.
   - rawHandicap: each player uses their full CH.

   Exposed as: window.Wolf
   API: {init, update, compute, render, refreshForPlayerChange,
         getState, setState, getOptions, setOptions}
   ============================================================================
*/

(() => {
  'use strict';

  const HOLES = 18;
  const REQUIRED_PLAYERS = 4;

  // Default scoring; kept internal (no UI to edit yet).
  const PTS = {
    partnerWin: 1,        // per partner
    partnerLoss: 1,       // per opponent
    loneWolfWin: 3,       // to wolf
    loneWolfLoss: 1,      // per opponent
    blindWolfWin: 4,      // to wolf
    blindWolfLoss: 2      // per opponent
  };

  let wolfListenersBound = false;

  // ---------------------------------------------------------------------------
  // HELPERS (intentionally mirror the other game modules for consistency)
  // ---------------------------------------------------------------------------
  function getFixedPlayerRows() {
    return Array.from(document.querySelectorAll('#scorecard .player-row'));
  }

  function getPlayerCount() {
    return getFixedPlayerRows().length;
  }

  function getPlayerNames() {
    return getFixedPlayerRows().map((row, idx) => {
      const v = row.querySelector('.name-edit')?.value?.trim();
      return v || `Player ${idx + 1}`;
    });
  }

  function getGross(playerIdx, holeIdx) {
    const input = document.querySelector(
      `.score-input[data-player="${playerIdx}"][data-hole="${holeIdx + 1}"]`
    );
    const v = Number(input?.value);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  function getPar(holeIdx) {
    const parRow = document.getElementById('parRow');
    if (!parRow) return 4;
    const inputs = parRow.querySelectorAll('input[type="number"]');
    const v = Number(inputs[holeIdx]?.value);
    return Number.isFinite(v) && v > 0 ? v : 4;
  }

  function getHCPIndex(holeIdx) {
    const HCPMEN = window.HCPMEN;
    if (!Array.isArray(HCPMEN)) return 1;
    return HCPMEN[holeIdx] || 1;
  }

  function getRawCHs() {
    return getFixedPlayerRows().map((row) => {
      const chInput = row.querySelector('.ch-input');
      const v = typeof window.getActualHandicapValue === 'function'
        ? window.getActualHandicapValue(chInput)
        : Number(chInput?.value);
      return Number.isFinite(v) ? v : 0;
    });
  }

  function getAdjustedCHs() {
    const chs = getRawCHs();
    if (!chs.length) return [];
    const minCH = Math.min(...chs);
    return chs.map((ch) => ch - minCH);
  }

  function strokesOnHole(adjCH, holeIdx) {
    if (!Number.isFinite(adjCH) || adjCH === 0) return 0;
    const holeHcp = getHCPIndex(holeIdx);
    const absCH = Math.abs(adjCH);
    const base = Math.floor(absCH / 18);
    const rem = absCH % 18;
    if (adjCH < 0) {
      return -(base + (holeHcp >= (19 - rem) ? 1 : 0));
    }
    return base + (holeHcp <= rem ? 1 : 0);
  }

  function getWolfConfig() {
    const btn = document.querySelector('#wolfHcpModeGroup .hcp-mode-btn[data-active="true"]');
    const mode = btn?.dataset.value || 'gross';
    return {
      useNet: mode !== 'gross',
      netHcpMode: mode === 'rawHandicap' ? 'rawHandicap' : 'playOffLow'
    };
  }

  function getScoreForHole(playerIdx, holeIdx, config, cache) {
    const gross = getGross(playerIdx, holeIdx);
    if (gross == null) return null;
    if (!config.useNet) return gross;

    const chs = config.netHcpMode === 'rawHandicap' ? cache.rawCHs : cache.adjustedCHs;
    const adjCH = chs[playerIdx] || 0;
    const sr = strokesOnHole(adjCH, holeIdx);
    // NDB cap on gross before deducting strokes
    const par = getPar(holeIdx);
    const ndb = par + 2 + Math.max(0, sr);
    const capped = Math.min(gross, ndb);
    return capped - sr;
  }

  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------
  /**
   * Per-hole decision:
   *   null                         -> not set
   *   { type: 'partner', partner } -> partner is 0..3 (must not equal wolf)
   *   { type: 'lone' }
   *   { type: 'blind' }
   */
  const state = {
    decisions: Array(HOLES).fill(null)
  };

  function wolfForHole(holeIdx) {
    // Rotate through players 0..3 across holes.
    return holeIdx % REQUIRED_PLAYERS;
  }

  // ---------------------------------------------------------------------------
  // COMPUTE
  // ---------------------------------------------------------------------------
  const Wolf = {
    init() {
      this.refreshForPlayerChange();
      if (!wolfListenersBound) {
        wolfListenersBound = true;

        // Scoring mode button group - local to Wolf
        document.getElementById('wolfHcpModeGroup')?.addEventListener('click', (e) => {
          const btn = e.target.closest('.hcp-mode-btn');
          if (!btn) return;
          document.querySelectorAll('#wolfHcpModeGroup .hcp-mode-btn').forEach((b) => {
            const isActive = b === btn;
            b.dataset.active = isActive ? 'true' : 'false';
            b.setAttribute('aria-checked', isActive ? 'true' : 'false');
          });
          Wolf.update();
          window.saveDebounced?.();
        });

        // Table-level delegation for decision selects
        document.getElementById('wolfTable')?.addEventListener('change', (e) => {
          const sel = e.target.closest('.wolf-decision');
          if (!sel) return;
          const hole = Number(sel.dataset.hole);
          const raw = sel.value;
          if (!Number.isInteger(hole) || hole < 0 || hole >= HOLES) return;
          if (!raw || raw === 'none') {
            state.decisions[hole] = null;
          } else if (raw === 'lone') {
            state.decisions[hole] = { type: 'lone' };
          } else if (raw === 'blind') {
            state.decisions[hole] = { type: 'blind' };
          } else if (raw.startsWith('partner:')) {
            const partner = Number(raw.slice('partner:'.length));
            if (Number.isInteger(partner)) {
              state.decisions[hole] = { type: 'partner', partner };
            }
          }
          Wolf.update();
          window.saveDebounced?.();
        });

        // React to any score/par/name change
        document.addEventListener('input', (e) => {
          const t = e.target;
          if (t.classList?.contains('score-input')
              || t.closest?.('#parRow')
              || t.classList?.contains('name-edit')
              || t.classList?.contains('ch-input')) {
            Wolf.update();
          }
        }, { passive: true });
      }
      this.update();
    },

    refreshForPlayerChange() {
      this.buildTable();
      this.update();
    },

    buildTable() {
      const tbody = document.getElementById('wolfBody');
      if (!tbody) return;

      const playerCount = getPlayerCount();
      const names = getPlayerNames();
      const validRoster = playerCount === REQUIRED_PLAYERS;

      tbody.innerHTML = '';
      for (let h = 0; h < HOLES; h++) {
        const wolf = wolfForHole(h);
        const tr = document.createElement('tr');

        const tdHole = document.createElement('td');
        tdHole.textContent = String(h + 1);
        tr.appendChild(tdHole);

        const tdWolf = document.createElement('td');
        tdWolf.id = `wolfName_h${h + 1}`;
        tdWolf.textContent = validRoster ? names[wolf] : '—';
        tr.appendChild(tdWolf);

        const tdDecision = document.createElement('td');
        const sel = document.createElement('select');
        sel.className = 'wolf-decision';
        sel.dataset.hole = String(h);
        sel.disabled = !validRoster;
        sel.innerHTML = buildDecisionOptions(h, wolf, names, validRoster);
        tdDecision.appendChild(sel);
        tr.appendChild(tdDecision);

        const tdResult = document.createElement('td');
        tdResult.id = `wolfResult_h${h + 1}`;
        tdResult.textContent = '—';
        tr.appendChild(tdResult);

        tbody.appendChild(tr);
      }

      // Restore selected values in the fresh DOM
      syncDecisionSelectsFromState();

      // Rebuild totals footer to match current player count
      rebuildFooter(names, validRoster);
    },

    compute() {
      const playerCount = getPlayerCount();
      const config = getWolfConfig();
      const cache = {
        adjustedCHs: config.useNet && config.netHcpMode !== 'rawHandicap' ? getAdjustedCHs() : [],
        rawCHs: config.useNet && config.netHcpMode === 'rawHandicap' ? getRawCHs() : []
      };

      const totals = Array(Math.max(playerCount, REQUIRED_PLAYERS)).fill(0);
      const holeResults = Array(HOLES).fill(null);
      const validRoster = playerCount === REQUIRED_PLAYERS;

      if (!validRoster) {
        return { totals, holeResults, valid: false, playerCount };
      }

      for (let h = 0; h < HOLES; h++) {
        const decision = state.decisions[h];
        if (!decision) continue;

        const wolf = wolfForHole(h);
        const scores = [];
        for (let p = 0; p < REQUIRED_PLAYERS; p++) {
          scores.push(getScoreForHole(p, h, config, cache));
        }
        // Need all 4 scores to score the hole
        if (scores.some((s) => s == null)) continue;

        let wolfTeam, oppTeam, multiplier, winPts, lossPts;
        if (decision.type === 'partner') {
          if (decision.partner === wolf) continue;
          wolfTeam = [wolf, decision.partner];
          oppTeam = [0, 1, 2, 3].filter((p) => !wolfTeam.includes(p));
          multiplier = 1;
          winPts = PTS.partnerWin;
          lossPts = PTS.partnerLoss;
        } else if (decision.type === 'lone') {
          wolfTeam = [wolf];
          oppTeam = [0, 1, 2, 3].filter((p) => p !== wolf);
          multiplier = 1;
          winPts = PTS.loneWolfWin;    // total to wolf
          lossPts = PTS.loneWolfLoss;  // per opponent
        } else if (decision.type === 'blind') {
          wolfTeam = [wolf];
          oppTeam = [0, 1, 2, 3].filter((p) => p !== wolf);
          multiplier = 2;
          winPts = PTS.blindWolfWin;
          lossPts = PTS.blindWolfLoss;
        } else {
          continue;
        }

        const wolfBest = Math.min(...wolfTeam.map((p) => scores[p]));
        const oppBest = Math.min(...oppTeam.map((p) => scores[p]));

        const result = {
          hole: h + 1,
          wolf,
          decision: decision.type,
          partner: decision.type === 'partner' ? decision.partner : null,
          wolfScore: wolfBest,
          oppScore: oppBest,
          winner: null,
          awarded: {}
        };

        if (wolfBest < oppBest) {
          if (decision.type === 'partner') {
            wolfTeam.forEach((p) => { totals[p] += winPts; result.awarded[p] = winPts; });
          } else {
            totals[wolf] += winPts * multiplier;
            result.awarded[wolf] = winPts * multiplier;
          }
          result.winner = decision.type === 'partner' ? 'wolfTeam' : 'wolf';
        } else if (oppBest < wolfBest) {
          oppTeam.forEach((p) => { totals[p] += lossPts; result.awarded[p] = lossPts; });
          result.winner = 'opponents';
        } else {
          result.winner = 'tie';
        }

        holeResults[h] = result;
      }

      return { totals, holeResults, valid: true, playerCount };
    },

    render(data) {
      const { totals, holeResults, valid, playerCount } = data;
      const names = getPlayerNames();

      // Per-hole results cell
      for (let h = 0; h < HOLES; h++) {
        const cell = document.getElementById(`wolfResult_h${h + 1}`);
        if (!cell) continue;
        const r = holeResults[h];
        if (!r) { cell.textContent = '—'; continue; }
        if (r.winner === 'tie') { cell.textContent = 'Tie'; continue; }
        const parts = Object.entries(r.awarded).map(([p, pts]) => {
          const idx = Number(p);
          const nm = names[idx] || `P${idx + 1}`;
          return `${nm} +${pts}`;
        });
        cell.textContent = parts.join(', ') || '—';
      }

      // Footer totals
      for (let p = 0; p < Math.max(playerCount, REQUIRED_PLAYERS); p++) {
        const el = document.getElementById(`wolfTotP${p + 1}`);
        if (el) el.textContent = valid && p < REQUIRED_PLAYERS ? String(totals[p] || 0) : '—';
      }

      // Live results summary (top panel)
      renderLiveResults(totals, names, valid);

      // Warning if not exactly 4 players
      const warn = document.getElementById('wolfRosterWarning');
      if (warn) warn.hidden = valid;
    },

    update() {
      const data = this.compute();
      this.render(data);
    },
    // Alias for consistency with other modules
    recalc() { this.update(); },

    // ---- State/options ----
    getState() {
      return { decisions: state.decisions.map((d) => (d ? { ...d } : null)) };
    },
    setState(s) {
      if (!s || !Array.isArray(s.decisions)) return;
      for (let i = 0; i < HOLES; i++) {
        const d = s.decisions[i];
        state.decisions[i] = d && typeof d === 'object' ? { ...d } : null;
      }
      syncDecisionSelectsFromState();
      this.update();
    },
    getOptions() {
      const config = getWolfConfig();
      return { mode: config.useNet ? 'net' : 'gross', netHcpMode: config.netHcpMode };
    },
    clearState() {
      state.decisions = Array(HOLES).fill(null);
      syncDecisionSelectsFromState();
      this.update();
    }
  };

  function buildDecisionOptions(holeIdx, wolfIdx, names, validRoster) {
    if (!validRoster) {
      return '<option value="none">Requires 4 players</option>';
    }
    const opts = ['<option value="none">—</option>'];
    for (let p = 0; p < REQUIRED_PLAYERS; p++) {
      if (p === wolfIdx) continue;
      opts.push(`<option value="partner:${p}">Partner: ${escapeHtml(names[p])}</option>`);
    }
    opts.push('<option value="lone">Lone Wolf</option>');
    opts.push('<option value="blind">Blind Wolf</option>');
    return opts.join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function syncDecisionSelectsFromState() {
    for (let h = 0; h < HOLES; h++) {
      const sel = document.querySelector(`.wolf-decision[data-hole="${h}"]`);
      if (!sel) continue;
      const d = state.decisions[h];
      if (!d) { sel.value = 'none'; continue; }
      if (d.type === 'lone') sel.value = 'lone';
      else if (d.type === 'blind') sel.value = 'blind';
      else if (d.type === 'partner') sel.value = `partner:${d.partner}`;
      else sel.value = 'none';
    }
  }

  function rebuildFooter(names, validRoster) {
    const tfoot = document.querySelector('#wolfTable tfoot');
    if (!tfoot) return;
    const labelRow = ['<td><strong>Player</strong></td>'];
    const totalRow = ['<td><strong>Points</strong></td>'];
    // Wolf table has: Hole, Wolf, Decision, Result → 4 header cells.
    // We repurpose tfoot as its own summary row with player names.
    // Use colspan to merge existing columns away and render a clean totals block.
    const colspan = 4;
    tfoot.innerHTML = `
      <tr>
        <td colspan="${colspan}" style="padding: 0;">
          <table style="width:100%; border-collapse: collapse;">
            <tbody>
              <tr class="wolf-totals-label">
                <td><strong>Player</strong></td>
                ${Array.from({ length: REQUIRED_PLAYERS }, (_, p) =>
                  `<td>${validRoster ? escapeHtml(names[p] || `P${p + 1}`) : `P${p + 1}`}</td>`
                ).join('')}
              </tr>
              <tr class="wolf-totals-values">
                <td><strong>Points</strong></td>
                ${Array.from({ length: REQUIRED_PLAYERS }, (_, p) =>
                  `<td id="wolfTotP${p + 1}">—</td>`
                ).join('')}
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
    `;
    // Reference usage to silence unused-var noise
    void labelRow; void totalRow;
  }

  function renderLiveResults(totals, names, valid) {
    const containers = [
      document.getElementById('wolfLiveResults'),
      document.getElementById('wolfResultsBottom')
    ].filter(Boolean);
    if (!containers.length) return;

    if (!valid) {
      containers.forEach((container) => {
        container.innerHTML = '<div class="small" style="padding:8px;">Wolf requires exactly 4 players.</div>';
      });
      return;
    }
    const headerCells = Array.from({ length: REQUIRED_PLAYERS }, (_, p) =>
      `<td>${escapeHtml(names[p] || `P${p + 1}`)}</td>`
    ).join('');
    const totalCells = Array.from({ length: REQUIRED_PLAYERS }, (_, p) =>
      `<td>${Number.isFinite(totals[p]) ? totals[p] : '—'}</td>`
    ).join('');
    const playerCols = Array.from({ length: REQUIRED_PLAYERS }, () => '<col>').join('');
    const html = `
      <table class="live-results-table wolf-results-table" aria-label="Live Wolf results">
        <colgroup><col class="lr-col-label">${playerCols}</colgroup>
        <tbody>
          <tr class="live-results-title-row"><th colspan="${REQUIRED_PLAYERS + 1}">Totals</th></tr>
          <tr class="live-results-data-row"><td class="live-results-label">Player</td>${headerCells}</tr>
          <tr class="live-results-data-row"><td class="live-results-label">Points</td>${totalCells}</tr>
        </tbody>
      </table>
    `;
    containers.forEach((container) => {
      container.innerHTML = html;
    });
  }

  window.Wolf = Wolf;
})();
