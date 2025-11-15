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
  // IMAGE PASTE HANDLER
  // ============================================================================

  /**
   * Process QR code from image
   */
  async function processQRImage(imageFile, statusElement) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        try {
          // Create canvas to extract image data
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          // Decode QR code using jsQR
          if (typeof jsQR !== 'undefined') {
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: "dontInvert",
            });
            
            if (code) {
              resolve(code.data);
            } else {
              reject(new Error('No QR code found in image'));
            }
          } else {
            reject(new Error('QR decoder not available'));
          }
        } catch (err) {
          reject(err);
        }
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
      
      img.src = URL.createObjectURL(imageFile);
    });
  }

  /**
   * Initialize paste area and file upload for QR code images
   */
  function initPasteArea() {
    const pasteArea = document.getElementById('pasteArea');
    const pasteStatus = document.getElementById('pasteStatus');
    const uploadBtn = document.getElementById('uploadQRBtn');
    const fileInput = document.getElementById('qrImageUpload');
    
    if (!pasteArea || !pasteStatus) return;
    
    // Handle file upload (works reliably on iOS)
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => {
        fileInput.click();
      });
      
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        pasteStatus.textContent = '⏳ Processing QR code...';
        pasteStatus.style.color = 'var(--muted)';
        
        try {
          const qrData = await processQRImage(file, pasteStatus);
          
          pasteStatus.textContent = '✓ QR code detected! Importing...';
          pasteStatus.style.color = 'var(--accent)';
          
          setTimeout(() => {
            importData(qrData);
            pasteArea.innerHTML = '<span style="color: var(--accent); font-size: 13px;">✓ Successfully imported!</span>';
            pasteStatus.textContent = '✓ Scorecard imported successfully!';
            setTimeout(() => {
              pasteArea.innerHTML = '<span style="color: var(--muted); font-size: 13px;">Click and paste</span>';
              pasteStatus.textContent = '';
            }, 3000);
          }, 500);
        } catch (err) {
          console.error('[QR] Upload processing failed:', err);
          pasteStatus.textContent = '✗ ' + err.message + '. Try scanning with camera instead.';
          pasteStatus.style.color = 'var(--danger)';
        }
        
        // Reset file input
        fileInput.value = '';
      });
    }
    
    // Handle paste event (may not work on iOS)
    const handlePaste = async (e) => {
      e.preventDefault();
      
      const items = e.clipboardData?.items;
      if (!items) {
        pasteStatus.textContent = '✗ No clipboard data. Try "Upload QR Code Image" button instead.';
        pasteStatus.style.color = 'var(--danger)';
        return;
      }
      
      // Find image in clipboard
      let imageItem = null;
      for (let item of items) {
        if (item.type.indexOf('image') !== -1) {
          imageItem = item;
          break;
        }
      }
      
      if (!imageItem) {
        pasteStatus.textContent = '✗ No image in clipboard. Try "Upload QR Code Image" button instead.';
        pasteStatus.style.color = 'var(--danger)';
        return;
      }
      
      pasteStatus.textContent = '⏳ Processing QR code...';
      pasteStatus.style.color = 'var(--muted)';
      
      try {
        const blob = imageItem.getAsFile();
        const qrData = await processQRImage(blob, pasteStatus);
        
        pasteStatus.textContent = '✓ QR code detected! Importing...';
        pasteStatus.style.color = 'var(--accent)';
        
        setTimeout(() => {
          importData(qrData);
          pasteArea.innerHTML = '<span style="color: var(--accent); font-size: 13px;">✓ Successfully imported!</span>';
          setTimeout(() => {
            pasteArea.innerHTML = '<span style="color: var(--muted); font-size: 13px;">Click and paste</span>';
            pasteStatus.textContent = '';
          }, 3000);
        }, 500);
      } catch (err) {
        console.error('[QR] Paste processing failed:', err);
        pasteStatus.textContent = '✗ ' + err.message;
        pasteStatus.style.color = 'var(--danger)';
      }
    };
    
    // Add paste event listeners
    pasteArea.addEventListener('paste', handlePaste);
    document.addEventListener('paste', (e) => {
      // Only handle if utilities section is open
      const utilitiesSection = document.getElementById('utilitiesSection');
      if (utilitiesSection?.classList.contains('open')) {
        handlePaste(e);
      }
    });
    
    // Make paste area focusable
    pasteArea.addEventListener('click', () => {
      pasteArea.focus();
      pasteStatus.textContent = 'Ready to paste (Cmd/Ctrl+V) or use Upload button above.';
      pasteStatus.style.color = 'var(--muted)';
    });
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  window.QRShare = {
    generate: generateQR,
    scan: scanQR,
    import: importData,
    initPasteArea: initPasteArea
  };

  // Initialize paste area when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPasteArea);
  } else {
    initPasteArea();
  }

  console.log('[QR] Module loaded');

})();
