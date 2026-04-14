import React from "react";
import { useNavigate } from "react-router-dom";

// Import components
import { AnonymousBookingHandler } from '../components/AnonymousBookingHandler';
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { HeroSection } from "../components/HeroSection";
import { CTASection } from "../components/CTASection";
import { FeatureSection } from "../components/FeatureSection";
import { MarketplaceSection } from "../components/MarketplaceSection";

/**
 * App is the main homepage of the application
 * It showcases different sections for promoting Q-ME
 */




export default function App() {
  return (
    <div className="min-h-screen bg-white">
      {/* Anonymous booking handler to link bookings when users log in */}
      <AnonymousBookingHandler />
      
      {/* Navigation bar */}
      <Navbar />

      {/* Hero Section with main value proposition */}
      <HeroSection />

      {/* Features section showing benefits for different user types */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Die perfekte Lösung für alle</h2>
          <FeatureSection />
        </div>
      </section>

      {/* Marketplace section for discovering nearby shops */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Entdecken Sie Shops in Ihrer Nähe</h2>
          <MarketplaceSection />
        </div>
      </section>

      {/* Call-to-action section */}
      <CTASection />

      {/* Footer with copyright information */}
      <Footer />
    </div>
  );
}
