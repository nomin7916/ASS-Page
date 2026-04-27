// @ts-nocheck
import { useState } from 'react';

export function usePinManager() {
  const [showPinChange, setShowPinChange] = useState(false);
  const [pinChangeSaving, setPinChangeSaving] = useState(false);
  const [pinCurrent, setPinCurrent] = useState(['', '', '', '']);
  const [pinNew, setPinNew] = useState(['', '', '', '']);
  const [pinConfirm, setPinConfirm] = useState(['', '', '', '']);
  const [pinChangeError, setPinChangeError] = useState('');

  const openPinChange = () => {
    setPinCurrent(['', '', '', '']);
    setPinNew(['', '', '', '']);
    setPinConfirm(['', '', '', '']);
    setPinChangeError('');
    setShowPinChange(true);
  };

  return {
    showPinChange, setShowPinChange,
    pinChangeSaving, setPinChangeSaving,
    pinCurrent, setPinCurrent,
    pinNew, setPinNew,
    pinConfirm, setPinConfirm,
    pinChangeError, setPinChangeError,
    openPinChange,
  };
}
