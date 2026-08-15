import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { getAuthErrorMessage } from '../utils/authErrorUtils';
import { IconInput } from './ui/IconInput';
import Branding from './Branding';

export default function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // detectSessionInUrl establishes a recovery session from the link's
    // tokens; PASSWORD_RECOVERY fires once that's done (or a session may
    // already be present by the time this effect runs).
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError(t('login.errors.weak_password'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('saas.passwords_do_not_match'));
      return;
    }

    setLoading(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw updateErr;
      setSuccess(true);
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err: any) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-muted font-sans p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-surface rounded-[2.5rem] shadow-xl border border-border p-10"
      >
        <div className="text-center mb-8">
          <div className="inline-flex p-4 bg-brand/10 rounded-2xl text-brand mb-4">
            <Lock size={28} />
          </div>
          <h1 className="text-2xl font-black text-content">{t('login.reset_password_title', 'Set a new password')}</h1>
        </div>

        {!ready ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="animate-spin text-brand" size={28} />
          </div>
        ) : success ? (
          <div className="text-center space-y-4 py-4">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-success/10 text-success rounded-full">
              <CheckCircle size={32} />
            </div>
            <p className="text-content-muted font-medium">{t('login.reset_password_success', 'Password updated. Redirecting to login…')}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-danger/10 border border-danger/20 text-danger p-4 rounded-2xl flex items-center gap-3 text-sm font-bold">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            <IconInput
              required
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              startIcon={Lock}
              label={t('login.password')}
              wrapperClassName="h-11"
              endIcon={
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-content-muted hover:text-content flex items-center justify-center p-1 focus:outline-none">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              }
            />

            <IconInput
              required
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              startIcon={Lock}
              label={t('staff.force_pin.confirm_pin_label')}
              wrapperClassName="h-11"
            />

            <button
              disabled={loading}
              type="submit"
              className="w-full bg-brand text-white py-4 rounded-2xl font-bold text-lg hover:bg-brand/90 transition-all shadow-xl shadow-brand/10 flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {loading ? <Loader2 className="animate-spin" /> : null}
              <span>{t('common.save')}</span>
            </button>
          </form>
        )}

        <div className="pt-8 flex justify-center">
          <Branding className="opacity-50" />
        </div>
      </motion.div>
    </div>
  );
}
