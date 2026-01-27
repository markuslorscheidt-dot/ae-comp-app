// Demo Go-Lives für 75% Zielerreichung
import { GoLive } from '../types';

// Hilfsfunktion für zufällige Kundennamen
const SALON_NAMES = [
  'Salon Elegance', 'Hair & Beauty Studio', 'Styling Lounge', 'Friseursalon Müller',
  'Beauty Corner', 'Haarmonie', 'Cut & Style', 'Salon Schönheit', 'Hair Design',
  'Friseur Schmidt', 'Beauty Oase', 'Haar Atelier', 'Salon Chic', 'Style Factory',
  'Friseursalon Weber', 'Beauty Box', 'Hair Lounge', 'Salon Trend', 'Cut Above',
  'Friseur König', 'Beauty Palace', 'Hair Studio Plus', 'Salon Modern', 'Style Zone',
];

// Avg Pay Bill Terminal aus Settings (€50/Monat → €600/Jahr ARR Target)
const AVG_PAY_BILL_TERMINAL = 50;
const PAY_ARR_TARGET_PER_TERMINAL = AVG_PAY_BILL_TERMINAL * 12;

function generateGoLives(
  userId: string,
  targetPercentage: number,
  monthlySubsTargets: number[],
  monthlyPayTargets: number[]
): GoLive[] {
  const goLives: GoLive[] = [];
  let goLiveCounter = 0;
  
  for (let month = 1; month <= 12; month++) {
    const monthTarget = monthlySubsTargets[month - 1];
    const payTarget = monthlyPayTargets[month - 1];
    
    // Erreichte ARR für diesen Monat (mit etwas Variation)
    const variation = 0.9 + Math.random() * 0.2; // 90-110% des Durchschnitts
    const targetSubsArr = monthTarget * targetPercentage * variation;
    const targetPayArr = payTarget * targetPercentage * variation;
    
    // Anzahl Go-Lives (durchschnittlich 180€/Monat pro Kunde = 2160€ ARR)
    const avgSubsPerGoLive = 2000 + Math.random() * 500;
    const numGoLives = Math.max(1, Math.round(targetSubsArr / avgSubsPerGoLive));
    
    // Go-Lives für diesen Monat erstellen
    let remainingSubsArr = targetSubsArr;
    let remainingPayArr = targetPayArr;
    
    for (let i = 0; i < numGoLives; i++) {
      goLiveCounter++;
      
      // Subs ARR für diesen Go-Live
      const isLastGoLive = i === numGoLives - 1;
      const subsArr = isLastGoLive 
        ? Math.max(1200, remainingSubsArr)
        : Math.round(1500 + Math.random() * 1500);
      remainingSubsArr -= subsArr;
      
      // Terminal (ca. 60% haben Terminal)
      const hasTerminal = Math.random() > 0.4;
      
      // Pay ARR Target wird bei Terminal gesetzt
      const payArrTarget = hasTerminal ? PAY_ARR_TARGET_PER_TERMINAL : null;
      
      // Pay ARR Ist: Nach 3 Monaten haben wir Ist-Daten (Monate 1-9)
      // 75% Szenario: Mehr Clawback (50% unter Target)
      const hasPayArr = month <= 9 && hasTerminal;
      let payArr: number | null = null;
      if (hasPayArr) {
        const payVariation = Math.random();
        if (payVariation < 0.5) {
          // Unter Target: 40-85% vom Target (mehr Clawback bei 75% Szenario)
          payArr = Math.round(PAY_ARR_TARGET_PER_TERMINAL * (0.4 + Math.random() * 0.45));
        } else if (payVariation < 0.8) {
          // Target erreicht: 95-110%
          payArr = Math.round(PAY_ARR_TARGET_PER_TERMINAL * (0.95 + Math.random() * 0.15));
        } else {
          // Leicht über Target: 110-140%
          payArr = Math.round(PAY_ARR_TARGET_PER_TERMINAL * (1.1 + Math.random() * 0.3));
        }
      }
      
      // Zufälliges Datum im Monat
      const day = Math.min(28, Math.floor(1 + Math.random() * 27));
      const dateStr = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      goLives.push({
        id: `demo-golive-75-${userId}-${goLiveCounter}`,
        user_id: userId,
        year: 2026,
        month: month,
        customer_name: SALON_NAMES[goLiveCounter % SALON_NAMES.length],
        oak_id: 10000 + goLiveCounter,
        go_live_date: dateStr,
        subs_monthly: Math.round(subsArr / 12),
        subs_arr: Math.round(subsArr),
        has_terminal: hasTerminal,
        pay_arr_target: payArrTarget,
        pay_arr: payArr,
        commission_relevant: true,
        partner_id: null,
        is_enterprise: false,
        subscription_package_id: null,
        notes: null,
        created_at: dateStr + 'T10:00:00Z',
        updated_at: dateStr + 'T10:00:00Z',
      });
    }
  }
  
  return goLives;
}

// 75% Targets
const TARGETS_75 = {
  'demo-user-1': {
    subs: [33000, 35200, 38500, 41800, 44000, 46200, 44000, 41800, 49500, 52800, 55000, 49500].map(t => t * 0.75),
    pay: [8800, 9900, 11000, 12100, 13200, 14300, 13200, 12100, 15400, 16500, 17600, 15400].map(t => t * 0.75),
  },
  'demo-user-2': {
    subs: [30000, 32000, 35000, 38000, 40000, 42000, 40000, 38000, 45000, 48000, 50000, 45000].map(t => t * 0.75),
    pay: [8000, 9000, 10000, 11000, 12000, 13000, 12000, 11000, 14000, 15000, 16000, 14000].map(t => t * 0.75),
  },
  'demo-user-3': {
    subs: [27000, 28800, 31500, 34200, 36000, 37800, 36000, 34200, 40500, 43200, 45000, 40500].map(t => t * 0.75),
    pay: [7200, 8100, 9000, 9900, 10800, 11700, 10800, 9900, 12600, 13500, 14400, 12600].map(t => t * 0.75),
  },
};

export const DEMO_GO_LIVES_75: GoLive[] = [
  ...generateGoLives('demo-user-1', 1, TARGETS_75['demo-user-1'].subs, TARGETS_75['demo-user-1'].pay),
  ...generateGoLives('demo-user-2', 1, TARGETS_75['demo-user-2'].subs, TARGETS_75['demo-user-2'].pay),
  ...generateGoLives('demo-user-3', 1, TARGETS_75['demo-user-3'].subs, TARGETS_75['demo-user-3'].pay),
];

// Als Map für einfachen Zugriff
export const DEMO_GO_LIVES_MAP_75: Map<string, GoLive[]> = new Map([
  ['demo-user-1', DEMO_GO_LIVES_75.filter(gl => gl.user_id === 'demo-user-1')],
  ['demo-user-2', DEMO_GO_LIVES_75.filter(gl => gl.user_id === 'demo-user-2')],
  ['demo-user-3', DEMO_GO_LIVES_75.filter(gl => gl.user_id === 'demo-user-3')],
]);
