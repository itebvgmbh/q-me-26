import React from 'react';
import { AuthButtons } from './AuthButtons';

/**
 * Navbar component displays the top navigation bar
 * Contains the logo and AuthButtons component
 */
export const Navbar: React.FC = () => {
  return (
    <nav className="border-b">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <div className="text-2xl font-bold">Q-ME</div>
        <AuthButtons />
      </div>
    </nav>
  );
};
