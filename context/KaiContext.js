import React, { createContext, useContext, useMemo, useState } from "react";

const KaiContext = createContext({
  kaiContext: null,
  setKaiContext: () => {},
  clearKaiContext: () => {},
});

export function KaiProvider({ children }) {
  const [kaiContext, setKaiContextState] = useState(null);

  const setKaiContext = (next) => {
    setKaiContextState(next || null);
  };

  const clearKaiContext = () => {
    setKaiContextState(null);
  };

  const value = useMemo(
    () => ({
      kaiContext,
      setKaiContext,
      clearKaiContext,
    }),
    [kaiContext]
  );

  return <KaiContext.Provider value={value}>{children}</KaiContext.Provider>;
}

export function useKaiContext() {
  return useContext(KaiContext);
}