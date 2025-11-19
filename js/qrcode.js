/* ============================================================================
   QR CODE SHARE & IMPORT MODULE
   ============================================================================
   
   Allows sharing scorecard data via QR code and importing via camera scan.
   Uses qrcodejs library (CDN) for generation and jsQR library (CDN) for scanning.
   
   FEATURES:
   • Generate QR code from current scorecard state
   • Camera-based QR code scanning
   • Data compression to fit in QR code
   • Validation and error handling
   
   DEPENDENCIES:
   • qrcode-generator (https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js)
   • jsQR (https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js)
   
   ============================================================================ */

(function() {
  'use strict';

  // ============================================================================
  // DATA COMPRESSION & ENCODING
  // ============================================================================

  /**
   * Simple LZ-based compression for URLs
   * Compresses repeated patterns to make URLs shorter
   */
  function compressString(str) {
    // More aggressive compression
    let compressed = str
      // Replace empty score arrays
      .replace(/,"s":\["","","","","","","","","","","","","","","","","",""\]/g, ',"s":9')
      .replace(/,"s":\[\]/g, ',"s":9')
      // Replace empty strings with single char
      .replace(/""/g, '-')
      // Remove unnecessary quotes around single digits
      .replace(/:"(\d)"/g, ':$1')
      // Shorten keys
      .replace(/"v":/g, 'v:')
      .replace(/"c":/g, 'c:')
      .replace(/"p":/g, 'p:')
      .replace(/"n":/g, 'n:')
      .replace(/"s":/g, 's:');
    
    return compressed;
  }

  /**
   * Decompress string
   */
  function decompressString(str) {
    // Reverse the compression
    let decompressed = str
      .replace(/v:/g, '"v":')
      .replace(/c:/g, '"c":')
      .replace(/p:/g, '"p":')
      .replace(/n:/g, '"n":')
      .replace(/s:/g, '"s":')
      .replace(/:(\d+)([,\}])/g, ':"$1"$2')
      .replace(/s:9/g, '"s":[]')
      .replace(/-/g, '""');
    
    return decompressed;
  }

  /**
   * Compress scorecard data for QR code or URL
   * Returns a compact JSON string
   */
  function compressData() {
    const players = Array.from(document.querySelectorAll('.player-row')).map(row => {
      const name = row.querySelector('.name-edit')?.value || '';
      const ch = row.querySelector('.ch-input')?.value || '0';
      const scores = Array.from(row.querySelectorAll('input.score-input')).map(inp => inp.value || '');
      return { n: name, c: ch, s: scores };
    });

    const course = window.ACTIVE_COURSE || 'manito';

    const data = {
      v: 1, // version
      c: course,
      p: players
    };

    // Convert to JSON and compress
    const json = JSON.stringify(data);
    
    return json;
  }

  /**
   * Decompress and validate QR code data
   */
  function decompressData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      
      // Validate structure
      if (!data.v || !data.c || !data.p || !Array.isArray(data.p)) {
        throw new Error('Invalid data structure');
      }

      return {
        version: data.v,
        course: data.c,
        players: data.p.map(p => ({
          name: p.n || '',
          ch: p.c || '0',
          scores: p.s || []
        }))
      };
    } catch (err) {
      console.error('[QR] Decompression failed:', err);
      throw new Error('Invalid QR code data');
    }
  }

  // ============================================================================
  // QR CODE GENERATION
  // ============================================================================

  /**
   * Generate QR code and display in modal
   */
  function generateQR() {
    // Check if QR code library is loaded
    if (typeof qrcode === 'undefined') {
      console.error('[QR] qrcode-generator library not loaded from CDN');
      if (typeof window.announce === 'function') {
        window.announce('QR code functionality temporarily unavailable. Please check your internet connection and refresh.');
      } else {
        alert('QR code functionality temporarily unavailable. Please check your internet connection and refresh.');
      }
      return;
    }

    try {
      const data = compressData();
      
      // qrcode-generator can handle large amounts of data
      if (data.length > 4000) {
        if (typeof window.announce === 'function') {
          window.announce('Scorecard data too large for QR code. Try removing some players or scores.');
        }
        return;
      }

      // Create modal
      const modal = document.createElement('div');
      modal.id = 'qrModal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 20px;
      `;

      const container = document.createElement('div');
      container.style.cssText = `
        background: white;
        padding: 24px;
        border-radius: 12px;
        max-width: 400px;
        text-align: center;
      `;

      const title = document.createElement('h2');
      title.textContent = 'Share Scorecard';
      title.style.cssText = 'margin: 0 0 16px 0; color: #333;';

      const qrContainer = document.createElement('div');
      qrContainer.id = 'qrCodeContainer';
      qrContainer.style.cssText = 'margin: 16px 0; padding: 16px; background: white;';

      const instructions = document.createElement('p');
      instructions.textContent = 'Scan this QR code with another device to import the scorecard';
      instructions.style.cssText = 'color: #666; font-size: 14px; margin: 16px 0;';

      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.className = 'btn';
      closeBtn.style.cssText = 'margin-top: 16px;';
      closeBtn.onclick = () => modal.remove();

      container.appendChild(title);
      container.appendChild(qrContainer);
      container.appendChild(instructions);
      container.appendChild(closeBtn);
      modal.appendChild(container);
      document.body.appendChild(modal);

      // Generate QR code using qrcode-generator library
      if (typeof qrcode !== 'undefined') {
        // Clear any existing QR code
        qrContainer.innerHTML = '';
        
        // Create QR code object
        const qr = qrcode(0, 'M'); // 0 = auto-detect version, 'M' = medium error correction
        qr.addData(data);
        qr.make();
        
        // Create image element with the QR code
        const size = 256;
        const cellSize = Math.floor(size / qr.getModuleCount());
        const actualSize = cellSize * qr.getModuleCount();
        
        const canvas = document.createElement('canvas');
        canvas.width = actualSize;
        canvas.height = actualSize;
        const ctx = canvas.getContext('2d');
        
        // Draw QR code on canvas
        for (let row = 0; row < qr.getModuleCount(); row++) {
          for (let col = 0; col < qr.getModuleCount(); col++) {
            ctx.fillStyle = qr.isDark(row, col) ? '#000000' : '#ffffff';
            ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
          }
        }
        
        qrContainer.appendChild(canvas);
      } else {
        qrContainer.innerHTML = '<p style="color: red;">QR Code library not loaded. Please refresh the page.</p>';
      }

      if (typeof window.announce === 'function') {
        window.announce('QR code generated');
      }
    } catch (err) {
      console.error('[QR] Generation failed:', err);
      if (typeof window.announce === 'function') {
        window.announce('Failed to generate QR code');
      }
    }
  }

  // ============================================================================
  // QR CODE SCANNING
  // ============================================================================

  /**
   * Open camera and scan for QR code
   */
  function scanQR() {
    // Check if jsQR library is loaded
    if (typeof jsQR === 'undefined') {
      console.error('[QR] jsQR library not loaded from CDN');
      if (typeof window.announce === 'function') {
        window.announce('QR code scanning temporarily unavailable. Please check your internet connection and refresh.');
      } else {
        alert('QR code scanning temporarily unavailable. Please check your internet connection and refresh.');
      }
      return;
    }

    // Create modal with video preview
    const modal = document.createElement('div');
    modal.id = 'scanModal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.95);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
    `;

    const container = document.createElement('div');
    container.style.cssText = `
      background: #1a1a1a;
      padding: 24px;
      border-radius: 12px;
      max-width: 500px;
      width: 100%;
      text-align: center;
    `;

    const title = document.createElement('h2');
    title.textContent = 'Scan QR Code';
    title.style.cssText = 'margin: 0 0 16px 0; color: white;';

    const video = document.createElement('video');
    video.id = 'qrVideo';
    video.style.cssText = 'width: 100%; max-width: 400px; border-radius: 8px; background: black;';
    video.setAttribute('playsinline', 'true');

    const canvas = document.createElement('canvas');
    canvas.id = 'qrCanvas';
    canvas.style.display = 'none';

    const instructions = document.createElement('p');
    instructions.textContent = 'Point your camera at a QR code';
    instructions.style.cssText = 'color: #aaa; font-size: 14px; margin: 16px 0;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Cancel';
    closeBtn.className = 'btn';
    closeBtn.style.cssText = 'margin-top: 16px;';

    container.appendChild(title);
    container.appendChild(video);
    container.appendChild(canvas);
    container.appendChild(instructions);
    container.appendChild(closeBtn);
    modal.appendChild(container);
    document.body.appendChild(modal);

    let stream = null;
    let scanning = false;

    // Start camera
    navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'environment' } // Use back camera on mobile
    })
    .then(mediaStream => {
      stream = mediaStream;
      video.srcObject = stream;
      video.play();
      scanning = true;
      scanFrame();
    })
    .catch(err => {
      console.error('[QR] Camera access failed:', err);
      instructions.textContent = 'Camera access denied. Please enable camera permissions.';
      instructions.style.color = 'red';
    });
    
    // Store cleanup function globally so it can be called from anywhere
    window.__qrCameraCleanup = () => {
      stopCamera();
    };

    // Scan for QR codes in video frames
    function scanFrame() {
      if (!scanning) return;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Use jsQR library to decode
        if (window.jsQR) {
          const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (code) {
            scanning = false;
            stopCamera();
            importData(code.data);
            modal.remove();
            return;
          }
        }
      }

      requestAnimationFrame(scanFrame);
    }

    function stopCamera() {
      scanning = false;
      if (stream) {
        stream.getTracks().forEach(track => {
          track.stop();
        });
        stream = null;
      }
      if (video.srcObject) {
        video.srcObject = null;
      }
      // Clean up global reference
      if (window.__qrCameraCleanup) {
        delete window.__qrCameraCleanup;
      }
    }

    closeBtn.onclick = () => {
      stopCamera();
      modal.remove();
    };
  }

  // ============================================================================
  // DATA IMPORT
  // ============================================================================

  /**
   * Import data from QR code scan or URL
   */
  function importData(jsonString) {
    try {
      const data = decompressData(jsonString);

      const playerCount = data.players.length;
      const courseName = window.COURSES?.[data.course]?.name || data.course;
      const currentRowCount = document.querySelectorAll('#scorecardFixed .player-row').length;
      
      // Show import options modal
      showImportModal(playerCount, courseName, currentRowCount, (mode) => {
        if (!mode) return; // User cancelled
        
        try {
          // Switch course if needed
          if (data.course !== window.ACTIVE_COURSE) {
            const courseSelect = document.getElementById('courseSelect');
            if (courseSelect) {
              courseSelect.value = data.course;
              courseSelect.dispatchEvent(new Event('change'));
            }
          }

          if (mode === 'replace') {
            // REPLACE MODE: Clear existing and set to exact count
            const currentRows = document.querySelectorAll('#scorecardFixed .player-row').length;
            
            // Remove all existing players
            while (document.querySelectorAll('#scorecardFixed .player-row').length > 0) {
              if (window.Scorecard?.player?.remove) {
                window.Scorecard.player.remove();
              } else {
                break;
              }
            }
            
            // Add exact number needed
            for (let i = 0; i < playerCount; i++) {
              if (window.Scorecard?.player?.add) {
                window.Scorecard.player.add();
              }
            }
            
            // Import all players starting at index 0
            const rows = document.querySelectorAll('#scorecardFixed .player-row');
            data.players.forEach((player, idx) => {
              const row = rows[idx];
              if (!row) return;

              const nameInput = row.querySelector('.name-edit');
              const chInput = row.querySelector('.ch-input');
              const scoreRow = document.querySelectorAll('#scorecard .player-row')[idx];
              const scoreInputs = scoreRow?.querySelectorAll('input.score-input');

              if (nameInput) {
                nameInput.value = player.name;
                nameInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
              
              if (chInput) {
                chInput.value = player.ch;
                chInput.dispatchEvent(new Event('input', { bubbles: true }));
                chInput.dispatchEvent(new Event('change', { bubbles: true }));
              }
              
              if (scoreInputs) {
                player.scores.forEach((score, scoreIdx) => {
                  if (scoreInputs[scoreIdx]) {
                    scoreInputs[scoreIdx].value = score;
                    scoreInputs[scoreIdx].dispatchEvent(new Event('input', { bubbles: true }));
                  }
                });
              }
            });
          } else if (mode === 'add') {
            // ADD MODE: Append to existing players
            const currentRows = document.querySelectorAll('#scorecardFixed .player-row').length;
            
            // Add new player rows
            for (let i = 0; i < playerCount; i++) {
              if (window.Scorecard?.player?.add) {
                window.Scorecard.player.add();
              }
            }
            
            // Import players starting after existing ones
            const allRows = document.querySelectorAll('#scorecardFixed .player-row');
            data.players.forEach((player, idx) => {
              const rowIndex = currentRows + idx;
              const row = allRows[rowIndex];
              if (!row) return;

              const nameInput = row.querySelector('.name-edit');
              const chInput = row.querySelector('.ch-input');
              const allScoreRows = document.querySelectorAll('#scorecard .player-row');
              const scoreRow = allScoreRows[rowIndex];
              const scoreInputs = scoreRow?.querySelectorAll('input.score-input');

              if (nameInput) {
                nameInput.value = player.name;
                nameInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
              
              if (chInput) {
                chInput.value = player.ch;
                chInput.dispatchEvent(new Event('input', { bubbles: true }));
                chInput.dispatchEvent(new Event('change', { bubbles: true }));
              }
              
              if (scoreInputs) {
                player.scores.forEach((score, scoreIdx) => {
                  if (scoreInputs[scoreIdx]) {
                    scoreInputs[scoreIdx].value = score;
                    scoreInputs[scoreIdx].dispatchEvent(new Event('input', { bubbles: true }));
                  }
                });
              }
            });
          }

          // Recalculate everything - full recalc of scorecard AND all games
          if (window.Scorecard?.calc?.recalcAll) {
            window.Scorecard.calc.recalcAll();
          }
          
          // Update stroke highlights (this might be separate from recalcAll)
          if (window.updateStrokeHighlights) {
            window.updateStrokeHighlights();
          }
          
          // Recalculate all game modules
          if (window.AppManager?.recalcGames) {
            window.AppManager.recalcGames();
          }
          
          // Update player count display
          if (window.Scorecard?.player?.updateCountDisplay) {
            window.Scorecard.player.updateCountDisplay();
          }
          
          // Sync player overlay if needed
          if (window.Scorecard?.player?.syncOverlay) {
            window.Scorecard.player.syncOverlay();
          }

          // Save to localStorage
          if (window.Storage?.save) {
            window.Storage.save();
          }

          const finalCount = document.querySelectorAll('#scorecardFixed .player-row').length;
          if (typeof window.announce === 'function') {
            window.announce(`Scorecard imported! ${finalCount} player${finalCount !== 1 ? 's' : ''} total.`);
          }
        } catch (err) {
          console.error('[QR] Import processing failed:', err);
          if (typeof window.announce === 'function') {
            window.announce('Failed to process import: ' + err.message);
          }
        }
      });
    } catch (err) {
      console.error('[QR] Import failed:', err);
      if (typeof window.announce === 'function') {
        window.announce('Failed to import scorecard: ' + err.message);
      }
    }
  }

  /**
   * Show modal asking user how to import: Add or Replace
   */
  function showImportModal(playerCount, courseName, currentCount, callback) {
    // Detect if light theme is active
    const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';
    
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: ${isLightTheme ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.85)'};
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
    `;

    const container = document.createElement('div');
    container.style.cssText = `
      background: var(--panel, #1a1a1a);
      border: 1px solid var(--line, #333);
      padding: 28px;
      border-radius: 12px;
      max-width: 480px;
      width: 100%;
      box-shadow: ${isLightTheme ? '0 8px 32px rgba(0, 0, 0, 0.15)' : '0 8px 32px rgba(0, 0, 0, 0.4)'};
    `;

    const title = document.createElement('h2');
    title.textContent = 'Import Scorecard';
    title.style.cssText = `
      margin: 0 0 16px 0;
      color: var(--ink, white);
      font-size: 22px;
      text-align: center;
    `;

    const info = document.createElement('div');
    info.style.cssText = `
      color: var(--muted, #aaa);
      font-size: 15px;
      margin-bottom: 24px;
      line-height: 1.6;
      text-align: center;
    `;
    info.innerHTML = `
      <p style="margin: 0 0 8px 0;"><strong style="color: var(--ink, white);">${playerCount} player${playerCount !== 1 ? 's' : ''}</strong> from <strong style="color: var(--ink, white);">${courseName}</strong></p>
      ${currentCount > 0 ? `<p style="margin: 8px 0 0 0; font-size: 14px;">Currently ${currentCount} player${currentCount !== 1 ? 's' : ''} in scorecard</p>` : ''}
    `;

    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = `
      display: flex;
      gap: 12px;
      flex-direction: column;
    `;

    const addBtn = document.createElement('button');
    addBtn.className = 'btn qr-import-add-btn';
    addBtn.innerHTML = `
      <div style="text-align: left;">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">➕ Add Players</div>
        <div style="font-size: 13px; opacity: 0.8;">Keep existing ${currentCount} player${currentCount !== 1 ? 's' : ''}, add ${playerCount} more (total: ${currentCount + playerCount})</div>
      </div>
    `;
    addBtn.style.cssText = `
      padding: 16px 20px;
      background: var(--panel-alt, #252525);
      border: 2px solid var(--accent, #68d391);
      color: var(--ink, white);
      border-radius: 10px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
      text-align: left;
      width: 100%;
    `;
    
    // Store original colors for hover
    const addBtnOriginalBg = getComputedStyle(document.documentElement).getPropertyValue('--panel-alt').trim() || '#252525';
    const addBtnHoverBg = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#68d391';
    const addBtnOriginalColor = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || 'white';
    
    addBtn.onmouseover = () => {
      addBtn.style.background = addBtnHoverBg;
      addBtn.style.color = isLightTheme ? '#ffffff' : '#000000';
    };
    addBtn.onmouseout = () => {
      addBtn.style.background = addBtnOriginalBg;
      addBtn.style.color = addBtnOriginalColor;
    };

    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'btn qr-import-replace-btn';
    replaceBtn.innerHTML = `
      <div style="text-align: left;">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">🔄 Replace All</div>
        <div style="font-size: 13px; opacity: 0.8;">${currentCount > 0 ? `Clear all ${currentCount} player${currentCount !== 1 ? 's' : ''}, ` : ''}import ${playerCount} player${playerCount !== 1 ? 's' : ''} (total: ${playerCount})</div>
      </div>
    `;
    replaceBtn.style.cssText = `
      padding: 16px 20px;
      background: var(--panel-alt, #252525);
      border: 2px solid var(--line, #333);
      color: var(--ink, white);
      border-radius: 10px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
      text-align: left;
      width: 100%;
    `;
    
    const replaceBtnOriginalBg = getComputedStyle(document.documentElement).getPropertyValue('--panel-alt').trim() || '#252525';
    const replaceBtnHoverBg = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#1a1a1a';
    
    replaceBtn.onmouseover = () => {
      replaceBtn.style.borderColor = addBtnHoverBg;
      replaceBtn.style.background = replaceBtnHoverBg;
    };
    replaceBtn.onmouseout = () => {
      replaceBtn.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#333';
      replaceBtn.style.background = replaceBtnOriginalBg;
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn qr-import-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      padding: 12px 20px;
      background: transparent;
      border: 1px solid var(--line, #333);
      color: var(--muted, #aaa);
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
      margin-top: 8px;
    `;
    cancelBtn.onmouseover = () => {
      cancelBtn.style.background = replaceBtnOriginalBg;
    };
    cancelBtn.onmouseout = () => {
      cancelBtn.style.background = 'transparent';
    };

    addBtn.onclick = () => {
      // Clean up camera if it's still active
      if (typeof window.__qrCameraCleanup === 'function') {
        window.__qrCameraCleanup();
      }
      modal.remove();
      callback('add');
    };

    replaceBtn.onclick = () => {
      // Clean up camera if it's still active
      if (typeof window.__qrCameraCleanup === 'function') {
        window.__qrCameraCleanup();
      }
      modal.remove();
      callback('replace');
    };

    cancelBtn.onclick = () => {
      // Ensure camera is fully stopped if it was active
      if (typeof window.__qrCameraCleanup === 'function') {
        window.__qrCameraCleanup();
      }
      modal.remove();
      callback(null);
    };

    buttonsContainer.appendChild(addBtn);
    buttonsContainer.appendChild(replaceBtn);
    buttonsContainer.appendChild(cancelBtn);

    container.appendChild(title);
    container.appendChild(info);
    container.appendChild(buttonsContainer);
    modal.appendChild(container);
    document.body.appendChild(modal);
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  // Wait for QRCode library to load before exposing API
  function waitForLibrary() {
    // Check silently
  }

  // Check immediately
  waitForLibrary();

  // Also check after a short delay in case library loads after this module
  setTimeout(waitForLibrary, 100);

  window.QRShare = {
    generate: generateQR,
    scan: scanQR,
    import: importData
  };

})();
