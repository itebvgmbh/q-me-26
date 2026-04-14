import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/**
 * JoinQueueRefactored is now consolidated with PublicJoinQueue
 * This component simply redirects to the PublicJoinQueue component
 * while preserving any query parameters
 */
const JoinQueueRefactored = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  useEffect(() => {
    // Build the same query string to pass along to PublicJoinQueue
    const queryString = searchParams.toString();
    const redirectPath = queryString ? `/public-join-queue?${queryString}` : '/public-join-queue';
    
    // Redirect to PublicJoinQueue
    navigate(redirectPath, { replace: true });
  }, [navigate, searchParams]);

  // Display a simple loading state while redirecting
  return (
    <div className="container mx-auto py-8 text-center">
      <p>Redirecting to queue system...</p>
    </div>
  );
};

export default JoinQueueRefactored;
