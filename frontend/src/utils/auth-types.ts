export type UserRole = 'shopOwner' | 'employee' | 'customer';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  displayName?: string;
  phoneNumber?: string;
  createdAt: number;
  updatedAt: number;
}

export const USER_ROLES: { [key in UserRole]: { label: string; description: string } } = {
  shopOwner: {
    label: 'Shopbetreiber',
    description: 'Verwalten Sie Ihren Shop und Ihre Mitarbeiter'
  },
  employee: {
    label: 'Mitarbeiter',
    description: 'Verwalten Sie Termine und Kunden'
  },
  customer: {
    label: 'Kunde',
    description: 'Buchen Sie Termine bei Ihren bevorzugten Shops'
  }
};
