// Re-export all types and functions for backwards compatibility

// Export types
export * from './types';

// Export all functions from domain-specific modules
export * from './shops';
export * from './staff';
export * from './services';
export * from './appointments';
export * from './queue';
export * from './customers';
// Bild-Upload (Firebase Storage) nicht hier: direkt aus './storage' holen, sonst lädt jede Seite Storage mit