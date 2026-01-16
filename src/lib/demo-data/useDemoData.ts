// Demo Data Hook - Liefert Demo-Daten wenn Demo-Modus aktiv
import { useMemo } from 'react';
import { User, GoLive, AESettings, Challenge } from '../types';
import { 
  DEMO_USERS, 
  DEMO_MANAGER,
  ALL_DEMO_USERS,
} from './users';
import { DEMO_SETTINGS } from './settings';
import { DEMO_CHALLENGES } from './challenges';
import { DEMO_GO_LIVES_MAP_75 } from './scenario-75';
import { DEMO_GO_LIVES_MAP_100 } from './scenario-100';
import { DEMO_GO_LIVES_MAP_120 } from './scenario-120';

// Typen
export type DemoScenario = 'demo-75' | 'demo-100' | 'demo-120';
export type DataSource = 'production' | DemoScenario;

// Helper um zu prüfen ob ein DataSource ein Demo-Szenario ist
export function isDemoScenario(source: DataSource): source is DemoScenario {
  return source !== 'production';
}

// Helper um Go-Lives für Szenario zu bekommen
function getGoLivesMapForScenario(scenario: DemoScenario): Map<string, GoLive[]> {
  switch (scenario) {
    case 'demo-75':
      return DEMO_GO_LIVES_MAP_75;
    case 'demo-100':
      return DEMO_GO_LIVES_MAP_100;
    case 'demo-120':
      return DEMO_GO_LIVES_MAP_120;
  }
}

function getAllGoLivesForScenario(scenario: DemoScenario): GoLive[] {
  const map = getGoLivesMapForScenario(scenario);
  return Array.from(map.values()).flat();
}

interface DemoDataResult {
  // Users
  users: User[];
  selectableAEs: User[];
  
  // Settings
  settingsMap: Map<string, AESettings>;
  
  // Go-Lives
  goLivesMap: Map<string, GoLive[]>;
  allGoLives: GoLive[];
  
  // Challenges
  challenges: Challenge[];
  
  // Helper Methoden
  getSettingsForUser: (userId: string) => AESettings | undefined;
  getGoLivesForUser: (userId: string) => GoLive[];
}

export function useDemoData(scenario: DemoScenario): DemoDataResult {
  return useMemo(() => {
    const goLivesMap = getGoLivesMapForScenario(scenario);
    const allGoLives = getAllGoLivesForScenario(scenario);
    
    return {
      // Users - immer die gleichen 3 AEs + Manager
      users: ALL_DEMO_USERS,
      selectableAEs: DEMO_USERS,
      
      // Settings
      settingsMap: DEMO_SETTINGS,
      
      // Go-Lives - je nach Szenario
      goLivesMap,
      allGoLives,
      
      // Challenges
      challenges: DEMO_CHALLENGES,
      
      // Helper Methoden
      getSettingsForUser: (userId: string) => DEMO_SETTINGS.get(userId),
      getGoLivesForUser: (userId: string) => goLivesMap.get(userId) || [],
    };
  }, [scenario]);
}
