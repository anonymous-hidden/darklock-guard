import { useState, useCallback } from 'react';
import { navigateDate } from '../utils/dateHelpers';

export function useCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('week');
  const [searchQuery, setSearchQuery] = useState('');

  const goToday = useCallback(() => setCurrentDate(new Date()), []);

  const goForward = useCallback(() => {
    setCurrentDate((d) => navigateDate(d, 1, view));
  }, [view]);

  const goBack = useCallback(() => {
    setCurrentDate((d) => navigateDate(d, -1, view));
  }, [view]);

  const goToDate = useCallback((date) => {
    setCurrentDate(date);
  }, []);

  return {
    currentDate,
    view,
    searchQuery,
    setView,
    setSearchQuery,
    goToday,
    goForward,
    goBack,
    goToDate,
  };
}
