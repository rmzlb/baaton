import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView } from 'framer-motion';
import { Check, ArrowRight } from 'lucide-react';

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

interface PricingTier {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}

const tiers: PricingTier[] = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For solo builders experimenting with AI agents.',
    features: [
      'Up to 3 projects',
      '1 organization',
      'AI assistant (50 msgs/day)',
      'GitHub sync',
      'Kanban & List views',
      'Community support',
    ],
    cta: 'Get started',
  },
  {
    name: 'Pro',
    price: '$9',
    period: '/month',
    description: 'For individuals shipping seriously with AI.',
    features: [
      'Unlimited projects',
      '3 organizations',
      'Unlimited AI assistant',
      'Priority GitHub sync',
      'Advanced filters & views',
      'Custom fields',
      'API access',
      'Email support',
    ],
    cta: 'Start free trial',
    highlighted: true,
  },
  {
    name: 'Team',
    price: '$19',
    period: '/user/mo',
    description: 'For teams orchestrating AI at scale.',
    features: [
      'Everything in Pro',
      'Unlimited organizations',
      'Team AI agent pools',
      'Role-based permissions',
      'Audit logs',
      'SSO / SAML',
      'Dedicated support',
      'Custom integrations',
    ],
    cta: 'Contact sales',
  },
];

export function Pricing() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section id="pricing" className="relative py-24 md:py-32" aria-label="Pricing">
      <div className="max-w-5xl mx-auto px-6">
        <motion.div
          ref={ref}
          initial="hidden"
          animate={inView ? 'visible' : 'hidden'}
          variants={stagger}
        >
          <motion.p
            variants={fadeUp}
            custom={0}
            className="text-sm font-medium text-amber-500 tracking-wide uppercase mb-3 text-center"
          >
            Pricing
          </motion.p>
          <motion.h2
            variants={fadeUp}
            custom={1}
            className="text-3xl sm:text-4xl md:text-5xl font-bold text-primary tracking-tight mb-4 text-center"
          >
            Simple, transparent pricing.
          </motion.h2>
          <motion.p
            variants={fadeUp}
            custom={2}
            className="text-secondary mb-16 max-w-lg mx-auto text-center"
          >
            Start free. Upgrade when you need more power.
          </motion.p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {tiers.map((tier, i) => (
              <motion.div
                key={tier.name}
                variants={fadeUp}
                custom={i + 3}
                className={`relative rounded-xl border p-6 md:p-8 flex flex-col transition-colors ${
                  tier.highlighted
                    ? 'border-amber-500/40 bg-amber-500/[0.04]'
                    : 'border-border bg-surface/30 hover:bg-surface/50'
                }`}
              >
                {tier.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-black text-xs font-semibold">
                    Most popular
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-primary mb-2">{tier.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-primary">{tier.price}</span>
                    <span className="text-sm text-muted">{tier.period}</span>
                  </div>
                  <p className="text-sm text-secondary mt-3">{tier.description}</p>
                </div>

                <ul className="space-y-3 mb-8 flex-1" role="list">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-secondary">
                      <Check
                        className={`w-4 h-4 mt-0.5 shrink-0 ${
                          tier.highlighted ? 'text-amber-500' : 'text-muted'
                        }`}
                        strokeWidth={2.5}
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Link
                  to={tier.name === 'Team' ? '#' : '/sign-up'}
                  className={`w-full h-11 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                    tier.highlighted
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-black hover:brightness-110'
                      : 'border border-border text-secondary hover:text-primary hover:border-white/20'
                  }`}
                >
                  {tier.cta}
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
