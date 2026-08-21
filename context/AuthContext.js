// context/AuthContext.js
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext({
  user: null,
  session: null,
  initializing: true,
  error: null,
});

let initialSessionPromise = null;

function getInitialSessionOnce() {
  if (!initialSessionPromise) {
    initialSessionPromise = supabase.auth.getSession();
  }
  return initialSessionPromise;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const { data, error: sessionError } = await getInitialSessionOnce();
        if (!mounted) return;

        if (sessionError) {
          setError(sessionError);
          setSession(null);
          setUser(null);
        } else {
          const nextSession = data?.session || null;
          setError(null);
          setSession(nextSession);
          setUser(nextSession?.user || null);
        }
      } catch (e) {
        if (!mounted) return;
        setError(e);
        setSession(null);
        setUser(null);
      } finally {
        if (!mounted) return;
        setInitializing(false);
      }
    };

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      setError(null);
      setSession(session || null);
      setUser(session?.user || null);
      // If the app was “stuck” showing Splash forever on web, this also unblocks it
      setInitializing(false);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const value = useMemo(
    () => ({ user, session, initializing, error }),
    [user, session, initializing, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
