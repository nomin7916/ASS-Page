// @ts-nocheck
import { useState } from 'react';

export function useToast() {
  const [globalToast, setGlobalToast] = useState({ text: "", isError: false });
  const showToast = (text, isError = false) => {
    setGlobalToast({ text, isError });
    setTimeout(() => setGlobalToast({ text: "", isError: false }), 4000);
  };
  return { globalToast, showToast };
}
