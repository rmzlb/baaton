import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Send, Bug, Sparkles, Zap, HelpCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { PixelBaton } from '@/components/shared/PixelBaton';
import { useTranslation } from '@/hooks/useTranslation';
import { api, ApiError } from '@/lib/api';
import type { IssueType, IssuePriority } from '@/lib/types';

const types: { value: IssueType; labelKey: string; icon: typeof Bug; color: string }[] = [
  { value: 'bug', labelKey: 'publicSubmit.typeBug', icon: Bug, color: 'text-red-400 border-red-400/30' },
  { value: 'feature', labelKey: 'publicSubmit.typeFeature', icon: Sparkles, color: 'text-emerald-400 border-emerald-400/30' },
  { value: 'improvement', labelKey: 'publicSubmit.typeImprovement', icon: Zap, color: 'text-blue-400 border-blue-400/30' },
  { value: 'question', labelKey: 'publicSubmit.typeQuestion', icon: HelpCircle, color: 'text-purple-400 border-purple-400/30' },
];

const priorities: { value: IssuePriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const categories = ['FRONT', 'BACK', 'API', 'DB', 'INFRA', 'UX', 'DEVOPS'];

export function PublicSubmit() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedType, setSelectedType] = useState<IssueType>('bug');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !slug || !token) return;

    setSubmitting(true);
    setError('');

    try {
      await api.public.post(`/public/${slug}/submit`, {
        title: title.trim(),
        description: description.trim() || undefined,
        type: selectedType,
        priority,
        category: selectedCategories,
        reporter_name: name.trim() || undefined,
        reporter_email: email.trim() || undefined,
        token,
      });
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setError(t('publicSubmit.projectNotFound', { slug }));
        } else if (err.status === 429) {
          setError(t('publicSubmit.tooManyRequests'));
        } else {
          setError(err.message);
        }
      } else {
        setError(t('publicSubmit.genericError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubmitted(false);
    setTitle('');
    setDescription('');
    setSelectedType('bug');
    setError('');
  };

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <div className="text-center">
          <CheckCircle2 size={64} className="mx-auto text-green-500 mb-4" />
          <h2 className="text-xl font-bold text-primary">{t('publicSubmit.submitted')}</h2>
          <p className="mt-2 text-sm text-secondary">
            {t('publicSubmit.submittedDesc')}
          </p>
          <button
            onClick={resetForm}
            className="mt-6 text-sm text-accent hover:underline"
          >
            {t('publicSubmit.submitAnother')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <PixelBaton size={48} className="mx-auto mb-3" />
          <h1 className="text-xl font-bold text-primary">{t('publicSubmit.title')}</h1>
          <p className="mt-1 text-sm text-secondary">
            for <span className="font-mono text-accent">{slug}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {!token && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-200">Lien public invalide ou expiré.</p>
            </div>
          )}
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
              <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Type selector */}
          <div className="grid grid-cols-4 gap-2">
            {types.map(({ value, labelKey, icon: Icon, color }) => (
              <button
                key={value}
                type="button"
                onClick={() => setSelectedType(value)}
                className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-xs transition-colors min-h-[44px] ${
                  selectedType === value
                    ? `${color} bg-surface`
                    : 'border-border text-secondary hover:border-border'
                }`}
              >
                <Icon size={20} />
                {t(labelKey)}
              </button>
            ))}
          </div>

          {/* Priority */}
          <div className="grid grid-cols-2 gap-2">
            {priorities.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriority(p.value)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  priority === p.value ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border text-secondary hover:bg-surface-hover'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Category */}
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => {
              const active = selectedCategories.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? selectedCategories.filter((c) => c !== cat)
                      : [...selectedCategories, cat];
                    setSelectedCategories(next);
                  }}
                  className={`rounded-full border px-3 py-1 text-[10px] transition-colors ${
                    active ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border text-muted hover:bg-surface-hover'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Title */}
          <input
            type="text"
            placeholder="Brief summary..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none transition-colors"
          />

          {/* Description */}
          <textarea
            placeholder="Tell us more... (markdown supported)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none resize-none transition-colors"
          />

          {/* Name + Email (optional) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none transition-colors"
            />
            <input
              type="email"
              placeholder="Email (optional)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none transition-colors"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!title.trim() || submitting || !token}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-medium text-black hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[44px]"
          >
            <Send size={16} />
            {submitting ? t('publicSubmit.submitting') : t('publicSubmit.submit')}
          </button>
        </form>

        <p className="mt-6 text-center text-[10px] text-secondary">
          Powered by <span className="text-accent">baaton.dev</span>
        </p>
      </div>
    </div>
  );
}

export default PublicSubmit;
