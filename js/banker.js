/* ============================================================================
   BANKER GAME MODULE
   ============================================================================
   
   Placeholder for Banker game implementation
   Points-per-match with rotation or until-beaten modes
   
   Exposed as: window.Banker
   Methods: init, update (to be implemented)
   
   ============================================================================
*/

(() => {
  'use strict';
  console.log('[Banker] Module loaded (stub)');

  const Banker = {
    init() {
      console.log('[Banker] init() called - game not yet implemented');
      const section = document.getElementById('bankerSection');
      if (section) {
        const h2 = section.querySelector('h2');
        if (h2) h2.textContent = '🎲 Banker - Hello from separate file! (js/banker.js)';
      }
    },
    
    update() {
      console.log('[Banker] update() called - game not yet implemented');
    }
  };

  // Expose to global scope
  window.Banker = Banker;
  
  console.log('[Banker] Module initialized, exposed as window.Banker');

})();
