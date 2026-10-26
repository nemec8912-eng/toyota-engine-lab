import './styles.css';
import { Viewer } from './scene/viewer';
import { Cluster } from './ui/cluster';
import { App } from './ui/app';
import { startScenario } from './sim/scenarios';
import { log } from './core/bus';
import { sim } from './sim/engine';
import { store } from './core/store';

declare const __BUILD__: string;

const viewer = new Viewer(document.getElementById('viewport')!);
new Cluster(document.getElementById('cluster') as HTMLCanvasElement);
new App(viewer);
startScenario(null);
log(`Toyota Engine Lab, сборка ${__BUILD__}. Включите зажигание ключом (ON), удерживайте START для запуска.`);

// Подсказка исчезает после первого взаимодействия
const hint = document.getElementById('hintOverlay');
document.getElementById('viewport')!.addEventListener('pointerdown', () => { if (hint) hint.style.opacity = '0'; }, { once: true });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Для отладки из консоли
(window as any).lab = { viewer, sim, store, startScenario };
