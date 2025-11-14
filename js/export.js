/* ============================================================================
   EXPORT MODULE
   ============================================================================
   
   Handles CSV and email export functionality for the golf scorecard.
   
   FEATURES:
   • CSV Export: Download current scorecard as CSV file
   • Email Export: Generate formatted email with scorecard and game results
   • Includes all active game results (Vegas, Skins, Junk, Hi-Lo)
   • Shows game options and settings for each active game
   
   EXPORTS:
   • exportCurrentScorecard() - Download CSV file
   • emailCurrentScorecard() - Open email client with formatted scorecard
   
   Exposed as: window.Export
   API: {exportCurrentScorecard, emailCurrentScorecard}
   
   ============================================================================
*/

(() => {
  'use strict';
  console.log('[Export] Module loaded');

  /**
   * Export current scorecard as CSV file
   * Includes player names, handicaps, and all hole scores
   */
  function exportCurrentScorecard() {
    const headers = ["player","ch", ...Array.from({length:18},(_,i)=>`h${i+1}`)];
    const playerRows = document.querySelectorAll(".player-row");
    const rows = [];
    
    playerRows.forEach(row => {
      const nameInput = row.querySelector(".name-edit");
      const chInput = row.querySelector(".ch-input");
      const scoreInputs = row.querySelectorAll("input.score-input");
      
      const playerName = nameInput?.value || "";
      const ch = chInput?.value || "0";
      const scores = Array.from(scoreInputs).map(inp => inp.value || "");
      
      rows.push([playerName, ch, ...scores]);
    });
    
    // Build CSV with proper escaping for names with commas
    const escapeCsvValue = (val) => {
      const str = String(val);
      if(str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    
    let csv = headers.join(",") + "\n";
    csv += rows.map(row => row.map(escapeCsvValue).join(",")).join("\n");
    
    const blob = new Blob([csv], {type:"text/csv"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    
    // Generate filename with date
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Get course name from global COURSES object
    const ACTIVE_COURSE = window.ACTIVE_COURSE || 'manito';
    const COURSES = window.COURSES || {};
    const courseName = COURSES[ACTIVE_COURSE]?.name.replace(/[^a-zA-Z0-9]/g, '_') || 'scorecard';
    a.download = `${courseName}_${dateStr}.csv`;
    
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    
    // Announce using global announce function if available
    if(typeof window.announce === 'function') {
      window.announce("Scorecard exported.");
    }
  }

  /**
   * Email current scorecard with game results
   * Generates formatted plain text email with:
   * - Scorecard table with all player scores
   * - Results from all active games (Vegas, Skins, Junk, Hi-Lo)
   * - Game options and settings for each active game
   */
  function emailCurrentScorecard() {
    console.log('[Export] emailCurrentScorecard called');
    const playerRows = document.querySelectorAll(".player-row");
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    
    // Get course name from globals
    const ACTIVE_COURSE = window.ACTIVE_COURSE || 'manito';
    const COURSES = window.COURSES || {};
    const courseName = COURSES[ACTIVE_COURSE]?.name || 'Golf Scorecard';
    
    // Helper function to pad strings for alignment
    const pad = (str, len) => String(str).padEnd(len, ' ');
    const padCenter = (str, len) => {
      const s = String(str);
      const totalPad = len - s.length;
      const leftPad = Math.floor(totalPad / 2);
      const rightPad = totalPad - leftPad;
      return ' '.repeat(leftPad) + s + ' '.repeat(rightPad);
    };
    
    // Build plain text table
    let textTable = `${courseName}\n`;
    textTable += `Date: ${dateStr}\n\n`;
    
    // Header row with dividers
    textTable += pad('Player', 15) + padCenter('CH', 4) + ' |';
    for(let h=1; h<=9; h++) {
      textTable += padCenter(String(h), 3);
    }
    textTable += '|';
    for(let h=10; h<=18; h++) {
      textTable += padCenter(String(h), 3);
    }
    textTable += '|' + padCenter('Out', 5) + '|' + padCenter('In', 5) + '|' + 'Total\n';
    
    // Separator line
    textTable += '-'.repeat(15 + 4 + 2 + (3*9) + 1 + (3*9) + 1 + 5 + 1 + 5 + 1 + 5) + '\n';
    
    // Player rows
    playerRows.forEach(row => {
      const nameInput = row.querySelector(".name-edit");
      const chInput = row.querySelector(".ch-input");
      const scoreInputs = row.querySelectorAll("input.score-input");
      
      const playerName = nameInput?.value || "Player";
      const ch = chInput?.value || "0";
      const scores = Array.from(scoreInputs).map(inp => inp.value || "-");
      
      // Calculate Out, In, Total
      const outScores = scores.slice(0, 9).map(s => s === "-" ? 0 : Number(s));
      const inScores = scores.slice(9, 18).map(s => s === "-" ? 0 : Number(s));
      const out = outScores.reduce((a, b) => a + b, 0) || 0;
      const inn = inScores.reduce((a, b) => a + b, 0) || 0;
      const total = out + inn || 0;
      
      textTable += pad(playerName.substring(0, 14), 15) + padCenter(ch, 4) + ' |';
      
      // Front 9
      for(let i=0; i<9; i++) {
        textTable += padCenter(scores[i], 3);
      }
      textTable += '|';
      
      // Back 9
      for(let i=9; i<18; i++) {
        textTable += padCenter(scores[i], 3);
      }
      
      textTable += '|' + padCenter(String(out || '-'), 5) + '|' + padCenter(String(inn || '-'), 5) + '|' + padCenter(String(total || '-'), 5) + '\n';
    });
    
    // Add game results sections
    let hasGames = false;
    console.log('[Export] Checking for active games...');
    
    // VEGAS RESULTS
    const vegasSection = document.getElementById('vegasSection');
    console.log('[Export] Vegas section:', vegasSection, 'Open:', vegasSection?.classList.contains('open'));
    if(vegasSection && vegasSection.classList.contains('open')) {
      hasGames = true;
      console.log('[Export] Adding Vegas results');
      textTable += '\n\n';
      textTable += '='.repeat(60) + '\n';
      textTable += 'VEGAS GAME RESULTS\n';
      textTable += '='.repeat(60) + '\n\n';
      
      // Vegas options
      const useNet = document.getElementById('optUseNet')?.checked;
      const doubleBirdie = document.getElementById('optDoubleBirdie')?.checked;
      const tripleEagle = document.getElementById('optTripleEagle')?.checked;
      const pointValue = Number(document.getElementById('vegasPointValue')?.value) || 1;
      
      textTable += 'Options:\n';
      textTable += `  • Use Net (NDB): ${useNet ? 'YES' : 'NO'}\n`;
      textTable += `  • Double on Birdie: ${doubleBirdie ? 'YES' : 'NO'}\n`;
      textTable += `  • Triple on Eagle: ${tripleEagle ? 'YES' : 'NO'}\n`;
      textTable += `  • Point Value: $${pointValue.toFixed(2)}\n\n`;
      
      // Vegas team assignments
      const vegasTeams = document.getElementById('vegasTeams');
      if(vegasTeams) {
        const teamInputs = vegasTeams.querySelectorAll('select');
        const teams = Array.from(teamInputs).map(sel => sel.value);
        textTable += 'Teams:\n';
        playerRows.forEach((row, idx) => {
          const name = row.querySelector('.name-edit')?.value || `Player ${idx+1}`;
          textTable += `  ${name}: Team ${teams[idx] || 'A'}\n`;
        });
        textTable += '\n';
      }
      
      // Vegas results
      const ptsA = document.getElementById('vegasPtsA')?.textContent || '0';
      const ptsB = document.getElementById('vegasPtsB')?.textContent || '0';
      const dollarA = document.getElementById('vegasDollarA')?.textContent || '$0.00';
      const dollarB = document.getElementById('vegasDollarB')?.textContent || '$0.00';
      
      textTable += 'Final Score:\n';
      textTable += `  Team A: ${ptsA} points (${dollarA})\n`;
      textTable += `  Team B: ${ptsB} points (${dollarB})\n`;
    }
    
    // SKINS RESULTS
    const skinsSection = document.getElementById('skinsSection');
    if(skinsSection && skinsSection.classList.contains('open')) {
      hasGames = true;
      textTable += '\n\n';
      textTable += '='.repeat(60) + '\n';
      textTable += 'SKINS GAME RESULTS\n';
      textTable += '='.repeat(60) + '\n\n';
      
      // Skins options
      const skinsCarry = document.getElementById('skinsCarry')?.checked ?? true;
      const skinsHalf = document.getElementById('skinsHalf')?.checked ?? false;
      const skinsBuyIn = Number(document.getElementById('skinsBuyIn')?.value) || 10;
      
      textTable += 'Options:\n';
      textTable += `  • Carry Over: ${skinsCarry ? 'YES' : 'NO'}\n`;
      textTable += `  • Half-Pops: ${skinsHalf ? 'YES' : 'NO'}\n`;
      textTable += `  • Buy-In: $${skinsBuyIn.toFixed(2)}\n\n`;
      
      // Calculate total pot
      const activePlayers = playerRows.length;
      const totalPot = skinsBuyIn * activePlayers;
      textTable += `Total Pot: $${totalPot.toFixed(2)}\n\n`;
      textTable += 'Player Winnings:\n';
      
      playerRows.forEach((row, idx) => {
        const name = row.querySelector('.name-edit')?.value || `Player ${idx+1}`;
        // Use 0-based index for skins IDs
        const count = document.getElementById(`skinsTotal${idx}`)?.textContent || '0';
        const winnings = document.getElementById(`skinsWinnings${idx}`)?.textContent || '—';
        textTable += `  ${pad(name, 20)} ${count} skins - ${winnings}\n`;
      });
    }
    
    // JUNK (DOTS) RESULTS
    const junkSection = document.getElementById('junkSection');
    if(junkSection && junkSection.classList.contains('open')) {
      hasGames = true;
      textTable += '\n\n';
      textTable += '='.repeat(60) + '\n';
      textTable += 'JUNK (DOTS) GAME RESULTS\n';
      textTable += '='.repeat(60) + '\n\n';
      
      // Junk options
      const junkUseNet = document.getElementById('junkUseNet')?.checked ?? false;
      
      textTable += 'Options:\n';
      textTable += `  • Use Net Scoring: ${junkUseNet ? 'YES' : 'NO'}\n\n`;
      
      textTable += 'Scoring:\n';
      textTable += '  • Eagle: 4 dots\n';
      textTable += '  • Birdie: 2 dots\n';
      textTable += '  • Par: 1 dot\n';
      textTable += '  • Achievements: Bonus points (Sandy, Hogan, etc.)\n\n';
      
      // Total Dots Summary
      textTable += 'TOTAL DOTS:\n';
      playerRows.forEach((row, idx) => {
        const name = row.querySelector('.name-edit')?.value || `Player ${idx+1}`;
        const totalDots = document.getElementById(`junkTotP${idx+1}`)?.textContent?.trim() || '0';
        textTable += `  ${pad(name, 20)} ${totalDots} dots\n`;
      });
      
      // Hole-by-Hole Breakdown
      textTable += '\n\nHOLE-BY-HOLE BREAKDOWN:\n';
      textTable += '-'.repeat(60) + '\n';
      
      playerRows.forEach((row, idx) => {
        const name = row.querySelector('.name-edit')?.value || `Player ${idx+1}`;
        textTable += `\n${name}:\n`;

        // Get hole-by-hole data from junkBody
        const junkBody = document.getElementById('junkBody');
        if(junkBody) {
          const holes = junkBody.querySelectorAll('tr');
          let holeData = [];

          holes.forEach((holeRow, holeIdx) => {
            const cell = holeRow.children[idx + 1]; // +1 to skip hole number column
            if(cell) {
              const dotSpan = cell.querySelector('.junk-dot');
              const achLabels = cell.querySelector('.junk-ach-labels');
              const dots = dotSpan?.textContent?.trim() || cell.textContent?.trim() || '—';

              // Get achievement labels if present
              let scoreType = '';
              let achievements = [];

              if(achLabels && achLabels.innerHTML) {
                // Extract text from the labels div, replacing <br> with commas
                const labelText = achLabels.innerHTML.replace(/<br\s*\/?\>/gi, ', ');
                const labels = labelText.split(',').map(l => l.trim()).filter(l => l);

                // First label is usually the score type (Eagle, Birdie, Par)
                const scoreTypes = ['Eagle', 'Net Eagle', 'Birdie', 'Net Birdie', 'Par', 'Net Par'];
                if(labels.length > 0 && scoreTypes.includes(labels[0])) {
                  scoreType = labels[0];
                  achievements = labels.slice(1);
                } else {
                  achievements = labels;
                }
              }

              // If no scoreType found, try to get it from the cell text (fallback)
              if (!scoreType) {
                // Try to find a score type in the cell text
                const cellText = cell.textContent || '';
                const scoreTypes = ['Eagle', 'Net Eagle', 'Birdie', 'Net Birdie', 'Par', 'Net Par'];
                for (const st of scoreTypes) {
                  if (cellText.includes(st)) {
                    scoreType = st;
                    break;
                  }
                }
              }

              if(dots !== '—' && dots !== '0') {
                holeData.push({
                  hole: holeIdx + 1,
                  dots: dots,
                  scoreType: scoreType,
                  achievements: achievements
                });
              }
            }
          });

          // Format output
          if(holeData.length === 0) {
            textTable += '  No dots scored\n';
          } else {
            holeData.forEach(data => {
              let line = `  Hole ${pad(String(data.hole), 2)}: ${data.dots} dot${data.dots === '1' ? '' : 's'}`;

              // Always show score type if available, otherwise show (Par) as fallback
              if(data.scoreType) {
                line += ` (${data.scoreType})`;
              } else {
                line += ' (Par)';
              }

              // Add achievements if any
              if(data.achievements.length > 0) {
                line += ` - ${data.achievements.join(', ')}`;
              }

              textTable += line + '\n';
            });
          }
        }
      });
    }
    
    // HI-LO RESULTS
    const hiloSection = document.getElementById('hiloSection');
    if(hiloSection && hiloSection.classList.contains('open')) {
      hasGames = true;
      textTable += '\n\n';
      textTable += '='.repeat(60) + '\n';
      textTable += 'HI-LO GAME RESULTS\n';
      textTable += '='.repeat(60) + '\n\n';

      // Hi-Lo options
      const hiloUnitValue = Number(document.getElementById('hiloUnitValue')?.value) || 10;

      textTable += 'Format:\n';
      textTable += '  • Front 9: 1 unit\n';
      textTable += '  • Back 9: 1 unit\n';
      textTable += '  • Full 18: 2 units\n';
      textTable += '  • Auto-press on 2-0 hole wins\n\n';

      // Hi-Lo teams
      const teamA = document.getElementById('hiloTeamA')?.textContent?.trim() || '';
      const teamB = document.getElementById('hiloTeamB')?.textContent?.trim() || '';
      if (teamA || teamB) {
        textTable += 'Teams:\n';
        if (teamA) textTable += `  ${teamA}\n`;
        if (teamB) textTable += `  ${teamB}\n`;
        textTable += '\n';
      }

      // Hi-Lo team results table
      const hiloResultsBody = document.getElementById('hiloResultsBody');
      if (hiloResultsBody) {
        textTable += 'Team Results:\n';
        // Get header row from hiloTable
        const hiloTable = document.getElementById('hiloTable');
        let totalUnitsA = 0, totalUnitsB = 0;
        if (hiloTable) {
          const headerCells = hiloTable.querySelectorAll('thead tr th');
          const headers = Array.from(headerCells).map(th => th.textContent.trim());
          textTable += '  ' + headers.join(' | ') + '\n';
        }
        // Get each row
        const rows = hiloResultsBody.querySelectorAll('tr');
        rows.forEach((tr, idx) => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
          textTable += '  ' + cells.join(' | ') + '\n';
          // Track total units from the Total Units row
          if (cells[0] && cells[0].toLowerCase().includes('total units')) {
            // Try to parse the numbers for A and B
            totalUnitsA = parseInt(cells[1], 10) || 0;
            totalUnitsB = parseInt(cells[2], 10) || 0;
          }
        });
        // Add a clear summary line for total units
        textTable += `\n  Total Units: Team A = ${totalUnitsA}, Team B = ${totalUnitsB}\n`;
        if (totalUnitsA > totalUnitsB) {
          textTable += `  Winner: Team A (+${totalUnitsA - totalUnitsB} units)\n`;
        } else if (totalUnitsB > totalUnitsA) {
          textTable += `  Winner: Team B (+${totalUnitsB - totalUnitsA} units)\n`;
        } else {
          textTable += '  Result: Tie\n';
        }
        textTable += '\n';
      }

      // Hi-Lo hole-by-hole results table
      const hiloHoleBody = document.getElementById('hiloHoleBody');
      if (hiloHoleBody) {
        textTable += 'Hole-by-Hole Results:\n';
        // Get header row from hiloHoleTable
        const hiloHoleTable = document.getElementById('hiloHoleTable');
        if (hiloHoleTable) {
          const headerCells = hiloHoleTable.querySelectorAll('thead tr th');
          const headers = Array.from(headerCells).map(th => th.textContent.trim());
          textTable += '  ' + headers.join(' | ') + '\n';
        }
        // Get each row
        const rows = hiloHoleBody.querySelectorAll('tr');
        rows.forEach(tr => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
          textTable += '  ' + cells.join(' | ') + '\n';
        });
        textTable += '\n';
      }
    }
    
    // Footer
    if(hasGames) {
      textTable += '\n' + '='.repeat(60) + '\n';
    }
    textTable += '\n---\nGenerated from Golf Scorecard App';
    
    // Create mailto link with plain text body
    const subject = encodeURIComponent(`${courseName} - ${dateStr}`);
    const body = encodeURIComponent(textTable);
    
    // Open email client with mailto link
    const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
    window.location.href = mailtoLink;
    
    // Announce using global announce function if available
    if(typeof window.announce === 'function') {
      window.announce("Opening email client...");
    }
  }

  // Expose module globally
  window.Export = {
    exportCurrentScorecard,
    emailCurrentScorecard
  };
  
  console.log('[Export] Module exposed to window.Export:', window.Export);

})();
