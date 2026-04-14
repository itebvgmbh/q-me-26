import React from 'react';
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Store, Users, Calendar } from "lucide-react";

/**
 * FeatureSection displays a grid of feature cards highlighting
 * the benefits for different user types: shop owners, employees, and customers
 */
export const FeatureSection: React.FC = () => {
  return (
    <div className="grid md:grid-cols-3 gap-8">
      {/* Shop Owners */}
      <Card>
        <CardHeader>
          <Store className="w-10 h-10 text-primary mb-2" />
          <CardTitle>Shopbetreiber</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-gray-600">
            <li>• Komplette Geschäftsübersicht</li>
            <li>• Personalverwaltung</li>
            <li>• Umsatzverfolgung</li>
            <li>• Kundeneinblicke</li>
          </ul>
        </CardContent>
      </Card>

      {/* Employees */}
      <Card>
        <CardHeader>
          <Users className="w-10 h-10 text-primary mb-2" />
          <CardTitle>Mitarbeiter</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-gray-600">
            <li>• Persönlicher Terminkalender</li>
            <li>• Terminverwaltung</li>
            <li>• Arbeitszeitplanung</li>
            <li>• Kundenkommunikation</li>
          </ul>
        </CardContent>
      </Card>

      {/* Customers */}
      <Card>
        <CardHeader>
          <Calendar className="w-10 h-10 text-primary mb-2" />
          <CardTitle>Kunden</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-gray-600">
            <li>• Einfache Shopsuche</li>
            <li>• Online-Buchung</li>
            <li>• Terminerinnerungen</li>
            <li>• Buchungshistorie</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};
