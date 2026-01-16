// Demo Go-Lives für 100% Zielerreichung
import { GoLive } from '../types';

const SALON_NAMES = [
  'Salon Elegance', 'Hair & Beauty Studio', 'Styling Lounge', 'Friseursalon Müller',
  'Beauty Corner', 'Haarmonie', 'Cut & Style', 'Salon Schönheit', 'Hair Design',
  'Friseur Schmidt', 'Beauty Oase', 'Haar Atelier', 'Salon Chic', 'Style Factory',
  'Friseursalon Weber', 'Beauty Box', 'Hair Lounge', 'Salon Trend', 'Cut Above',
  'Friseur König', 'Beauty Palace', 'Hair Studio Plus', 'Salon Modern', 'Style Zone',
  'Coiffeur Royal', 'Hair Expert', 'Beauty Deluxe', 'Salon Premium', 'Style Master',
];

function generateGoLives(
  userId: string,
  monthlySubsTargets: number[],
  monthlyPayTargets: number[]
): GoLive[] {
  const goLives: GoLive[] = [];
  let goLiveCounter = 0;
  
  for (let month = 1; month <= 12; month++) {
    const targetSubsArr = monthlySubsTargets[month - 1];
    const targetPayArr = monthlyPayTargets[month - 1];
    
    // Leichte Variation um 100% (+/- 5%)
    const variation = 0.95 + Math.random() * 0.1;
    const actualSubsArr = targetSubsArr * variation;
    const actualPayArr = targetPayArr * variation;
    
    // Anzahl Go-Lives
    const avgSubsPerGoLive = 2000 + Math.random() * 600;
    const numGoLives = Math.max(2, Math.round(actualSubsArr / avgSubsPerGoLive));
    
    let remainingSubsArr = actualSubsArr;
    let remainingPayArr = actualPayArr;
    
    for (let i = 0; i < numGoLives; i++) {
      goLiveCounter++;
      
      const isLastGoLive = i === numGoLives - 1;
      const subsArr = isLastGoLive 
        ? Math.max(1500, remainingSubsArr)
        : Math.round(1800 + Math.random() * 1400);
      remainingSubsArr -= subsArr;
      
      const hasPayArr = month <= 9 && Math.random() > 0.25;
      const payArr = hasPayArr 
        ? Math.round(Math.min(remainingPayArr / (numGoLives - i), 1000 + Math.random() * 1500))
        : 0;
      if (hasPayArr) remainingPayArr -= payArr;
      
      const hasTerminal = Math.random() > 0.35;
      
      const day = Math.min(28, Math.floor(1 + Math.random() * 27));
      const dateStr = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      goLives.push({
        id: `demo-golive-100-${userId}-${goLiveCounter}`,
        user_id: userId,
        year: 2026,
        month: month,
        customer_name: SALON_NAMES[goLiveCounter % SALON_NAMES.length],
        oak_id: 20000 + goLiveCounter,
        go_live_date: dateStr,
        subs_monthly: Math.round(subsArr / 12),
        subs_arr: Math.round(subsArr),
        has_terminal: hasTerminal,
        pay_arr: payArr || null,
        commission_relevant: true,
        notes: null,
        created_at: dateStr + 'T10:00:00Z',
        updated_at: dateStr + 'T10:00:00Z',
      });
    }
  }
  
  return goLives;
}

// 100% Targets (direkt aus Settings)
const TARGETS_100 = {
  'demo-user-1': {
    subs: [33000, 35200, 38500, 41800, 44000, 46200, 44000, 41800, 49500, 52800, 55000, 49500],
    pay: [8800, 9900, 11000, 12100, 13200, 14300, 13200, 12100, 15400, 16500, 17600, 15400],
  },
  'demo-user-2': {
    subs: [30000, 32000, 35000, 38000, 40000, 42000, 40000, 38000, 45000, 48000, 50000, 45000],
    pay: [8000, 9000, 10000, 11000, 12000, 13000, 12000, 11000, 14000, 15000, 16000, 14000],
  },
  'demo-user-3': {
    subs: [27000, 28800, 31500, 34200, 36000, 37800, 36000, 34200, 40500, 43200, 45000, 40500],
    pay: [7200, 8100, 9000, 9900, 10800, 11700, 10800, 9900, 12600, 13500, 14400, 12600],
  },
};

export const DEMO_GO_LIVES_100: GoLive[] = [
  ...generateGoLives('demo-user-1', TARGETS_100['demo-user-1'].subs, TARGETS_100['demo-user-1'].pay),
  ...generateGoLives('demo-user-2', TARGETS_100['demo-user-2'].subs, TARGETS_100['demo-user-2'].pay),
  ...generateGoLives('demo-user-3', TARGETS_100['demo-user-3'].subs, TARGETS_100['demo-user-3'].pay),
];

export const DEMO_GO_LIVES_MAP_100: Map<string, GoLive[]> = new Map([
  ['demo-user-1', DEMO_GO_LIVES_100.filter(gl => gl.user_id === 'demo-user-1')],
  ['demo-user-2', DEMO_GO_LIVES_100.filter(gl => gl.user_id === 'demo-user-2')],
  ['demo-user-3', DEMO_GO_LIVES_100.filter(gl => gl.user_id === 'demo-user-3')],
]);
