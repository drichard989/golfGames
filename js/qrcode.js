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
   • qrcodejs (https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js)
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
    // Use built-in compression if available
    if (typeof CompressionStream !== 'undefined') {
      // Modern browsers - not widely supported yet
      return str;
    }
    
    // Simple run-length encoding for empty scores
    let compressed = str
      .replace(/,"s":\["","","","","","","","","","","","","","","","","",""\]/g, ',"s":[]')
      .replace(/,"s":\[\]/g, ',"s":0')
      .replace(/""/g, '0');
    
    return compressed;
  }

  /**
   * Decompress string
   */
  function decompressString(str) {
    // Reverse the compression
    let decompressed = str
      .replace(/"s":0/g, '"s":[]')
      .replace(/0/g, '""');
    
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
    
    // Basic compression: remove spaces and use shorter keys
    // For better compression, could use LZString or similar
    console.log('[QR] Data size:', json.length, 'bytes');
    
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
    if (typeof QRCode === 'undefined') {
      console.error('[QR] QRCode library not loaded from CDN');
      if (typeof window.announce === 'function') {
        window.announce('QR code functionality temporarily unavailable. Please check your internet connection and refresh.');
      } else {
        alert('QR code functionality temporarily unavailable. Please check your internet connection and refresh.');
      }
      return;
    }

    try {
      const data = compressData();
      
      // Check data size (QR codes have limits)
      if (data.length > 2953) { // Max for QR Code version 40 with byte mode
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

      // Generate QR code using qrcodejs library
      if (typeof QRCode !== 'undefined') {
        // Clear any existing QR code
        qrContainer.innerHTML = '';
        
        // Generate new QR code
        new QRCode(qrContainer, {
          text: data,
          width: 256,
          height: 256,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
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
            console.log('[QR] Code detected:', code.data.substring(0, 50) + '...');
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
        stream.getTracks().forEach(track => track.stop());
      }
    }

    closeBtn.onclick = () => {
      stopCamera();
      modal.remove();
    };
  }

  // ============================================================================
  // URL-BASED SHARING
  // ============================================================================

  /**
   * Generate shareable URL with scorecard data
   */
  function generateShareLink() {
    try {
      const data = compressData();
      const compressed = compressString(data);
      
      // Encode data for URL - use encodeURIComponent for better compatibility
      const encoded = encodeURIComponent(compressed);
      
      // Create URL with hash parameter
      const baseUrl = window.location.origin + window.location.pathname;
      const shareUrl = `${baseUrl}#i=${encoded}`;
      
      console.log('[QR] Share link length:', shareUrl.length);
      
      // Copy to clipboard
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => {
          if (typeof window.announce === 'function') {
            window.announce('Share link copied to clipboard!');
          }
        }).catch(err => {
          console.error('[QR] Clipboard write failed:', err);
          showUrlDialog(shareUrl);
        });
      } else {
        showUrlDialog(shareUrl);
      }
      
      console.log('[QR] Share link generated:', shareUrl.substring(0, 100) + '...');
    } catch (err) {
      console.error('[QR] Failed to generate share link:', err);
      if (typeof window.announce === 'function') {
        window.announce('Failed to generate share link');
      }
    }
  }

  /**
   * Show dialog with share URL for manual copying
   */
  function showUrlDialog(url) {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
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
      max-width: 500px;
      width: 100%;
    `;

    const title = document.createElement('h2');
    title.textContent = 'Share Link';
    title.style.cssText = 'margin: 0 0 16px 0; color: #333;';

    const instructions = document.createElement('p');
    instructions.textContent = 'Copy this link to share:';
    instructions.style.cssText = 'color: #666; font-size: 14px; margin: 8px 0;';

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.value = url;
    urlInput.readOnly = true;
    urlInput.style.cssText = `
      width: 100%;
      padding: 12px;
      border: 1px solid #ccc;
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      margin: 8px 0;
    `;
    urlInput.onclick = () => urlInput.select();

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = 'btn';
    closeBtn.style.cssText = 'margin-top: 16px;';
    closeBtn.onclick = () => modal.remove();

    container.appendChild(title);
    container.appendChild(instructions);
    container.appendChild(urlInput);
    container.appendChild(closeBtn);
    modal.appendChild(container);
    document.body.appendChild(modal);

    // Auto-select the URL
    urlInput.select();
  }

  /**
   * Check URL hash for import data on page load
   */
  function checkUrlForImport() {
    const hash = window.location.hash;
    
    // Support both new (#i=) and old (#import=) formats
    if (!hash.startsWith('#i=') && !hash.startsWith('#import=')) return;

    try {
      let decoded;
      
      if (hash.startsWith('#i=')) {
        // New compressed format
        const encoded = hash.substring(3); // Remove '#i='
        decoded = decodeURIComponent(encoded);
        decoded = decompressString(decoded);
      } else {
        // Old base64 format (backwards compatibility)
        const encoded = hash.substring(8); // Remove '#import='
        decoded = decodeURIComponent(atob(encoded));
      }
      
      console.log('[QR] Import data detected in URL');
      
      // Import the data
      importData(decoded);
      
      // Clear the hash to prevent re-import on refresh
      history.replaceState(null, '', window.location.pathname);
    } catch (err) {
      console.error('[QR] Failed to import from URL:', err);
      if (typeof window.announce === 'function') {
        window.announce('Failed to import scorecard from URL');
      }
    }
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
      
      console.log('[QR] Importing data:', data);

      // Confirm with user
      const playerCount = data.players.length;
      const courseName = window.COURSES?.[data.course]?.name || data.course;
      
      if (!confirm(`Import scorecard with ${playerCount} players from ${courseName}?`)) {
        return;
      }

      // Switch course if needed
      if (data.course !== window.ACTIVE_COURSE) {
        const courseSelect = document.getElementById('courseSelect');
        if (courseSelect) {
          courseSelect.value = data.course;
          courseSelect.dispatchEvent(new Event('change'));
        }
      }

      // Ensure we have enough player rows
      const currentRows = document.querySelectorAll('.player-row').length;
      if (playerCount > currentRows) {
        // Add more players
        for (let i = currentRows; i < playerCount; i++) {
          if (window.Scorecard?.player?.add) {
            window.Scorecard.player.add();
          }
        }
      } else if (playerCount < currentRows) {
        // Remove extra players
        for (let i = currentRows; i > playerCount; i--) {
          if (window.Scorecard?.player?.remove) {
            window.Scorecard.player.remove();
          }
        }
      }

      // Import player data
      const rows = document.querySelectorAll('.player-row');
      data.players.forEach((player, idx) => {
        const row = rows[idx];
        if (!row) return;

        const nameInput = row.querySelector('.name-edit');
        const chInput = row.querySelector('.ch-input');
        const scoreInputs = row.querySelectorAll('input.score-input');

        if (nameInput) {
          nameInput.value = player.name;
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        if (chInput) {
          chInput.value = player.ch;
          chInput.dispatchEvent(new Event('input', { bubbles: true }));
          chInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        player.scores.forEach((score, scoreIdx) => {
          if (scoreInputs[scoreIdx]) {
            scoreInputs[scoreIdx].value = score;
            scoreInputs[scoreIdx].dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
      });

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

      if (typeof window.announce === 'function') {
        window.announce('Scorecard imported successfully!');
      }

      console.log('[QR] Import complete');
    } catch (err) {
      console.error('[QR] Import failed:', err);
      if (typeof window.announce === 'function') {
        window.announce('Failed to import scorecard: ' + err.message);
      }
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  window.QRShare = {
    generate: generateQR,
    scan: scanQR,
    import: importData,
    generateShareLink: generateShareLink
  };

  // Check for import data in URL on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkUrlForImport);
  } else {
    // DOM already loaded, check immediately
    checkUrlForImport();
  }

  console.log('[QR] Module loaded');

})();
