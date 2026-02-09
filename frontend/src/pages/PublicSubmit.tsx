import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Send, Bug, Sparkles, Zap, HelpCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { PixelBaton } from '@/components/shared/PixelBaton';
import { api, ApiError } from '@/lib/api';
import type { IssueType } from '@/lib/types';

const types: { value: IssueType; label: string; icon: typeof Bug; color: string }[] = [
  { value: 'bug', label: 'Bug', icon: Bug, color: 'text-red-400 border-red-400/30' },
  { value: 'feature', label: 'Feature', icon: Sparkles, color: 'text-emerald-400 border-emerald-400/30' },
  { value: 'improvement', label: 'Improvement', icon: Zap, color: 'text-blue-400 border-blue-400/30' },
  { value: 'question', label: 'Question', icon: HelpCircle, color: 'text-purple-400 border-purple-400/30' },
];

export function PublicSubmit() {
  const { slug } = useParams<{ slug: string }>();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedType, setSelectedType] = useState<IssueType>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !slug) return;

    setSubmitting(true);
    setError('');

    try {
      await api.public.post(`/public/${slug}/submit`, {
        title: title.trim(),
        description: description.trim() || undefined,
        type: selectedType,
        reporter_name: name.trim() || undefined,
        reporter_email: email.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setError(`Project "${slug}" not found. Please check the URL.`);
        } else if (err.status === 429) {
          setError('Too many submissions. Please wait a few minutes and try again.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Something went wrong. Please try again.');
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
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] p-6">
        <div className="text-center">
          <CheckCircle2 size={64} className="mx-auto text-[#22c55e] mb-4" />
          <h2 className="text-xl font-bold text-[#fafafa]">Submitted!</h2>
          <p className="mt-2 text-sm text-[#a1a1aa]">
            Your feedback has been received and will be reviewed by the team.
          </p>
          <button
            onClick={resetForm}
            className="mt-6 text-sm text-[#f59e0b] hover:underline"
          >
            Submit another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <PixelBaton size={48} className="mx-auto mb-3" />
          <h1 className="text-xl font-bold text-[#fafafa]">Submit Feedback</h1>
          <p className="mt-1 text-sm text-[#a1a1aa]">
            for <span className="font-mono text-[#f59e0b]">{slug}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
              <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Type selector */}
          <div className="grid grid-cols-4 gap-2">
            {types.map(({ value, label, icon: Icon, color }) => (
              <button
                key={value}
                type="button"
                onClick={() => setSelectedType(value)}
                className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-xs transition-colors min-h-[44px] ${
                  selectedType === value
                    ? `${color} bg-[#141414]`
                    : 'border-[#262626] text-[#a1a1aa] hover:border-[#333]'
                }`}
              >
                <Icon size={20} />
                {label}
              </button>
            ))}
          </div>

          {/* Title */}
          <input
            type="text"
            placeholder="Brief summary..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full rounded-lg border border-[#262626] bg-[#141414] px-4 py-3 text-sm text-[#fafafa] placeholder-[#a1a1aa] focus:border-[#f59e0b] focus:outline-none transition-colors"
          />

          {/* Description */}
          <textarea
            placeholder="Tell us more... (markdown supported)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-[#262626] bg-[#141414] px-4 py-3 text-sm text-[#fafafa] placeholder-[#a1a1aa] focus:border-[#f59e0b] focus:outline-none resize-none transition-colors"
          />

          {/* Name + Email (optional) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-[#262626] bg-[#141414] px-4 py-3 text-sm text-[#fafafa] placeholder-[#a1a1aa] focus:border-[#f59e0b] focus:outline-none transition-colors"
            />
            <input
              type="email"
              placeholder="Email (optional)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-[#262626] bg-[#141414] px-4 py-3 text-sm text-[#fafafa] placeholder-[#a1a1aa] focus:border-[#f59e0b] focus:outline-none transition-colors"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-medium text-black hover:bg-[#d97706] disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[44px]"
          >
            <Send size={16} />
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </form>

        <p className="mt-6 text-center text-[10px] text-[#a1a1aa]">
          Powered by <span className="text-[#f59e0b]">baaton.dev</span>
        </p>
      </div>
    </div>
  );
}
