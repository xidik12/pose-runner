// TV entry — instantiates Game (which owns renderer, broker, UI overlays).
import { Game } from './engine/Game';

new Game();

// Surface unhandled errors to the user clearly so issues don't disappear silently
window.addEventListener('error', (e) => {
  console.error('[tv] unhandled error', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[tv] unhandled promise rejection', e.reason);
});
