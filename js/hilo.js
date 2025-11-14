/* ============================================================================
   HI-LO GAME MODULE
   ============================================================================
   
   Placeholder for Hi-Lo game implementation
   
   Exposed as: window.HiLo
   Methods: init, update (to be implemented)
   
   ============================================================================
*/

(() => {
  'use strict';
  console.log('[HiLo] Module loaded (stub)');

  const HiLo = {
    init() {
      console.log('[HiLo] init() called - game not yet implemented');
      const section = document.getElementById('hiloSection');
      if (section) {
        const h2 = section.querySelector('h2');
        if (h2) h2.textContent = '🎯 Hi-Lo - Hello from separate file! (js/hilo.js)';
      }
    },
    
    update() {
      console.log('[HiLo] update() called - game not yet implemented');
    }
  };

  // Expose to global scope
  window.HiLo = HiLo;
  
  console.log('[HiLo] Module initialized, exposed as window.HiLo');

})();
