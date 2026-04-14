import React from 'react';
import { Button } from "@/components/ui/button";
import { APP_BASE_PATH } from "app";

/**
 * HeroSection component displays the main banner section at the top of the homepage
 * Includes headline, description and CTA button
 */
export const HeroSection: React.FC = () => {
  return (
    <section className="py-20 bg-gray-50">
      <div className="container mx-auto px-4 text-center">
        <h1 className="text-5xl font-bold mb-6">Mühelose Terminverwaltung</h1>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          Optimieren Sie Ihre Terminplanung mit Q-ME. Die komplette Lösung für Shopbetreiber, Mitarbeiter und Kunden.
        </p>
        <Button 
          size="lg" 
          className="text-lg px-8" 
          onClick={() => {
            window.location.href = `${window.location.origin}${APP_BASE_PATH}/register-options`;
          }}
        >
          Kostenlos testen
        </Button>
      </div>
    </section>
  );
};
