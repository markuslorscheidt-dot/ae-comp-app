// Demo Go-Lives für 120% Zielerreichung
import { GoLive } from '../types';

const SALON_NAMES = [
  'Salon Elegance', 'Hair & Beauty Studio', 'Styling Lounge', 'Friseursalon Müller',
  'Beauty Corner', 'Haarmonie', 'Cut & Style', 'Salon Schönheit', 'Hair Design',
  'Friseur Schmidt', 'Beauty Oase', 'Haar Atelier', 'Salon Chic', 'Style Factory',
  'Friseursalon Weber', 'Beauty Box', 'Hair Lounge', 'Salon Trend', 'Cut Above',
  'Friseur König', 'Beauty Palace', 'Hair Studio Plus', 'Salon Modern', 'Style Zone',
  'Coiffeur Royal', 'Hair Expert', 'Beauty Deluxe', 'Salon Premium', 'Style Master',
  'Glamour Hair', 'Top Cut', 'Friseur Exklusiv', 'Beauty Star', 'Hair Heaven',
];

// Avg Pay Bill Terminal aus Settings (€50/Monat → €600/Jahr ARR Target)
const AVG_PAY_BILL_TERMINAL = 50;
const PAY_ARR_TARGET_PER_TERMINAL = AVG_PAY_BILL_TERMINAL * 12;

function generateGoLives(
  userId: string,
  monthlySubsTargets: number[],
  monthlyPayTargets: number[]
): GoLive[] {
  const goLives: GoLive[] = [];
  let goLiveCounter = 0;
  
  for (let month = 1; month <= 12; month++) {
    // 120% der Targets mit Variation
    const variation = 1.15 + Math.random() * 0.1; // 115-125%
    const targetSubsArr = monthlySubsTargets[month - 1] * variation;
    const targetPayArr = monthlyPayTargets[month - 1] * variation;
    
    // Mehr Go-Lives bei Überperformance
    const avgSubsPerGoLive = 2200 + Math.random() * 600;
    const numGoLives = Math.max(3, Math.round(targetSubsArr / avgSubsPerGoLive));
    
    let remainingSubsArr = targetSubsArr;
    let remainingPayArr = targetPayArr;
    
    for (let i = 0; i < numGoLives; i++) {
      goLiveCounter++;
      
      const isLastGoLive = i === numGoLives - 1;
      const subsArr = isLastGoLive 
        ? Math.max(1800, remainingSubsArr)
        : Math.round(2000 + Math.random() * 1800);
      remainingSubsArr -= subsArr;
      
      // Höhere Terminal-Rate bei Überperformern
      const hasTerminal = Math.random() > 0.3;
      
      // Pay ARR Target wird bei Terminal gesetzt
      const payArrTarget = hasTerminal ? PAY_ARR_TARGET_PER_TERMINAL : null;
      
      // Pay ARR Ist: Top-Performer erreichen oder übertreffen Target meistens
      const hasPayArr = month <= 9 && hasTerminal;
      let payArr: number | null = null;
      if (hasPayArr) {
        const payVariation = Math.random();
        if (payVariation < 0.2) {
          // Selten unter Target: 80-98% (wenig Clawback bei 120% Szenario)
          payArr = Math.round(PAY_ARR_TARGET_PER_TERMINAL * (0.8 + Math.random() * 0.18));
        } else if (payVariation < 0.5) {
          // Target erreicht oder leicht drüber: 100-130%
          payArr = Math.round(PAY_ARR_TARGET_PER_TERMINAL * (1.0 + Math.random() * 0.3));
        } else {
          // Deutlich über Target: 130-200% (Top-Performer)
          payArr = Math.round(PAY_ARR_TARGET_PER_TERMINAL * (1.3 + Math.random() * 0.7));
        }
      }
      
      const day = Math.min(28, Math.floor(1 + Math.random() * 27));
      const dateStr = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      goLives.push({
        id: `demo-golive-120-${userId}-${goLiveCounter}`,
        user_id: userId,
        year: 2026,
        month: month,
        customer_name: SALON_NAMES[goLiveCounter % SALON_NAMES.length],
        oak_id: 30000 + goLiveCounter,
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

// Basis-Targets (werden mit 120% multipliziert in generateGoLives)
const TARGETS_BASE = {
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

export const DEMO_GO_LIVES_120: GoLive[] = [
  ...generateGoLives('demo-user-1', TARGETS_BASE['demo-user-1'].subs, TARGETS_BASE['demo-user-1'].pay),
  ...generateGoLives('demo-user-2', TARGETS_BASE['demo-user-2'].subs, TARGETS_BASE['demo-user-2'].pay),
  ...generateGoLives('demo-user-3', TARGETS_BASE['demo-user-3'].subs, TARGETS_BASE['demo-user-3'].pay),
];

export const DEMO_GO_LIVES_MAP_120: Map<string, GoLive[]> = new Map([
  ['demo-user-1', DEMO_GO_LIVES_120.filter(gl => gl.user_id === 'demo-user-1')],
  ['demo-user-2', DEMO_GO_LIVES_120.filter(gl => gl.user_id === 'demo-user-2')],
  ['demo-user-3', DEMO_GO_LIVES_120.filter(gl => gl.user_id === 'demo-user-3')],
]);
