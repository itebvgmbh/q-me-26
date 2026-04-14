import React from 'react';
import { Button } from "@/components/ui/button";
import { APP_BASE_PATH } from "app";

/**
 * CTASection component displays the call-to-action section 
 * encouraging users to register as shop owners or customers
 */
export const CTASection: React.FC = () => {
  return (
    <section className="py-20 bg-gray-50">
      <div className="container mx-auto px-4 text-center">
        <h2 className="text-3xl font-bold mb-6">Bereit, Ihr Geschäft zu optimieren?</h2>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          Schließen Sie sich den vielen Shops an, die Q-ME bereits für ihre Terminverwaltung nutzen.
        </p>
        <div className="flex gap-4 justify-center">
          <Button 
            size="lg" 
            variant="default" 
            onClick={() => {
              window.location.href = `${window.location.origin}${APP_BASE_PATH}/register-shop-owner`;
            }}
          >
            Als Shop-Betreiber starten
          </Button>
          <Button 
            size="lg" 
            variant="outline" 
            onClick={() => {
              window.location.href = `${window.location.origin}${APP_BASE_PATH}/register-customer`;
            }}
          >
            Als Kunde registrieren
          </Button>
        </div>
      </div>
    </section>
  );
};
