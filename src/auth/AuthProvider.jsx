import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { AuthContext } from './context';

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try { setUser((await api('/auth/me')).user); } catch { setUser(null); } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (role, email, password) => {
    const { user: u } = await api(`/auth/${role}/login`, { method: 'POST', body: { email, password } });
    setUser(u);
    return u;
  };
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}