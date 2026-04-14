import React from 'react';

/**
 * Footer component for the application
 * Contains copyright information and potentially navigation links
 */
export const Footer: React.FC = () => {
  return (
    <footer className="border-t py-8">
      <div className="container mx-auto px-4 text-center text-gray-600">
        <p>© 2024 Q-ME. Alle Rechte vorbehalten.</p>
      </div>
    </footer>
  );
};
