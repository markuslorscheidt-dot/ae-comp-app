// Demo-Daten Index - Exportiert alle Demo-Daten
export { DEMO_USERS, DEMO_MANAGER, ALL_DEMO_USERS } from './users';
export { DEMO_SETTINGS, DEMO_SETTINGS_ARRAY } from './settings';
export { DEMO_GO_LIVES_75, DEMO_GO_LIVES_MAP_75 } from './scenario-75';
export { DEMO_GO_LIVES_100, DEMO_GO_LIVES_MAP_100 } from './scenario-100';
export { DEMO_GO_LIVES_120, DEMO_GO_LIVES_MAP_120 } from './scenario-120';
export { DEMO_CHALLENGES, DEMO_ACTIVE_CHALLENGES, DEMO_HISTORY_CHALLENGES } from './challenges';
export { useDemoData, isDemoScenario, type DemoScenario, type DataSource } from './useDemoData';

// Szenario Labels
export const SCENARIO_LABELS = {
  'production': { label: 'Produktion', icon: '🔴', color: 'red' },
  'demo-75': { label: 'Demo 75%', icon: '🟡', color: 'yellow' },
  'demo-100': { label: 'Demo 100%', icon: '🟢', color: 'green' },
  'demo-120': { label: 'Demo 120%', icon: '🚀', color: 'blue' },
} as const;
