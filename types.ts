
export enum UserRole {
  EMPLOYEE = 'Richiedente',
  MANAGER = 'Gestione',
}

export enum Department {
  PREVENDITA = 'PREVENDITA',
  HELPDESK = 'HELPDESK',
  COMMERCIALI = 'COMMERCIALI',
  MANAGEMENT = 'MANAGEMENT' // Fallback for admin
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  department: Department | string;
  password?: string; // Only for managers
}

export enum RequestStatus {
  PENDING = 'In Attesa',
  APPROVED = 'Approvato',
  REJECTED = 'Rifiutato',
}

export enum RequestType {
  FERIE = 'Ferie',
  ROL = 'ROL',
}

export interface LeaveRequest {
  id: string;
  userId: string;
  startDate: string; // ISO Date string YYYY-MM-DD
  endDate: string;   // ISO Date string YYYY-MM-DD
  type: RequestType; // Nuovo campo
  startTime?: string; // Opzionale, solo per ROL (es. "09:00")
  endTime?: string;   // Opzionale, solo per ROL (es. "13:00")
  status: RequestStatus;
  reason: string;
  createdAt: number;
}

export type ViewState = 'dashboard' | 'calendar' | 'requests' | 'users' | 'settings';
