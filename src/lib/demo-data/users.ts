// Demo Users - 3 fiktive AEs mit deutschen Namen
import { User } from '../types';

export const DEMO_USERS: User[] = [
  {
    id: 'demo-user-1',
    email: 'lisa.schmidt@demo.de',
    name: 'Lisa Schmidt',
    role: 'ae',
    region: 'DACH-Nord',
    created_at: '2025-01-15T10:00:00Z',
  },
  {
    id: 'demo-user-2',
    email: 'max.weber@demo.de',
    name: 'Max Weber',
    role: 'ae',
    region: 'DACH-Süd',
    created_at: '2025-03-01T10:00:00Z',
  },
  {
    id: 'demo-user-3',
    email: 'anna.mueller@demo.de',
    name: 'Anna Müller',
    role: 'ae',
    region: 'DACH-West',
    created_at: '2025-02-10T10:00:00Z',
  },
];

// Demo Line Manager (für Admin-Ansicht)
export const DEMO_MANAGER: User = {
  id: 'demo-manager',
  email: 'thomas.wagner@demo.de',
  name: 'Thomas Wagner',
  role: 'line_manager',
  region: 'DACH',
  created_at: '2024-06-01T10:00:00Z',
};

// Alle Demo-User inkl. Manager
export const ALL_DEMO_USERS: User[] = [DEMO_MANAGER, ...DEMO_USERS];
