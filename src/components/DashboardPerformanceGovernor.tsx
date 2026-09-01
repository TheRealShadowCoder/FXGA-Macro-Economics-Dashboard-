import { useEffect } from 'react';

type QualityTier = 'safe' | 'lite' | 'balanced' | 'high' | 'ultra';
type DeviceProfile = 'mobile' | 'standard' | 'high';
type RuntimeHealth = 'healthy' | 'warm' | 'strained';

type NavigatorRuntime = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

const ORDER: QualityTier[] = ['safe', 'lite', 'balanced', 'high', 'ultra'];
const clampIndex = (value: number) => Math.max(0, Math.min(ORDER.length - 1, value));

function baseProfile(): { quality: QualityTier; profile: DeviceProfile; reduced: boolean; saveData: boolean } {
  const nav = navigator as NavigatorRuntime;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const saveData = nav.connection?.saveData === true;
  const cores = Number(nav.hardwareConcurrency || 4);
  const memory = Number(nav.deviceMemory || 4);
  const width = window.innerWidth;
  const touch = Number(nav.maxTouchPoints || 0) > 0;

  if (reduced || saveData) return { quality: 'safe', profile: touch || coarse ? 'mobile' : 'standard', reduced, saveData };
  if (coarse || width < 760 || (touch && width < 980)) {
    return { quality: cores <= 4 || memory <= 3 ? 'lite' : 'balanced', profile: 'mobile', reduced, saveData };
  }
  if (cores >= 12 && memory >= 8 && width >= 1440) return { quality: 'ultra', profile: 'high', reduced, saveData };
  if (cores >= 8 && memory >= 6 && width >= 1180) return { quality: 'high', profile: 'high', reduced, saveData };
  return { quality: 'balanced', profile: 'standard', reduced, saveData };
}

function publish(quality: QualityTier, profile: DeviceProfile, health: RuntimeHealth, reduced: boolean, saveData: boolean) {
  const root = document.documentElement;
  root.dataset.fxgaQuality = quality;
  root.dataset.fxgaProfile = profile;
  root.dataset.fxgaRuntimeHealth = health;
  root.dataset.fxgaReducedMotion = reduced ? 'true' : 'false';
  root.dataset.fxgaSaveData = saveData ? 'true' : 'false';

  const index = ORDER.indexOf(quality);
  const motion = quality === 'safe' ? 0 : quality === 'lite' ? 0.45 : quality === 'balanced' ? 0.72 : quality === 'high' ? 0.9 : 1;
  const particles = quality === 'safe' ? 0 : quality === 'lite' ? 0.2 : quality === 'balanced' ? 0.45 : quality === 'high' ? 0.7 : 1;
  const blur = quality === 'safe' ? 0.25 : quality === 'lite' ? 0.45 : quality === 'balanced' ? 0.68 : quality === 'high' ? 0.85 : 1;
  const dpr = Math.min(window.devicePixelRatio || 1, quality === 'ultra' ? 2 : quality === 'high' ? 1.75 : quality === 'balanced' ? 1.5 : 1.2);

  root.style.setProperty('--fxga-quality-index', String(index));
  root.style.setProperty('--fxga-motion-scale', String(motion));
  root.style.setProperty('--fxga-particle-scale', String(particles));
  root.style.setProperty('--fxga-blur-scale', String(blur));
  root.style.setProperty('--fxga-dpr-cap', String(dpr));
}

export function DashboardPerformanceGovernor() {
  useEffect(() => {
    let current = baseProfile();
    let qualityIndex = ORDER.indexOf(current.quality);
    let health: RuntimeHealth = 'healthy';
    let healthySamples = 0;
    let longTasks = 0;
    let stopped = false;
    let observer: PerformanceObserver | null = null;
    let interactionTimer = 0;
    let resizeTimer = 0;

    const apply = () => publish(ORDER[clampIndex(qualityIndex)], current.profile, health, current.reduced, current.saveData);
    apply();

    const markInteraction = () => {
      document.documentElement.dataset.fxgaInteracting = 'true';
      window.clearTimeout(interactionTimer);
      interactionTimer = window.setTimeout(() => { delete document.documentElement.dataset.fxgaInteracting; }, 220);
    };

    const downgrade = () => {
      qualityIndex = clampIndex(qualityIndex - 1);
      health = qualityIndex <= 1 ? 'strained' : 'warm';
      healthySamples = 0;
      apply();
    };

    const sampleFps = () => {
      if (stopped || document.hidden || current.reduced || current.saveData) return;
      let frames = 0;
      const started = performance.now();
      const tick = (stamp: number) => {
        if (stopped || document.hidden) return;
        frames += 1;
        const elapsed = stamp - started;
        if (elapsed < 1100) { requestAnimationFrame(tick); return; }
        const fps = frames / (elapsed / 1000);
        const lowThreshold = current.profile === 'mobile' ? 42 : 48;
        if (fps < lowThreshold || longTasks >= 3) {
          downgrade();
        } else {
          health = fps < 55 ? 'warm' : 'healthy';
          healthySamples += 1;
          const base = baseProfile();
          const ceiling = ORDER.indexOf(base.quality);
          if (healthySamples >= 3 && qualityIndex < ceiling) {
            qualityIndex += 1;
            healthySamples = 0;
          }
          apply();
        }
        longTasks = 0;
      };
      requestAnimationFrame(tick);
    };

    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (entry.duration >= 50) longTasks += 1;
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch { observer = null; }

    const onVisibility = () => {
      document.documentElement.dataset.fxgaHidden = document.hidden ? 'true' : 'false';
      if (!document.hidden) window.setTimeout(sampleFps, 650);
    };
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const next = baseProfile();
        current = next;
        qualityIndex = Math.min(qualityIndex, ORDER.indexOf(next.quality));
        apply();
      }, 180);
    };

    window.addEventListener('pointermove', markInteraction, { passive: true });
    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('touchstart', markInteraction, { passive: true });
    window.addEventListener('scroll', markInteraction, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);

    const initial = window.setTimeout(sampleFps, 900);
    const followup = window.setTimeout(sampleFps, 12_000);

    return () => {
      stopped = true;
      window.clearTimeout(initial);
      window.clearTimeout(followup);
      window.clearTimeout(interactionTimer);
      window.clearTimeout(resizeTimer);
      observer?.disconnect();
      window.removeEventListener('pointermove', markInteraction);
      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('touchstart', markInteraction);
      window.removeEventListener('scroll', markInteraction);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
